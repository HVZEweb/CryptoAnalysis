"""Daily incremental data collector — append-only archive."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from alpha.data.archive import append_dataset, last_timestamp
from alpha.data.coverage import SYMBOLS, build_coverage_report, save_coverage_report
from alpha.data.okx_alpha import (
    fetch_funding_history,
    fetch_liquidation_orders,
    fetch_oi_history,
    fetch_orderbook_snapshot,
    fetch_ticker_bbo,
    fetch_trades_history,
    format_orderbook_archive_row,
)
from alpha.data.quality import check_dataset, quality_summary, run_all_quality_checks
from exchange.okx_rest import to_swap_symbol

log = logging.getLogger("alpha.collector")


def _safe(symbol: str) -> str:
    return to_swap_symbol(symbol).replace("/", "_").replace(":", "_")


def collect_funding(symbol: str, *, months: int = 12) -> int:
    safe = _safe(symbol)
    name = f"{safe}_funding"
    before_rows = last_timestamp(name)
    df = fetch_funding_history(symbol, months=months)
    if df.empty:
        return 0
    if before_rows:
        df = df[df["ts"] > before_rows]
    if df.empty:
        log.info("Funding %s: no new rows", symbol)
        return 0
    append_dataset(name, df)
    q = check_dataset(name)
    if not q.ok:
        log.warning("Funding %s quality issues: %s", symbol, q.issues)
    return len(df)


def collect_oi(symbol: str, *, months: int = 1) -> int:
    safe = _safe(symbol)
    name = f"{safe}_oi_5m"
    before_rows = last_timestamp(name)
    df = fetch_oi_history(symbol, period="5m", months=months)
    if df.empty:
        return 0
    if before_rows:
        df = df[df["ts"] > before_rows]
    if df.empty:
        log.info("OI %s: no new rows", symbol)
        return 0
    append_dataset(name, df)
    q = check_dataset(name)
    if not q.ok:
        log.warning("OI %s quality issues: %s", symbol, q.issues)
    return len(df)


def collect_liquidations(symbol: str) -> int:
    safe = _safe(symbol)
    name = f"{safe}_liquidations"
    before_rows = last_timestamp(name)
    df = fetch_liquidation_orders(symbol)
    if df.empty:
        return 0
    if before_rows:
        df = df[df["ts"] > before_rows]
    if df.empty:
        return 0
    append_dataset(name, df)
    return len(df)


def collect_trades(symbol: str) -> int:
    safe = _safe(symbol)
    name = f"{safe}_trades"
    df = fetch_trades_history(symbol, limit=100)
    if df.empty:
        return 0
    append_dataset(name, df)
    return len(df)


def collect_ticker(symbol: str) -> int:
    safe = _safe(symbol)
    name = f"{safe}_ticker"
    df = fetch_ticker_bbo(symbol)
    if df.empty:
        return 0
    append_dataset(name, df)
    return len(df)


def collect_orderbook_burst(symbol: str, *, duration_sec: int = 120, interval_sec: float = 2.0) -> int:
    """Short L2 burst via public REST API — no ccxt connection required."""
    safe = _safe(symbol)
    name = f"{safe}_orderbook"
    rows: list[dict] = []
    t0 = time.time()
    errors = 0

    while time.time() - t0 < duration_sec:
        try:
            snap = fetch_orderbook_snapshot(symbol, depth=20)
            if snap:
                rows.append(format_orderbook_archive_row(snap))
                errors = 0
            else:
                errors += 1
                if errors >= 5:
                    log.warning("Orderbook %s: too many empty responses, stopping burst", symbol)
                    break
        except Exception as e:
            errors += 1
            log.warning("Orderbook %s snapshot error: %s", symbol, e)
            if errors >= 5:
                break
        time.sleep(interval_sec)

    if not rows:
        return 0
    import pandas as pd

    append_dataset(name, pd.DataFrame(rows))
    return len(rows)


def run_daily_archive(
    symbols: list[str] | None = None,
    *,
    l2_duration: int = 120,
    skip_l2: bool = False,
) -> dict:
    """Incremental update for all alpha data sources."""
    symbols = symbols or SYMBOLS
    stats: dict[str, dict[str, int]] = {}
    log.info("Daily archive run — %s", datetime.now(timezone.utc).isoformat())

    for sym in symbols:
        sym_stats: dict[str, int] = {}
        sym_stats["funding"] = collect_funding(sym)
        sym_stats["oi"] = collect_oi(sym)
        sym_stats["liquidations"] = collect_liquidations(sym)
        sym_stats["trades"] = collect_trades(sym)
        sym_stats["ticker"] = collect_ticker(sym)
        if not skip_l2:
            try:
                sym_stats["orderbook"] = collect_orderbook_burst(sym, duration_sec=l2_duration)
            except Exception as e:
                log.warning("Orderbook burst failed for %s: %s", sym, e)
                sym_stats["orderbook"] = 0
        stats[to_swap_symbol(sym)] = sym_stats
        log.info("  %s: %s", sym, sym_stats)

    quality = quality_summary(run_all_quality_checks())
    coverage = build_coverage_report()
    cov_path = save_coverage_report(coverage)

    report = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "symbols": stats,
        "quality": quality,
        "coverage_path": str(cov_path),
    }
    out = Path(__file__).resolve().parents[1] / "results" / "archive_last.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily alpha data archive (append-only)")
    parser.add_argument("--symbols", default=",".join(SYMBOLS))
    parser.add_argument("--l2-duration", type=int, default=120, help="L2 burst seconds per symbol")
    parser.add_argument("--skip-l2", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(message)s")
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    report = run_daily_archive(symbols, l2_duration=args.l2_duration, skip_l2=args.skip_l2)
    print(f"\nArchive complete. Quality: {report['quality']['passed']}/{report['quality']['total']} passed.")
    print(f"Coverage: {report['coverage_path']}")


if __name__ == "__main__":
    main()

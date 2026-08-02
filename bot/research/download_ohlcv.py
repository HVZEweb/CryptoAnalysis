"""
Download OKX USDT-M swap OHLCV history for research/backtests.

Usage:
  cd bot
  python -m research.download_ohlcv --symbols BTC-USDT-SWAP,ETH-USDT-SWAP,SOL-USDT-SWAP --timeframes 1m,3m,5m --months 12

Output: bot/data/ohlcv/{SYMBOL}_{TF}.parquet + .csv + manifest.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from core.config import get_settings
from exchange.okx_rest import TIMEFRAME_MS, to_swap_symbol
from research.okx_history import fetch_history_candles

log = logging.getLogger("research.download_ohlcv")

DATA_DIR = _ROOT / "data" / "ohlcv"
DEFAULT_SYMBOLS = ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
DEFAULT_TIMEFRAMES = ["1m", "3m", "5m"]


def _safe_name(symbol: str) -> str:
    return to_swap_symbol(symbol).replace("/", "_").replace(":", "_")


def _expected_bars(timeframe: str, months: int) -> int:
    tf_ms = TIMEFRAME_MS.get(timeframe, 300_000)
    return int(months * 30 * 24 * 60 * 60_000 / tf_ms)


def _save(df: pd.DataFrame, symbol: str, timeframe: str) -> tuple[Path, Path]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    base = f"{_safe_name(symbol)}_{timeframe}"
    parquet_path = DATA_DIR / f"{base}.parquet"
    csv_path = DATA_DIR / f"{base}.csv"
    df.to_csv(csv_path, index=False)
    try:
        df.to_parquet(parquet_path, index=False)
    except Exception:
        parquet_path = csv_path
    return parquet_path, csv_path


def download_one(
    symbol: str,
    timeframe: str,
    months: int,
) -> dict:
    swap = to_swap_symbol(symbol)
    expected = _expected_bars(timeframe, months)
    log.info("Downloading %s %s | ~%d bars (%d months)...", swap, timeframe, expected, months)

    try:
        df = fetch_history_candles(symbol, timeframe, months=months)
    except Exception as e:
        return {"symbol": swap, "timeframe": timeframe, "bars": 0, "error": str(e)}

    if df.empty:
        return {"symbol": swap, "timeframe": timeframe, "bars": 0, "error": "empty response"}

    parquet_path, csv_path = _save(df, symbol, timeframe)
    span_days = (df["ts"].iloc[-1] - df["ts"].iloc[0]) / 86_400_000

    info = {
        "symbol": swap,
        "timeframe": timeframe,
        "bars": len(df),
        "expected_bars": expected,
        "months_requested": months,
        "span_days": round(span_days, 1),
        "from": df["datetime_utc"].iloc[0].isoformat(),
        "to": df["datetime_utc"].iloc[-1].isoformat(),
        "parquet": str(parquet_path),
        "csv": str(csv_path),
    }
    log.info(
        "Saved %s %s: %d bars, %.1f days (%s -> %s)",
        swap,
        timeframe,
        info["bars"],
        span_days,
        info["from"][:10],
        info["to"][:10],
    )
    return info


def run_download(
    symbols: list[str],
    timeframes: list[str],
    months: int,
) -> list[dict]:
    results: list[dict] = []
    for symbol in symbols:
        for tf in timeframes:
            if tf not in TIMEFRAME_MS:
                log.warning("Skip unsupported timeframe: %s", tf)
                continue
            try:
                results.append(download_one(symbol, tf, months))
            except Exception as e:
                log.error("Failed %s %s: %s", symbol, tf, e)
                results.append({"symbol": to_swap_symbol(symbol), "timeframe": tf, "error": str(e)})

    manifest = {
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "months": months,
        "symbols": [to_swap_symbol(s) for s in symbols],
        "timeframes": timeframes,
        "rest_base": get_settings().okx_rest_base,
        "datasets": results,
    }
    manifest_path = DATA_DIR / "manifest.json"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Manifest: %s", manifest_path)
    return results


def print_summary(results: list[dict]) -> None:
    print("\n" + "=" * 70)
    print("OHLCV DOWNLOAD SUMMARY")
    print("=" * 70)
    for r in results:
        if r.get("error") and not r.get("bars"):
            print(f"  FAIL  {r.get('symbol')} {r.get('timeframe')}: {r.get('error')}")
            continue
        print(
            f"  OK    {r['symbol']} {r['timeframe']}: {r['bars']} bars, "
            f"{r.get('span_days', '?')} days ({r.get('from', '')[:10]} .. {r.get('to', '')[:10]})"
        )
    print(f"\nData dir: {DATA_DIR}")
    print("Use in research: npm run trading:research (auto-loads from data/ohlcv)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download OKX swap OHLCV history")
    parser.add_argument("--symbols", default=",".join(DEFAULT_SYMBOLS))
    parser.add_argument("--timeframes", default=",".join(DEFAULT_TIMEFRAMES))
    parser.add_argument("--months", type=int, default=12, help="History depth (6-12 recommended)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    timeframes = [t.strip() for t in args.timeframes.split(",") if t.strip()]
    months = max(1, min(args.months, 24))

    print(f"Symbols: {symbols}")
    print(f"Timeframes: {timeframes}")
    print(f"Months: {months}")
    for sym in symbols:
        for tf in timeframes:
            print(f"  ~{_expected_bars(tf, months):,} bars expected for {sym} {tf}")

    results = run_download(symbols, timeframes, months)
    print_summary(results)


if __name__ == "__main__":
    main()

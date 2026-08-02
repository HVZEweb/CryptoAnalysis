"""Data Coverage Report — audit before any alpha research."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from alpha.data.archive import DATA_ROOT, load_archive
from alpha.data.quality import check_dataframe, check_ohlcv_file
from exchange.okx_rest import to_swap_symbol
from research.data_loader import DATA_DIR

SYMBOLS = ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"]

# Minimum thresholds for research suitability
THRESHOLDS = {
    "ohlcv_discovery": {"min_bars": 5000, "min_days": 30},
    "funding_research": {"min_rows": 90, "min_days": 30},
    "oi_research": {"min_rows": 2000, "min_days": 7},
    "liquidation_research": {"min_rows": 100, "min_days": 1},
    "microstructure": {"min_rows": 500, "min_days": 1},
    "trades_tape": {"min_rows": 500, "min_days": 1},
}


@dataclass
class SourceCoverage:
    source_id: str
    category: str
    symbol: str | None
    exists: bool
    rows: int = 0
    period_start: str | None = None
    period_end: str | None = None
    span_days: float = 0.0
    completeness_pct: float = 0.0
    gaps_count: int = 0
    max_gap_hours: float = 0.0
    duplicates: int = 0
    suitability: dict[str, str] = field(default_factory=dict)
    blocked_research: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "category": self.category,
            "symbol": self.symbol,
            "exists": self.exists,
            "rows": self.rows,
            "period_start": self.period_start,
            "period_end": self.period_end,
            "span_days": round(self.span_days, 2),
            "completeness_pct": round(self.completeness_pct, 1),
            "gaps_count": self.gaps_count,
            "max_gap_hours": round(self.max_gap_hours, 2),
            "duplicates": self.duplicates,
            "suitability": self.suitability,
            "blocked_research": self.blocked_research,
            "notes": self.notes,
        }


def _safe(symbol: str) -> str:
    return to_swap_symbol(symbol).replace("/", "_").replace(":", "_")


def _span_from_ts(df: pd.DataFrame, ts_col: str = "ts") -> tuple[str | None, str | None, float]:
    if df.empty or ts_col not in df.columns:
        return None, None, 0.0
    ts = pd.to_numeric(df[ts_col], errors="coerce").dropna()
    if ts.empty:
        return None, None, 0.0
    t0 = int(ts.min())
    t1 = int(ts.max())
    start = pd.to_datetime(t0, unit="ms", utc=True).isoformat()
    end = pd.to_datetime(t1, unit="ms", utc=True).isoformat()
    span = (t1 - t0) / (86400 * 1000)
    return start, end, span


def _completeness(df: pd.DataFrame, expected_interval_ms: int | None, ts_col: str = "ts") -> tuple[float, int, float]:
    if df.empty or ts_col not in df.columns or not expected_interval_ms:
        return 100.0 if not df.empty else 0.0, 0, 0.0
    ts = pd.to_numeric(df[ts_col], errors="coerce").dropna().astype(np.int64).sort_values()
    if len(ts) < 2:
        return 100.0, 0, 0.0
    span = int(ts.iloc[-1]) - int(ts.iloc[0])
    expected = max(1, span // expected_interval_ms + 1)
    actual = len(ts)
    pct = min(100.0, actual / expected * 100)
    diffs = ts.diff().dropna()
    big = diffs[diffs > expected_interval_ms * 2]
    max_gap_h = float(big.max() / 3_600_000) if len(big) else 0.0
    return pct, len(big), max_gap_h


def _rate_suitability(rows: int, span_days: float, key: str) -> str:
    t = THRESHOLDS[key]
    min_count = t.get("min_rows", t.get("min_bars", 0))
    if rows >= min_count and span_days >= t["min_days"]:
        return "suitable"
    if rows == 0:
        return "missing"
    if span_days < t["min_days"] / 3:
        return "too_short"
    return "insufficient"


def _coverage_from_df(
    source_id: str,
    category: str,
    symbol: str | None,
    df: pd.DataFrame | None,
    *,
    interval_ms: int | None = None,
    research_keys: list[str],
) -> SourceCoverage:
    cov = SourceCoverage(source_id=source_id, category=category, symbol=symbol, exists=df is not None and not df.empty)
    if not cov.exists:
        cov.suitability = {k: "missing" for k in research_keys}
        cov.blocked_research = research_keys[:]
        cov.notes.append("dataset absent or empty")
        return cov

    cov.rows = len(df)
    start, end, span = _span_from_ts(df)
    cov.period_start = start
    cov.period_end = end
    cov.span_days = span
    cov.completeness_pct, gaps, max_gap_h = _completeness(df, interval_ms)
    cov.gaps_count = gaps
    cov.max_gap_hours = max_gap_h

    q = check_dataframe(df, source_id)
    cov.duplicates = q.duplicates

    for rk in research_keys:
        cov.suitability[rk] = _rate_suitability(cov.rows, cov.span_days, rk)
        if cov.suitability[rk] != "suitable":
            cov.blocked_research.append(rk)

    if q.issues:
        cov.notes.extend(q.issues[:3])
    return cov


def _ohlcv_coverage(symbol: str, timeframe: str) -> SourceCoverage:
    safe = _safe(symbol)
    path = DATA_DIR / f"{safe}_{timeframe}.csv"
    df = None
    if path.exists():
        try:
            df = pd.read_csv(path)
        except Exception:
            pass

    interval = {"5m": 5 * 60 * 1000, "3m": 3 * 60 * 1000}.get(timeframe)
    cov = _coverage_from_df(
        f"ohlcv_{safe}_{timeframe}",
        "ohlcv",
        to_swap_symbol(symbol),
        df,
        interval_ms=interval,
        research_keys=["ohlcv_discovery"],
    )
    if cov.exists and interval and cov.span_days > 0:
        expected_bars = int(cov.span_days * 86400 * 1000 / interval)
        if expected_bars > 0:
            cov.completeness_pct = min(100.0, cov.rows / expected_bars * 100)
    return cov


def _alpha_coverage(symbol: str, suffix: str, category: str, interval_ms: int | None, research_keys: list[str]) -> SourceCoverage:
    name = f"{_safe(symbol)}_{suffix}"
    df = load_archive(name)
    return _coverage_from_df(name, category, to_swap_symbol(symbol), df, interval_ms=interval_ms, research_keys=research_keys)


def build_coverage_report() -> dict[str, Any]:
    sources: list[SourceCoverage] = []

    for sym in SYMBOLS:
        for tf in ("5m", "3m"):
            sources.append(_ohlcv_coverage(sym, tf))
        sources.append(_alpha_coverage(sym, "funding", "funding", 8 * 3600 * 1000, ["funding_research"]))
        sources.append(_alpha_coverage(sym, "oi_5m", "open_interest", 5 * 60 * 1000, ["oi_research"]))
        sources.append(_alpha_coverage(sym, "liquidations", "liquidations", None, ["liquidation_research"]))
        sources.append(_alpha_coverage(sym, "orderbook", "orderbook", 2000, ["microstructure"]))
        sources.append(_alpha_coverage(sym, "trades", "trades", None, ["trades_tape"]))
        sources.append(_alpha_coverage(sym, "ticker", "ticker_bbo", 1000, ["microstructure"]))

    missing = [s for s in sources if not s.exists]
    too_short = [s for s in sources if s.exists and any(v in ("too_short", "insufficient") for v in s.suitability.values())]

    discovery_ready = all(
        any(src.source_id.endswith(f"_{_safe(sym)}_5m") and src.suitability.get("ohlcv_discovery") == "suitable" for src in sources)
        for sym in SYMBOLS
    )

    blocked: dict[str, list[str]] = {}
    for s in sources:
        for br in s.blocked_research:
            blocked.setdefault(br, []).append(s.source_id)

    retry_after_data: list[str] = []
    if not discovery_ready:
        retry_after_data.append("Discovery: ensure 12mo OHLCV for BTC/ETH/SOL on 5m")
    if any("funding_research" in s.blocked_research for s in sources):
        retry_after_data.append("Funding hypotheses: accumulate 30+ days funding archive per symbol")
    if any("oi_research" in s.blocked_research for s in sources):
        retry_after_data.append("OI hypotheses: accumulate 7+ days 5m OI per symbol")
    if any("liquidation_research" in s.blocked_research for s in sources):
        retry_after_data.append("Liquidation hypotheses: fix API + daily liquidation archive")
    if any("microstructure" in s.blocked_research for s in sources):
        retry_after_data.append("Microstructure: run daily L2/ticker collector (npm run trading:archive)")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": [s.to_dict() for s in sources],
        "summary": {
            "total_sources": len(sources),
            "present": sum(1 for s in sources if s.exists),
            "missing": len(missing),
            "too_short_or_insufficient": len(too_short),
            "discovery_ready": discovery_ready,
        },
        "missing_sources": [s.source_id for s in missing],
        "blocked_research": blocked,
        "retry_after_accumulation": retry_after_data,
    }


def save_coverage_report(report: dict[str, Any], results_dir: Path | None = None) -> Path:
    out = results_dir or (Path(__file__).resolve().parents[1] / "results")
    out.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    json_path = out / f"coverage_report_{ts}.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    (DATA_ROOT / "coverage_last.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return json_path

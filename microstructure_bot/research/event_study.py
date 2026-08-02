"""Event-based research orchestrator."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from config import Config
from collector.storage import ParquetStore
from features.absorption import detect_absorption
from research.causal import past_price_change_bps
from features.imbalance import imbalance
from features.liquidity_vacuum import detect_liquidity_vacuum
from research.backtest import validate_event_returns
from research.labeling import label_forward_returns
from research.statistics import event_study_table

log = logging.getLogger("msb.event_study")


def build_imbalance_events(orderbook: pd.DataFrame, *, threshold: float = 0.3) -> pd.DataFrame:
    if orderbook.empty:
        return pd.DataFrame()
    df = orderbook.copy()
    for lvl in (5, 10, 25):
        bcol, acol = f"bid_vol_{lvl}", f"ask_vol_{lvl}"
        if bcol in df.columns and acol in df.columns:
            df[f"imb_{lvl}"] = df.apply(lambda r: imbalance(r[bcol], r[acol]), axis=1)
    df["event"] = "none"
    if "imb_10" in df.columns:
        df.loc[df["imb_10"] >= threshold, "event"] = "imbalance_bid"
        df.loc[df["imb_10"] <= -threshold, "event"] = "imbalance_ask"
    return df[df["event"] != "none"].reset_index(drop=True)


def build_absorption_events(orderbook: pd.DataFrame, trades: pd.DataFrame, *, window_ms: int = 5000) -> pd.DataFrame:
    """Join trades aggression with short-term price stability."""
    if orderbook.empty or trades.empty:
        return pd.DataFrame()
    events: list[dict] = []
    ob = orderbook.sort_values("ts")
    for _, row in ob.iterrows():
        ts = int(row["ts"])
        window_trades = trades[(trades["ts"] >= ts - window_ms) & (trades["ts"] <= ts)]
        if window_trades.empty:
            continue
        agg = window_trades["size"].sum()
        mid_before = row.get("mid", 0)
        if not mid_before:
            continue
        ch_bps = past_price_change_bps(ob, ts, lookback_ms=1000)
        if detect_absorption(agg, ch_bps):
            events.append({"ts": ts, "inst_id": row["inst_id"], "event": "absorption", "mid": mid_before})
    return pd.DataFrame(events)


def run_event_study(config: Config, symbol: str) -> dict[str, Any]:
    store = ParquetStore(config.data_dir)
    ob = store.load("orderbook", symbol)
    trades = store.load("trades", symbol)

    if ob.empty:
        return {"error": "no orderbook data — run collector first", "symbol": symbol}

    if "mid" not in ob.columns:
        ob["mid"] = (ob["best_bid"] + ob["best_ask"]) / 2

    imb_events = build_imbalance_events(ob)
    abs_events = build_absorption_events(ob, trades) if not trades.empty else pd.DataFrame()

    results: dict[str, Any] = {"symbol": symbol, "generated_at": datetime.now(timezone.utc).isoformat(), "studies": []}

    for name, events in [("imbalance", imb_events), ("absorption", abs_events)]:
        if events.empty:
            results["studies"].append({"name": name, "events": 0, "note": "no events detected"})
            continue
        labeled = label_forward_returns(ob, events, horizons_sec=config.event_horizons_sec)
        table = event_study_table(labeled, config.event_horizons_sec)
        validations = []
        for h in config.event_horizons_sec:
            col = f"fwd_ret_{h}s"
            if col in labeled.columns:
                validations.append(validate_event_returns(labeled[col], h, holdout_pct=config.oos_holdout_pct, n_boot=config.bootstrap_samples))
        results["studies"].append(
            {
                "name": name,
                "events": len(events),
                "horizons": table,
                "validations": [v.__dict__ for v in validations],
                "accepted": any(v.accepted for v in validations),
            }
        )

    return results


def save_report(report: dict[str, Any], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = out_dir / f"event_study_{report.get('symbol', 'all')}_{ts}.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return path

"""Quantile-based unusual event detection — causal thresholds only."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from features.absorption import detect_absorption
from research.causal import EXPANDING_MIN_PERIODS, expanding_quantile, past_price_change_bps
from research.hourly_stats import enrich_orderbook

log = logging.getLogger("msb.anomaly")


EVENT_SPECS: list[dict[str, Any]] = [
    {"event": "extreme_imbalance_high", "col": "imb_10", "tail": "high"},
    {"event": "extreme_imbalance_low", "col": "imb_10", "tail": "low"},
    {"event": "depth_vanish", "col": "depth_chg_pct", "tail": "low"},
    {"event": "spread_expand", "col": "spread_bps", "tail": "high"},
    {"event": "spread_compress", "col": "spread_bps", "tail": "low"},
    {"event": "aggressive_buy_surge", "col": "buy_aggression", "tail": "high"},
    {"event": "aggressive_sell_surge", "col": "sell_aggression", "tail": "high"},
    {"event": "delta_surge", "col": "rolling_delta", "tail": "high"},
    {"event": "delta_dump", "col": "rolling_delta", "tail": "low"},
]


def prepare_features(ob: pd.DataFrame, trades: pd.DataFrame) -> pd.DataFrame:
    df = enrich_orderbook(ob)
    if not trades.empty:
        tr = trades.sort_values("ts").reset_index(drop=True)
        buy_sz = np.where(tr["side"] == "buy", tr["size"], 0.0)
        sell_sz = np.where(tr["side"] == "sell", tr["size"], 0.0)
        tr = tr.copy()
        tr["buy_aggression"] = pd.Series(buy_sz).rolling(50, min_periods=1).sum().values
        tr["sell_aggression"] = pd.Series(sell_sz).rolling(50, min_periods=1).sum().values
        tr["signed"] = tr["size"].where(tr["side"] == "buy", -tr["size"])
        tr["rolling_delta"] = tr["signed"].rolling(100, min_periods=1).sum()
        merged = pd.merge_asof(
            df.sort_values("ts"),
            tr[["ts", "buy_aggression", "sell_aggression", "rolling_delta"]].sort_values("ts"),
            on="ts",
            direction="backward",
        )
        df = merged
    else:
        df["buy_aggression"] = 0.0
        df["sell_aggression"] = 0.0
        df["rolling_delta"] = 0.0

    df["absorption_flag"] = 0
    if not trades.empty:
        step = max(1, len(df) // 200)
        for i in range(0, len(df), step):
            row = df.iloc[i]
            ts = int(row["ts"])
            w = trades[(trades["ts"] >= ts - 3000) & (trades["ts"] <= ts)]
            if w.empty:
                continue
            ch = past_price_change_bps(df, ts, lookback_ms=1000)
            if detect_absorption(float(w["size"].sum()), ch):
                df.at[df.index[i], "absorption_flag"] = 1

    if "depth_chg_pct" in df.columns:
        abs_d = df["depth_chg_pct"].abs()
        thr = abs_d.expanding(min_periods=EXPANDING_MIN_PERIODS).quantile(0.95).shift(1)
        df["sweep_proxy"] = (abs_d > thr).fillna(False).astype(int)
        df["replenish_proxy"] = (
            (df["depth_chg_pct"] > 0) & (df["depth_chg_pct"].shift(1) < -5)
        ).astype(int)
    else:
        df["sweep_proxy"] = 0
        df["replenish_proxy"] = 0

    return df


def detect_quantile_events(
    df: pd.DataFrame,
    *,
    quantiles: tuple[float, ...] = (0.99, 0.95, 0.90),
    min_gap_ms: int = 5000,
    min_periods: int = EXPANDING_MIN_PERIODS,
) -> pd.DataFrame:
    """Detect events using expanding quantiles — threshold at t uses only rows before t."""
    events: list[dict] = []
    specs = EVENT_SPECS + [
        {"event": "absorption_strong", "col": "absorption_flag", "tail": "high", "fixed_thr": 0.5},
        {"event": "sweep_series", "col": "sweep_proxy", "tail": "high", "fixed_thr": 0.5},
        {"event": "replenishment_fast", "col": "replenish_proxy", "tail": "high", "fixed_thr": 0.5},
    ]

    for spec in specs:
        col = spec["col"]
        if col not in df.columns:
            continue
        series = df[col].replace([np.inf, -np.inf], np.nan)

        if "fixed_thr" in spec:
            mask = series >= spec["fixed_thr"]
            q_label = "flag"
            for idx in df[mask.fillna(False)].index:
                events.append(_event_row(df.loc[idx], spec["event"], q_label, col=col))
            continue

        for q in quantiles:
            if spec["tail"] == "high":
                thr_series = expanding_quantile(series, q, min_periods=min_periods).shift(1)
                mask = (series >= thr_series).fillna(False)
                q_label = f"q{int(q * 100)}"
            else:
                thr_series = expanding_quantile(series, 1 - q, min_periods=min_periods).shift(1)
                mask = (series <= thr_series).fillna(False)
                q_label = f"q{int((1 - q) * 100)}"

            subset = df[mask].sort_values("ts")
            last_ts = -10**15
            for idx, row in subset.iterrows():
                ts = int(row["ts"])
                if ts - last_ts < min_gap_ms:
                    continue
                last_ts = ts
                thr_val = float(thr_series.loc[idx]) if pd.notna(thr_series.loc[idx]) else 0.0
                events.append(_event_row(row, spec["event"], q_label, threshold=thr_val, col=col))

    if not events:
        return pd.DataFrame()
    out = pd.DataFrame(events).drop_duplicates(subset=["ts", "event", "quantile"]).sort_values("ts")
    return out.reset_index(drop=True)


def _event_row(row: pd.Series, event: str, quantile: str, threshold: float = 0.0, col: str = "") -> dict:
    fv = float(row.get(col, row.get("imb_10", 0))) if col else 0.0
    return {
        "ts": int(row["ts"]),
        "inst_id": row.get("inst_id", ""),
        "event": event,
        "quantile": quantile,
        "threshold": threshold,
        "mid": float(row.get("mid", 0)),
        "feature_value": fv,
    }

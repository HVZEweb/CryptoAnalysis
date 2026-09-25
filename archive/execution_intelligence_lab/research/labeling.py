"""Forward return labeling for event study."""

from __future__ import annotations

import pandas as pd

from config import Config


def round_trip_cost_pct(config: Config) -> float:
    return (config.taker_fee_bps * 2 + config.slippage_bps * 2) / 100.0


def label_forward_returns(
    prices: pd.DataFrame,
    events: pd.DataFrame,
    *,
    horizons_sec: tuple[int, ...],
) -> pd.DataFrame:
    if events.empty or prices.empty:
        return pd.DataFrame()

    px = prices.sort_values("ts").reset_index(drop=True)
    ts_arr = px["ts"].values
    mid_arr = px["mid"].values
    labeled = events.copy()

    for h in horizons_sec:
        h_ms = h * 1000
        rets = []
        for ts in labeled["ts"].values:
            idx = ts_arr.searchsorted(ts)
            fwd_idx = ts_arr.searchsorted(ts + h_ms)
            if idx >= len(mid_arr) or fwd_idx >= len(mid_arr) or fwd_idx <= idx:
                rets.append(0.0)
                continue
            m0 = mid_arr[idx]
            m1 = mid_arr[fwd_idx]
            rets.append((m1 - m0) / (m0 + 1e-12) * 100.0)
        labeled[f"fwd_ret_{h}s"] = rets

    return labeled


def apply_net_returns(labeled: pd.DataFrame, config: Config, horizons: tuple[int, ...]) -> pd.DataFrame:
    cost = round_trip_cost_pct(config)
    out = labeled.copy()
    for h in horizons:
        g = f"fwd_ret_{h}s"
        if g in out.columns:
            out[f"net_fwd_ret_{h}s"] = out[g] - cost
    return out

"""Forward return labeling at multiple horizons."""

from __future__ import annotations

import pandas as pd


def round_trip_cost_pct(config) -> float:
    """Taker round-trip + slippage both sides, in percent."""
    return (2 * config.taker_fee_bps + 2 * config.slippage_bps) / 100


def apply_net_returns(labeled: pd.DataFrame, config, horizons: tuple[int, ...]) -> pd.DataFrame:
    cost = round_trip_cost_pct(config)
    out = labeled.copy()
    for h in horizons:
        col = f"fwd_ret_{h}s"
        if col in out.columns:
            out[f"net_{col}"] = out[col] - cost
    return out


def label_forward_returns(
    prices: pd.DataFrame,
    events: pd.DataFrame,
    *,
    ts_col: str = "ts",
    price_col: str = "mid",
    horizons_sec: tuple[int, ...] = (1, 5, 15, 30, 60, 300),
) -> pd.DataFrame:
    """
    For each event timestamp, compute forward return at each horizon.
    prices must be sorted by ts with mid/best_bid column.
    """
    if events.empty or prices.empty:
        return events.copy()

    px = prices[[ts_col, price_col]].dropna().sort_values(ts_col).reset_index(drop=True)
    ts_arr = px[ts_col].values
    mid_arr = px[price_col].values
    out = events.copy()

    for h in horizons_sec:
        h_ms = h * 1000
        col = f"fwd_ret_{h}s"
        rets: list[float] = []
        for ets in out[ts_col].values:
            idx = ts_arr.searchsorted(ets)
            if idx >= len(ts_arr):
                rets.append(float("nan"))
                continue
            p0 = mid_arr[idx]
            target_ts = ets + h_ms
            idx1 = ts_arr.searchsorted(target_ts)
            if idx1 >= len(ts_arr) or p0 <= 0:
                rets.append(float("nan"))
                continue
            p1 = mid_arr[idx1]
            rets.append((p1 - p0) / p0 * 100)
        out[col] = rets

    return out

"""Feature engineering helpers for alpha modules."""

from __future__ import annotations

import numpy as np
import pandas as pd


def align_series_to_ohlcv(ohlcv: pd.DataFrame, aux: pd.DataFrame, value_col: str) -> pd.Series:
    """Forward-fill auxiliary series onto OHLCV timestamps."""
    if aux is None or aux.empty or value_col not in aux.columns:
        return pd.Series(np.nan, index=ohlcv.index)
    left = ohlcv[["ts"]].copy()
    right = aux[["ts", value_col]].dropna().sort_values("ts")
    merged = pd.merge_asof(left, right, on="ts", direction="backward")
    return merged[value_col]


def pct_change(series: pd.Series, periods: int = 1) -> pd.Series:
    return series.pct_change(periods=periods) * 100


def rolling_zscore(series: pd.Series, window: int = 48) -> pd.Series:
    mean = series.rolling(window, min_periods=window // 2).mean()
    std = series.rolling(window, min_periods=window // 2).std()
    return (series - mean) / std.replace(0, np.nan)


def realised_volatility(close: pd.Series, window: int = 48) -> pd.Series:
    ret = close.pct_change()
    return ret.rolling(window, min_periods=window // 2).std() * np.sqrt(window) * 100


def true_range_pct(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev = close.shift(1)
    tr = pd.concat([(high - low), (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)
    return tr / close * 100


def session_label(ts_ms: pd.Series) -> pd.Series:
    """UTC session buckets."""
    hours = pd.to_datetime(ts_ms, unit="ms", utc=True).dt.hour
    labels = pd.Series("off_hours", index=ts_ms.index)
    labels[(hours >= 0) & (hours < 8)] = "asia"
    labels[(hours >= 8) & (hours < 13)] = "europe"
    labels[(hours >= 13) & (hours < 21)] = "us"
    labels[(hours >= 7) & (hours < 9)] = "asia_europe_overlap"
    labels[(hours >= 12) & (hours < 14)] = "europe_us_overlap"
    return labels


def day_of_week(ts_ms: pd.Series) -> pd.Series:
    return pd.to_datetime(ts_ms, unit="ms", utc=True).dt.dayofweek


def hour_of_day(ts_ms: pd.Series) -> pd.Series:
    return pd.to_datetime(ts_ms, unit="ms", utc=True).dt.hour


def funding_window_proximity(ts_ms: pd.Series, interval_hours: int = 8) -> pd.Series:
    """Minutes to nearest funding settlement (8h UTC cycles)."""
    dt = pd.to_datetime(ts_ms, unit="ms", utc=True)
    hours = dt.dt.hour + dt.dt.minute / 60
    cycle = interval_hours
    mod = hours % cycle
    dist = pd.Series(np.minimum(mod, cycle - mod) * 60, index=ts_ms.index)
    return dist


def cross_asset_lead_signal(
    leader_close: pd.Series,
    follower_close: pd.Series,
    *,
    lag_bars: int = 3,
    threshold_pct: float = 0.15,
) -> pd.Series:
    """Leader moved, follower hasn't — potential lead-lag."""
    leader_ret = leader_close.pct_change(lag_bars) * 100
    follower_ret = follower_close.pct_change(lag_bars) * 100
    signal = pd.Series(0, index=leader_close.index)
    signal[(leader_ret > threshold_pct) & (follower_ret < threshold_pct * 0.5)] = 1
    signal[(leader_ret < -threshold_pct) & (follower_ret > -threshold_pct * 0.5)] = -1
    return signal

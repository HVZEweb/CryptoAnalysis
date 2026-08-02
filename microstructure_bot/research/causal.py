"""Causal-only research helpers — information at t uses data strictly before t."""

from __future__ import annotations

import pandas as pd

RESEARCH_METHODOLOGY_VERSION = "2.0"
EXPANDING_MIN_PERIODS = 100


def split_by_time(df: pd.DataFrame, holdout_pct: float, *, ts_col: str = "ts") -> tuple[pd.DataFrame, pd.DataFrame]:
    if df.empty:
        return df.copy(), df.copy()
    ordered = df.sort_values(ts_col).reset_index(drop=True)
    cut = max(1, int(len(ordered) * (1 - holdout_pct)))
    if cut >= len(ordered):
        cut = max(1, len(ordered) - 1)
    return ordered.iloc[:cut].reset_index(drop=True), ordered.iloc[cut:].reset_index(drop=True)


def expanding_quantile(series: pd.Series, q: float, *, min_periods: int = EXPANDING_MIN_PERIODS) -> pd.Series:
    return series.expanding(min_periods=min_periods).quantile(q)


def causal_high_tail_mask(series: pd.Series, q: float, *, min_periods: int = EXPANDING_MIN_PERIODS) -> pd.Series:
    thr = expanding_quantile(series, q, min_periods=min_periods).shift(1)
    return series >= thr


def causal_low_tail_mask(series: pd.Series, q: float, *, min_periods: int = EXPANDING_MIN_PERIODS) -> pd.Series:
    thr = expanding_quantile(series, 1 - q, min_periods=min_periods).shift(1)
    return series <= thr


def past_price_change_bps(df: pd.DataFrame, ts: int, *, lookback_ms: int = 1000) -> float:
    """Mid change from lookback_ms ago to ts (no future mids)."""
    hist = df[df["ts"] <= ts].sort_values("ts")
    if hist.empty:
        return 0.0
    mid = float(hist.iloc[-1].get("mid", 0))
    if not mid:
        return 0.0
    past = hist[hist["ts"] >= ts - lookback_ms]
    if past.empty:
        return 0.0
    mid0 = float(past.iloc[0].get("mid", 0))
    if not mid0:
        return 0.0
    return (mid - mid0) / mid0 * 10_000


def select_best_horizon_train(
    labeled: pd.DataFrame,
    horizons_sec: tuple[int, ...] | list[int],
    holdout_pct: float,
) -> int:
    from research.statistics import event_study_table

    train, _ = split_by_time(labeled, holdout_pct)
    if train.empty:
        return horizons_sec[0]
    table = event_study_table(train, tuple(horizons_sec))
    if not table:
        return horizons_sec[0]
    best = max(table, key=lambda h: h.get("expectancy_pct", -999))
    return int(best.get("horizon_sec", horizons_sec[0]))

"""Causal-only research helpers for Execution Intelligence Lab."""

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


def causal_threshold_series(series: pd.Series, q: float, *, high_tail: bool, min_periods: int = EXPANDING_MIN_PERIODS) -> pd.Series:
    q_val = q if high_tail else (1 - q)
    return expanding_quantile(series, q_val, min_periods=min_periods).shift(1)


def causal_quantile_column(features: pd.DataFrame, col: str, q: float, *, high_tail: bool = True) -> pd.Series:
    s = features[col].astype(float)
    thr = causal_threshold_series(s, q, high_tail=high_tail)
    if high_tail:
        return s >= thr
    return s <= thr

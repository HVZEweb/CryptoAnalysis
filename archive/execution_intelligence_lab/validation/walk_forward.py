"""Walk-forward and out-of-sample splits."""

from __future__ import annotations

import pandas as pd


def chronological_split(df: pd.DataFrame, holdout_pct: float = 0.25) -> tuple[pd.DataFrame, pd.DataFrame]:
    if df.empty:
        return df, df
    if "ts" in df.columns:
        df = df.sort_values("ts").reset_index(drop=True)
    n = len(df)
    cut = max(1, int(n * (1 - holdout_pct)))
    if cut >= n:
        cut = max(1, n - 1)
    return df.iloc[:cut].reset_index(drop=True), df.iloc[cut:].reset_index(drop=True)


def walk_forward_stable(train_ev: float, test_ev: float, *, min_test: float = 0.0) -> bool:
    return train_ev > 0 and test_ev >= min_test and test_ev >= train_ev * 0.5

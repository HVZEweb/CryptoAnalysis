"""Volume delta and cumulative delta from trade tape."""

from __future__ import annotations

import pandas as pd


def volume_delta(trades: pd.DataFrame) -> float:
    if trades.empty or "side" not in trades.columns:
        return 0.0
    buy = trades.loc[trades["side"] == "buy", "size"].sum()
    sell = trades.loc[trades["side"] == "sell", "size"].sum()
    return float(buy - sell)


def cumulative_delta(trades: pd.DataFrame) -> pd.Series:
    if trades.empty:
        return pd.Series(dtype=float)
    signed = trades["size"].where(trades["side"] == "buy", -trades["size"])
    return signed.cumsum()


def aggression_ratio(trades: pd.DataFrame) -> tuple[float, float]:
    if trades.empty:
        return 0.0, 0.0
    buy = float(trades.loc[trades["side"] == "buy", "size"].sum())
    sell = float(trades.loc[trades["side"] == "sell", "size"].sum())
    return buy, sell

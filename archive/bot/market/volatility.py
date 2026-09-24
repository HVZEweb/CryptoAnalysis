"""Volatility metrics."""

from __future__ import annotations

import pandas as pd

from market.indicators import atr


def atr_pct(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> float:
    if len(close) < length + 1:
        return 0.0
    val = float(atr(high, low, close, length).iloc[-1])
    price = float(close.iloc[-1])
    return (val / price) * 100 if price > 0 else 0.0


def realized_volatility(close: pd.Series, window: int = 20) -> float:
    if len(close) < window + 1:
        return 0.0
    returns = close.pct_change().dropna().tail(window)
    return float(returns.std() * 100)


def volatility_regime(atr_pct_val: float) -> str:
    if atr_pct_val >= 1.5:
        return "high"
    if atr_pct_val <= 0.4:
        return "low"
    return "normal"

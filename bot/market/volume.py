"""Volume analysis."""

from __future__ import annotations

import pandas as pd


def volume_spike(volume: pd.Series, window: int = 20, multiplier: float = 2.0) -> bool:
    if len(volume) < window + 1:
        return False
    ma = float(volume.rolling(window).mean().iloc[-1])
    last = float(volume.iloc[-1])
    return ma > 0 and last > ma * multiplier


def volume_delta_proxy(close: pd.Series, volume: pd.Series) -> float:
    """Signed volume delta approximation from candle direction."""
    if len(close) < 2:
        return 0.0
    direction = 1.0 if close.iloc[-1] >= close.iloc[-2] else -1.0
    return direction * float(volume.iloc[-1])

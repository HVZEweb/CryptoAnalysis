"""Technical indicators for quant and AI strategies."""

from __future__ import annotations

import pandas as pd


def ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=length, adjust=False).mean()


def rsi(series: pd.Series, length: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, 1e-10)
    return 100 - (100 / (1 + rs))


def atr(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low).abs(), (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()


def vwap(close: pd.Series, volume: pd.Series) -> pd.Series:
    vol = volume.replace(0, 1e-10)
    return (close * vol).cumsum() / vol.cumsum()


def adx(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    up = high.diff()
    down = -low.diff()
    plus_dm = up.where((up > down) & (up > 0), 0.0)
    minus_dm = down.where((down > up) & (down > 0), 0.0)
    tr = atr(high, low, close, length)
    plus_di = 100 * (plus_dm.ewm(alpha=1 / length, adjust=False).mean() / tr.replace(0, 1e-10))
    minus_di = 100 * (minus_dm.ewm(alpha=1 / length, adjust=False).mean() / tr.replace(0, 1e-10))
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, 1e-10)
    return dx.ewm(alpha=1 / length, adjust=False).mean()


def bollinger(close: pd.Series, length: int = 20, std_mult: float = 2.0) -> tuple[pd.Series, pd.Series, pd.Series]:
    mid = close.rolling(length).mean()
    std = close.rolling(length).std()
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    return upper, mid, lower

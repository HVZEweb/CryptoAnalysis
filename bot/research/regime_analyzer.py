"""Extended market regime labeling for forensic research."""

from __future__ import annotations

import pandas as pd

from core.config import MarketRegime
from market import indicators as ind
from market.volatility import atr_pct, volatility_regime


def label_regime_at_bar(df: pd.DataFrame, idx: int) -> str:
    if idx < 30 or idx >= len(df):
        return MarketRegime.UNKNOWN.value

    window = df.iloc[max(0, idx - 50) : idx + 1]
    close = window["close"].astype(float)
    high = window["high"].astype(float)
    low = window["low"].astype(float)

    atr_val = atr_pct(high, low, close)
    vol_reg = volatility_regime(atr_val)

    if vol_reg == "high":
        return MarketRegime.HIGH_VOLATILITY.value

    ema9 = ind.ema(close, 9)
    ema21 = ind.ema(close, 21)
    if len(ema9) < 2:
        return MarketRegime.UNKNOWN.value

    spread = abs(float(ema9.iloc[-1]) - float(ema21.iloc[-1])) / float(close.iloc[-1]) * 100
    if spread > 0.15:
        return MarketRegime.TRENDING.value
    if spread < 0.04:
        return MarketRegime.FLAT.value
    return MarketRegime.UNKNOWN.value


def classify_trend_strength(df: pd.DataFrame, idx: int) -> str:
    if idx < 30:
        return "unknown"
    window = df.iloc[max(0, idx - 50) : idx + 1]
    close = window["close"].astype(float)
    ema9 = ind.ema(close, 9)
    ema21 = ind.ema(close, 21)
    if len(ema9) < 2:
        return "unknown"
    spread = abs(float(ema9.iloc[-1]) - float(ema21.iloc[-1])) / float(close.iloc[-1]) * 100
    if spread > 0.25:
        return "strong_trend"
    if spread > 0.08:
        return "weak_trend"
    if spread < 0.04:
        return "flat"
    return "neutral"


def classify_volatility(df: pd.DataFrame, idx: int) -> str:
    if idx < 20:
        return "unknown"
    window = df.iloc[max(0, idx - 50) : idx + 1]
    atr_val = atr_pct(
        window["high"].astype(float),
        window["low"].astype(float),
        window["close"].astype(float),
    )
    return "high_volatility" if volatility_regime(atr_val) == "high" else "low_volatility"


def classify_liquidity(df: pd.DataFrame, idx: int) -> str:
    if idx < 25:
        return "unknown"
    vol = float(df.iloc[idx].get("volume", 0))
    vol_ma = df["volume"].astype(float).iloc[max(0, idx - 20) : idx + 1].mean()
    if vol_ma <= 0:
        return "unknown"
    ratio = vol / vol_ma
    return "high_liquidity" if ratio >= 1.2 else "low_liquidity"


def classify_impulse(df: pd.DataFrame, idx: int, *, lookback: int = 6) -> str:
    if idx < lookback + 1:
        return "unknown"
    start = float(df.iloc[idx - lookback]["close"])
    end = float(df.iloc[idx]["close"])
    if start <= 0:
        return "unknown"
    move_pct = abs(end - start) / start * 100
    return "sharp_impulse" if move_pct >= 1.0 else "normal"


def classify_regimes_at_bar(df: pd.DataFrame, idx: int) -> dict[str, str]:
    return {
        "regime": label_regime_at_bar(df, idx),
        "trend_regime": classify_trend_strength(df, idx),
        "volatility_regime": classify_volatility(df, idx),
        "liquidity_regime": classify_liquidity(df, idx),
        "impulse_regime": classify_impulse(df, idx),
    }


def segment_by_regime(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Split dataframe into contiguous regime segments."""
    if len(df) < 60:
        return {"unknown": df}

    labels = [label_regime_at_bar(df, i) for i in range(len(df))]
    segments: dict[str, list[pd.DataFrame]] = {}
    current_regime = labels[0]
    start = 0

    for i, regime in enumerate(labels[1:], 1):
        if regime != current_regime:
            chunk = df.iloc[start:i].copy()
            segments.setdefault(current_regime, []).append(chunk)
            start = i
            current_regime = regime

    segments.setdefault(current_regime, []).append(df.iloc[start:].copy())

    merged: dict[str, pd.DataFrame] = {}
    for regime, chunks in segments.items():
        if chunks:
            merged[regime] = pd.concat(chunks, ignore_index=True)
    return merged

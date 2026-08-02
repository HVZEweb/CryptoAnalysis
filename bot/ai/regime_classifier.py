"""Market regime classifier."""

from __future__ import annotations

import pandas as pd

from core.config import MarketRegime
from exchange.okx_rest import OKXRestClient, to_swap_symbol
from market.volatility import atr_pct, volatility_regime


class RegimeClassifier:
    async def classify(self, symbol: str, rest: OKXRestClient) -> MarketRegime:
        swap = to_swap_symbol(symbol)
        ohlcv = await rest.fetch_ohlcv(swap, "5m", 60)
        if len(ohlcv) < 30:
            return MarketRegime.UNKNOWN

        df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
        for col in ("close", "high", "low"):
            df[col] = df[col].astype(float)

        atr_val = atr_pct(df["high"], df["low"], df["close"])
        vol_reg = volatility_regime(atr_val)
        ema_fast = df["close"].ewm(span=9).mean().iloc[-1]
        ema_slow = df["close"].ewm(span=21).mean().iloc[-1]
        trend = abs(ema_fast - ema_slow) / df["close"].iloc[-1] * 100

        if vol_reg == "high":
            return MarketRegime.HIGH_VOLATILITY
        if trend > 0.5:
            return MarketRegime.TRENDING
        if vol_reg == "low":
            return MarketRegime.FLAT
        return MarketRegime.UNKNOWN

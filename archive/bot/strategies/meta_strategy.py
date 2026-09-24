"""Meta strategy — selects best strategy for current market regime."""

from __future__ import annotations

import logging

import pandas as pd

from core.config import MarketRegime, Settings, StrategyName, get_settings
from core.models import TradeIntent
from market.volatility import atr_pct, volatility_regime
from strategies.ai_predictor.strategy import AIPredictorStrategy
from strategies.base import ScanCandidate, Strategy, StrategyContext
from strategies.hft_orderbook.strategy import HFTOrderbookStrategy
from strategies.quant_scalping.strategy import QuantScalpingStrategy

log = logging.getLogger("trading_bot.strategy.meta")


class MetaStrategy(Strategy):
    name = "meta"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._strategies: dict[str, Strategy] = {
            StrategyName.HFT_ORDERBOOK.value: HFTOrderbookStrategy(self.settings),
            StrategyName.QUANT_SCALPING.value: QuantScalpingStrategy(self.settings),
            StrategyName.AI_PREDICTOR.value: AIPredictorStrategy(self.settings),
        }

    def _enabled(self) -> list[Strategy]:
        return [self._strategies[n.value] for n in self.settings.enabled_strategies if n.value in self._strategies]

    async def detect_regime(self, ctx: StrategyContext, symbol: str) -> MarketRegime:
        try:
            ohlcv = await ctx.rest.fetch_ohlcv(symbol, "5m", 60)
            if len(ohlcv) < 30:
                return MarketRegime.UNKNOWN
            df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
            for col in ("close", "high", "low"):
                df[col] = df[col].astype(float)
            atr_val = atr_pct(df["high"], df["low"], df["close"])
            vol_reg = volatility_regime(atr_val)
            ema_fast = df["close"].ewm(span=9).mean().iloc[-1]
            ema_slow = df["close"].ewm(span=21).mean().iloc[-1]
            trend_strength = abs(ema_fast - ema_slow) / df["close"].iloc[-1] * 100

            if vol_reg == "high":
                return MarketRegime.HIGH_VOLATILITY
            if trend_strength > 0.5:
                return MarketRegime.TRENDING
            if vol_reg == "low":
                return MarketRegime.FLAT
            return MarketRegime.UNKNOWN
        except Exception:
            return MarketRegime.UNKNOWN

    def _pick_strategy(self, regime: MarketRegime) -> Strategy:
        if regime == MarketRegime.HIGH_VOLATILITY:
            return self._strategies[StrategyName.HFT_ORDERBOOK.value]
        if regime == MarketRegime.FLAT:
            return self._strategies[StrategyName.QUANT_SCALPING.value]
        if regime == MarketRegime.TRENDING:
            return self._strategies[StrategyName.QUANT_SCALPING.value]
        return self._strategies[StrategyName.AI_PREDICTOR.value]

    async def scan(self, ctx: StrategyContext) -> list[ScanCandidate]:
        merged: dict[str, ScanCandidate] = {}
        for strat in self._enabled():
            for c in await strat.scan(ctx):
                prev = merged.get(c.symbol)
                if not prev or c.score > prev.score:
                    merged[c.symbol] = c
        out = sorted(merged.values(), key=lambda c: c.score, reverse=True)
        return out[: self.settings.trading_top_pairs]

    async def should_enter(self, ctx: StrategyContext, symbol: str) -> bool:
        return (await self.build_trade(ctx, symbol)) is not None

    async def build_trade(self, ctx: StrategyContext, symbol: str) -> TradeIntent | None:
        regime = await self.detect_regime(ctx, symbol)
        strat = self._pick_strategy(regime)
        intent = await strat.build_trade(ctx, symbol)
        if intent:
            intent.signals["meta_regime"] = regime.value
            intent.signals["selected_strategy"] = strat.name
            log.info("Meta selected %s for %s regime=%s", strat.name, symbol, regime.value)
        return intent

    async def manage_position(self, ctx: StrategyContext, symbol: str) -> str | None:
        return None

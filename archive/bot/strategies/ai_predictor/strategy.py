"""AI predictor strategy — probability filter and directional entries."""

from __future__ import annotations

import logging

from ai.predictor import AIPredictor
from core.config import Settings, get_settings
from exchange.okx_rest import to_swap_symbol
from core.models import TradeIntent
from strategies.base import ScanCandidate, Strategy, StrategyContext

log = logging.getLogger("trading_bot.strategy.ai")


class AIPredictorStrategy(Strategy):
    name = "ai_predictor"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.predictor = AIPredictor(self.settings)

    async def scan(self, ctx: StrategyContext) -> list[ScanCandidate]:
        candidates: list[ScanCandidate] = []
        symbols = [c.symbol for c in ctx.universe] or ctx.rest.list_usdt_swap_symbols()[:15]
        for sym in symbols[:10]:
            try:
                prob = await self.predictor.predict_direction(sym, ctx.rest)
                if prob is None:
                    continue
                ticker = await ctx.rest.fetch_ticker(sym)
                candidates.append(
                    ScanCandidate(
                        symbol=to_swap_symbol(sym),
                        score=prob["confidence"],
                        volume_24h=ticker.volume_24h,
                        spread_pct=ticker.spread_pct,
                        reason=prob.get("direction", ""),
                    )
                )
                ctx.ai_filter[to_swap_symbol(sym)] = prob["confidence"]
            except Exception as e:
                log.debug("ai scan %s: %s", sym, e)
        candidates.sort(key=lambda c: c.score, reverse=True)
        return candidates

    async def should_enter(self, ctx: StrategyContext, symbol: str) -> bool:
        return (await self.build_trade(ctx, symbol)) is not None

    async def build_trade(self, ctx: StrategyContext, symbol: str) -> TradeIntent | None:
        swap = to_swap_symbol(symbol)
        if ctx.order_manager.has_position(swap):
            return None

        prob = await self.predictor.predict_direction(swap, ctx.rest)
        if not prob or prob["confidence"] < self.settings.trading_ai_min_confidence:
            return None

        direction = prob.get("direction", "SIDEWAYS")
        if direction == "SIDEWAYS":
            return None

        ticker = await ctx.rest.fetch_ticker(swap)
        price = ticker.last
        move_pct = abs(float(prob.get("expected_move_pct", 0.3)))
        side = "long" if direction == "LONG" else "short"
        sl = price * (1 - move_pct / 100) if side == "long" else price * (1 + move_pct / 100)
        tp = price * (1 + move_pct * 1.5 / 100) if side == "long" else price * (1 - move_pct * 1.5 / 100)
        ev = self.settings.trading_notional_usd * move_pct / 100 * (prob["confidence"] / 100)

        return TradeIntent(
            symbol=swap,
            side=side,
            strategy=self.name,
            entry_price=price,
            stop_loss=sl,
            take_profit=tp,
            confidence=prob["confidence"],
            expected_value=ev,
            use_limit=False,
            signals=prob,
            ai_probability=prob["confidence"],
        )

    async def manage_position(self, ctx: StrategyContext, symbol: str) -> str | None:
        return None

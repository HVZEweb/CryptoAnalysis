"""Quant scalping + mean reversion for futures."""

from __future__ import annotations

import logging

import pandas as pd

from core.config import Settings, get_settings
from exchange.okx_rest import to_swap_symbol
from core.models import TradeIntent
from market import indicators as ind
from market.volatility import atr_pct
from strategies.base import ScanCandidate, Strategy, StrategyContext

log = logging.getLogger("trading_bot.strategy.quant")


class QuantScalpingStrategy(Strategy):
    name = "quant_scalping"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    async def scan(self, ctx: StrategyContext) -> list[ScanCandidate]:
        out: list[ScanCandidate] = []
        for sym in [c.symbol for c in ctx.universe] or ctx.rest.list_usdt_swap_symbols()[:20]:
            try:
                ohlcv = await ctx.rest.fetch_ohlcv(sym, "5m", 60)
                if len(ohlcv) < 30:
                    continue
                df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
                for col in df.columns[1:]:
                    df[col] = df[col].astype(float)
                atr_val = atr_pct(df["high"], df["low"], df["close"])
                score = 50.0
                if atr_val < 1.5:
                    score += 20
                ema9 = ind.ema(df["close"], 9).iloc[-1]
                ema21 = ind.ema(df["close"], 21).iloc[-1]
                if abs(ema9 - ema21) / df["close"].iloc[-1] * 100 < 0.3:
                    score += 15
                ticker = await ctx.rest.fetch_ticker(sym)
                out.append(
                    ScanCandidate(sym, score, ticker.volume_24h, ticker.spread_pct, "quant scan")
                )
            except Exception as e:
                log.debug("quant scan %s: %s", sym, e)
        out.sort(key=lambda c: c.score, reverse=True)
        return out[: self.settings.trading_top_pairs]

    async def should_enter(self, ctx: StrategyContext, symbol: str) -> bool:
        return (await self.build_trade(ctx, symbol)) is not None

    async def build_trade(self, ctx: StrategyContext, symbol: str) -> TradeIntent | None:
        swap = to_swap_symbol(symbol)
        if ctx.order_manager.has_position(swap):
            return None

        ohlcv = await ctx.rest.fetch_ohlcv(swap, "5m", 100)
        if len(ohlcv) < 50:
            return None

        df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
        for col in ("close", "volume", "high", "low", "open"):
            df[col] = df[col].astype(float)

        df["ema9"] = ind.ema(df["close"], 9)
        df["ema21"] = ind.ema(df["close"], 21)
        df["rsi"] = ind.rsi(df["close"], 14)
        df["atr"] = ind.atr(df["high"], df["low"], df["close"], 14)
        upper, mid_bb, lower = ind.bollinger(df["close"])

        last = df.iloc[-1]
        price = float(last["close"])
        rsi = float(last["rsi"]) if pd.notna(last["rsi"]) else 50
        ema_bull = float(last["ema9"]) > float(last["ema21"])

        book = await ctx.rest.fetch_order_book(swap, 20)
        if book.spread_pct > self.settings.trading_max_spread_pct:
            return None

        side: str | None = None
        reasons: list[str] = []
        mode = "trend"

        if ema_bull and rsi < self.settings.trading_rsi_low:
            side = "long"
            reasons.append("EMA trend + RSI oversold")
        elif not ema_bull and rsi > self.settings.trading_rsi_high:
            side = "short"
            reasons.append("EMA bear + RSI overbought")
        elif float(last["close"]) < float(lower.iloc[-1]):
            side = "long"
            mode = "mean_reversion"
            reasons.append("Bollinger lower band")
        elif float(last["close"]) > float(upper.iloc[-1]):
            side = "short"
            mode = "mean_reversion"
            reasons.append("Bollinger upper band")

        if not side:
            return None

        sl_pct = self.settings.trading_sl_pct
        tp_pct = self.settings.trading_tp_pct
        sl = price * (1 - sl_pct / 100) if side == "long" else price * (1 + sl_pct / 100)
        tp = price * (1 + tp_pct / 100) if side == "long" else price * (1 - tp_pct / 100)
        rr = tp_pct / sl_pct
        ev = self.settings.trading_notional_usd * (tp_pct - sl_pct * 0.5) / 100

        ai_prob = ctx.ai_filter.get(swap)
        if ai_prob is not None and ai_prob < self.settings.trading_ai_min_confidence:
            return None

        confidence = 60 + (10 if rr >= 1.5 else 0) + (10 if mode == "mean_reversion" else 5)

        return TradeIntent(
            symbol=swap,
            side=side,
            strategy=self.name,
            entry_price=price,
            stop_loss=sl,
            take_profit=tp,
            confidence=confidence,
            expected_value=ev,
            use_limit=False,
            signals={"mode": mode, "rsi": rsi, "reasons": reasons, "rr": rr},
            ai_probability=ai_prob,
        )

    async def manage_position(self, ctx: StrategyContext, symbol: str) -> str | None:
        return None

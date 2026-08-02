"""HFT orderbook strategy — density walls, imbalance, EV scoring."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from core.config import Settings, get_settings
from core.models import TradeIntent
from exchange.okx_rest import to_swap_symbol
from market.orderbook import BookSnapshot, OrderBookLevel, analyze_spike_entry, parse_levels
from strategies.base import ScanCandidate, Strategy, StrategyContext

log = logging.getLogger("trading_bot.strategy.hft")


@dataclass
class TradeScore:
    total: float
    reasons: list[str]


class HFTOrderbookStrategy(Strategy):
    name = "hft_orderbook"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    async def scan(self, ctx: StrategyContext) -> list[ScanCandidate]:
        candidates: list[ScanCandidate] = []
        rest = ctx.rest
        try:
            symbols = rest.list_usdt_swap_symbols()[: self.settings.trading_universe_size]
        except Exception:
            symbols = []

        for symbol in symbols[:50]:
            try:
                ticker = await rest.fetch_ticker(symbol)
                if not (self.settings.trading_min_volume_usd <= ticker.volume_24h <= self.settings.trading_max_volume_usd):
                    continue
                if ticker.spread_pct > self.settings.trading_max_spread_pct:
                    continue
                book = await rest.fetch_order_book(symbol, limit=50)
                snap = self._to_book(book)
                analysis = analyze_spike_entry(
                    snap,
                    min_density_usd=self.settings.trading_min_density_usd,
                    anomaly_multiplier=self.settings.trading_anomaly_multiplier,
                    min_spread_pct=self.settings.trading_min_spread_pct,
                    max_spread_pct=self.settings.trading_max_spread_pct,
                )
                score = self._score(snap, analysis, ticker.volume_24h)
                if score.total >= self.settings.trading_min_score * 0.7:
                    candidates.append(
                        ScanCandidate(
                            symbol=to_swap_symbol(symbol),
                            score=score.total,
                            volume_24h=ticker.volume_24h,
                            spread_pct=ticker.spread_pct,
                            reason="; ".join(score.reasons[:3]),
                        )
                    )
            except Exception as e:
                log.debug("scan skip %s: %s", symbol, e)

        candidates.sort(key=lambda c: c.score, reverse=True)
        return candidates[: self.settings.trading_top_pairs]

    async def should_enter(self, ctx: StrategyContext, symbol: str) -> bool:
        if ctx.order_manager.has_position(symbol):
            return False
        intent = await self.build_trade(ctx, symbol)
        return intent is not None

    async def build_trade(self, ctx: StrategyContext, symbol: str) -> TradeIntent | None:
        swap = to_swap_symbol(symbol)
        book_raw = await ctx.rest.fetch_order_book(swap, limit=50)
        snap = self._to_book(book_raw)
        analysis = analyze_spike_entry(
            snap,
            min_density_usd=self.settings.trading_min_density_usd,
            anomaly_multiplier=self.settings.trading_anomaly_multiplier,
            min_spread_pct=self.settings.trading_min_spread_pct,
            max_spread_pct=self.settings.trading_max_spread_pct,
        )
        if not analysis.has_opportunity or analysis.target_entry_price is None:
            return None

        ticker = await ctx.rest.fetch_ticker(swap)
        score = self._score(snap, analysis, ticker.volume_24h)
        if score.total < self.settings.trading_min_score:
            return None

        ev = self._expected_value(analysis, self.settings.trading_notional_usd)
        if ev < self.settings.trading_min_ev_usd:
            return None

        ai_prob = ctx.ai_filter.get(swap)
        if ai_prob is not None and ai_prob < self.settings.trading_ai_min_confidence:
            return None

        side = "long" if analysis.target_side == "buy" else "short"
        entry = analysis.target_entry_price
        sl = entry * (0.9975 if side == "long" else 1.0025)
        tp = entry * (1.0045 if side == "long" else 0.9955)

        return TradeIntent(
            symbol=swap,
            side=side,
            strategy=self.name,
            entry_price=entry,
            stop_loss=sl,
            take_profit=tp,
            confidence=score.total,
            expected_value=ev,
            use_limit=True,
            limit_price=entry,
            signals={"score": score.total, "reasons": score.reasons, "analysis": analysis.reason},
            book_snapshot=self._book_dict(snap),
            ai_probability=ai_prob,
        )

    async def manage_position(self, ctx: StrategyContext, symbol: str) -> str | None:
        return None

    def _to_book(self, raw: Any) -> BookSnapshot:
        return BookSnapshot(
            symbol=raw.symbol,
            bids=parse_levels(raw.bids),
            asks=parse_levels(raw.asks),
            ts_ms=raw.timestamp,
        )

    def _score(self, book: BookSnapshot, analysis: Any, volume_24h: float) -> TradeScore:
        reasons: list[str] = []
        pts = 0.0
        if analysis.has_opportunity:
            pts += 30
            reasons.append("density opportunity")
        imb = book.imbalance(15)
        pts += min(20, abs(imb) * 40)
        if 200_000 <= volume_24h <= 20_000_000:
            pts += 20
            reasons.append("volume sweet spot")
        bid_d, ask_d = book.depth_usd(20)
        pts += min(15, (bid_d + ask_d) / 100_000 * 15)
        if analysis.bid_walls or analysis.ask_walls:
            pts += 15
            reasons.append("anomaly wall")
        pts += min(20, analysis.distance_pct * 10)
        return TradeScore(total=min(100, pts), reasons=reasons)

    def _expected_value(self, analysis: Any, notional: float) -> float:
        capture = 0.55 if analysis.has_opportunity else 0.35
        edge_pct = max(0.0, analysis.distance_pct * capture)
        gross = notional * edge_pct / 100
        fees = notional * (self.settings.trading_maker_fee_pct + self.settings.trading_taker_fee_pct) / 100
        slip = notional * self.settings.trading_slippage_pct / 100
        funding = notional * self.settings.trading_funding_pct / 100
        risk = notional * self.settings.trading_sl_pct / 100 * 0.1
        return gross - fees - slip - funding - risk

    def _book_dict(self, book: BookSnapshot) -> dict[str, Any]:
        return {
            "mid": book.mid,
            "spread_pct": book.spread_pct,
            "imbalance": book.imbalance(),
            "microprice": book.microprice,
            "bids_top5": [(l.price, l.size) for l in book.bids[:5]],
            "asks_top5": [(l.price, l.size) for l in book.asks[:5]],
        }

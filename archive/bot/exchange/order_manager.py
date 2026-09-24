"""Single order execution gateway — strategies must use this only."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from core.config import Settings, TradingMode, get_settings
from core.models import ManagedPosition, TradeIntent
from exchange.okx_rest import OKXRestClient, to_swap_symbol
from execution.live_engine import LiveEngine
from execution.paper_engine import PaperEngine, PaperPosition
from risk.account_risk import AccountRisk, RiskDecision
from risk.position_sizer import PositionSizer
from risk.stop_manager import PositionAction, StopManager, StopState
from storage.analytics import AnalyticsEngine
from storage.journal import TradeJournal
from storage.trade_context import build_market_context, estimate_slippage_pct
from storage.trades import TradeRepository

log = logging.getLogger("trading_bot.exchange.order_manager")


class OrderManager:
    """Opens, manages, and closes all positions with risk checks and journaling."""

    def __init__(
        self,
        rest: OKXRestClient,
        risk: AccountRisk,
        journal: TradeJournal,
        repo: TradeRepository,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.rest = rest
        self.risk = risk
        self.journal = journal
        self.repo = repo
        self.sizer = PositionSizer(self.settings)
        self.stop_manager = StopManager(self.settings.trading_trailing_pct)
        self.paper = PaperEngine(
            self.settings.trading_paper_balance,
            self.settings.trading_maker_fee_pct,
            self.settings.trading_taker_fee_pct,
        )
        self.live = LiveEngine(rest)
        self.analytics = AnalyticsEngine(repo)
        self.positions: dict[str, ManagedPosition] = {}
        self.pending_limits: dict[str, dict[str, Any]] = {}

    @property
    def equity(self) -> float:
        if self.settings.trading_mode == TradingMode.PAPER:
            return self.paper.equity
        return self.risk.state.current_equity

    async def request_open(self, intent: TradeIntent) -> tuple[bool, str, ManagedPosition | None]:
        symbol = to_swap_symbol(intent.symbol)
        leverage = intent.leverage or self.settings.trading_leverage

        stop_dist = abs(intent.entry_price - intent.stop_loss) / intent.entry_price * 100
        contracts, notional = self.sizer.size_from_risk(self.equity, intent.entry_price, stop_dist, leverage)
        liq_dist = self.sizer.liquidation_distance_pct(intent.entry_price, intent.side, leverage)

        decision: RiskDecision = self.risk.can_open(symbol, intent.strategy, notional, leverage, liq_dist)
        intent.risk_decision = decision.reason

        if not decision.allowed:
            await self.journal.log_rejected(intent, decision.reason)
            return False, decision.reason, None

        if intent.expected_value < self.settings.trading_min_ev_usd:
            await self.journal.log_rejected(intent, f"EV ${intent.expected_value:.4f} below min")
            return False, "EV too low", None

        stop_state = self.stop_manager.init_stops(
            intent.entry_price, intent.side, self.settings.trading_sl_pct, self.settings.trading_tp_pct
        )

        fill_price = intent.entry_price
        entry_order_id: str | None = None
        sl_order_id: str | None = None
        tp_order_id: str | None = None
        liquidation_price: float | None = None

        try:
            if self.settings.trading_mode == TradingMode.LIVE:
                order = await self.live.open_position(
                    symbol,
                    intent.side,
                    contracts,
                    order_type="limit" if intent.use_limit else "market",
                    price=intent.limit_price or intent.entry_price,
                    leverage=leverage,
                    stop_loss=stop_state.stop_loss,
                    take_profit=stop_state.take_profit,
                )
                fill_price = float(order.get("fill_price") or order.get("price") or intent.entry_price)
                entry_order_id = str(order.get("id", ""))
                sl_order_id = order.get("sl_order_id")
                tp_order_id = order.get("tp_order_id")
                liquidation_price = order.get("liquidation_price")
                equity = await self.live.sync_equity()
                self.risk.update_equity(equity)
            else:
                self.paper.open_position(
                    symbol,
                    intent.side,
                    intent.strategy,
                    intent.entry_price,
                    contracts,
                    notional,
                    leverage,
                    intent.stop_loss,
                    intent.take_profit,
                    is_maker=intent.use_limit,
                    metadata=intent.signals,
                )
        except Exception as e:
            log.error("Open failed %s: %s", symbol, e)
            return False, str(e), None

        trade_id = str(uuid.uuid4())
        pos = ManagedPosition(
            trade_id=trade_id,
            symbol=symbol,
            side=intent.side,
            strategy=intent.strategy,
            entry_price=fill_price,
            size=contracts,
            remaining_size=contracts,
            notional_usd=notional,
            leverage=leverage,
            stop_state=stop_state,
            opened_at_ms=int(time.time() * 1000),
            entry_order_id=entry_order_id,
            sl_order_id=sl_order_id,
            tp_order_id=tp_order_id,
            liquidation_price=liquidation_price,
            metadata={
                "signals": intent.signals,
                "confidence": intent.confidence,
                "expected_value": intent.expected_value,
                "ai_probability": intent.ai_probability,
                "book_snapshot": intent.book_snapshot,
            },
        )
        self.positions[symbol] = pos
        self.risk.on_open(symbol, intent.strategy, notional)
        self.risk.update_equity(self.equity)

        market_ctx = await build_market_context(symbol, self.rest, book_snapshot=intent.book_snapshot)
        entry_slippage_pct = estimate_slippage_pct(intent.entry_price, fill_price)
        entry_fees = notional * (
            self.settings.trading_maker_fee_pct if intent.use_limit else self.settings.trading_taker_fee_pct
        ) / 100

        await self.repo.save_open(
            trade_id=trade_id,
            symbol=symbol,
            side=intent.side,
            strategy=intent.strategy,
            entry_price=fill_price,
            size=contracts,
            notional_usd=notional,
            confidence=intent.confidence,
            expected_value=intent.expected_value,
            signals=intent.signals,
            book_snapshot=intent.book_snapshot,
            ai_probability=intent.ai_probability,
            risk_decision=decision.reason,
            leverage=leverage,
            market_context=market_ctx,
            fees_usd=entry_fees,
        )
        await self.journal.log_entry(intent, pos, market_ctx, entry_slippage_pct)
        log.info("OPEN %s %s %s @ %.6f EV=%.4f", intent.strategy, intent.side, symbol, fill_price, intent.expected_value)
        return True, "opened", pos

    async def manage_positions(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for symbol, pos in list(self.positions.items()):
            try:
                ticker = await self.rest.fetch_ticker(symbol)
                price = ticker.mark_price or ticker.last

                if self.settings.trading_mode == TradingMode.LIVE:
                    at_risk, reason, liq_dist = await self.live.check_liquidation_risk(
                        symbol,
                        pos.side,
                        self.settings.trading_liquidation_buffer_pct,
                    )
                    if at_risk:
                        log.warning("LIQUIDATION RISK %s: %s", symbol, reason)
                        closed = await self._close(symbol, pos, price, reason, partial_pct=100.0)
                        results.append(closed)
                        self.risk.set_emergency_stop(True)
                        continue

                    exchange_pos = await self.live.get_position(symbol)
                    if exchange_pos and exchange_pos.liquidation_price:
                        pos.liquidation_price = exchange_pos.liquidation_price

                action, stop_state, reason = self.stop_manager.evaluate(price, pos.side, pos.stop_state)
                pos.stop_state = stop_state

                if action == PositionAction.TRAIL and self.settings.trading_mode == TradingMode.LIVE:
                    pos.sl_order_id = await self.live.amend_stop(
                        symbol, pos.side, pos.remaining_size, stop_state.stop_loss, pos.sl_order_id
                    )

                if action == PositionAction.HOLD:
                    continue

                partial = action == PositionAction.PARTIAL_CLOSE
                partial_pct = 50.0 if partial else 100.0
                closed = await self._close(symbol, pos, price, reason, partial_pct=partial_pct)
                results.append(closed)

                if partial and symbol in self.positions:
                    self.positions[symbol].partial_stage += 1
            except Exception as e:
                log.error("Manage %s error: %s", symbol, e)
        return results

    async def _close(
        self,
        symbol: str,
        pos: ManagedPosition,
        exit_price: float,
        reason: str,
        *,
        partial_pct: float = 100.0,
    ) -> dict[str, Any]:
        close_size = pos.remaining_size * (partial_pct / 100)
        pnl = 0.0

        if self.settings.trading_mode == TradingMode.LIVE:
            order = await self.live.close_position(
                symbol,
                pos.side,
                close_size,
                partial_pct=partial_pct,
                cancel_brackets=partial_pct >= 100,
            )
            fill = float(order.get("average") or order.get("price") or exit_price)
            direction = 1 if pos.side == "long" else -1
            pnl = direction * (fill - pos.entry_price) * close_size
            exit_price = fill
        else:
            pnl, _ = self.paper.close_position(symbol, exit_price, partial_pct=partial_pct)

        pos.remaining_size = max(0.0, pos.remaining_size - close_size)
        if partial_pct < 100 and pos.remaining_size > 0:
            pos.size = pos.remaining_size
        hold_ms = int(time.time() * 1000) - pos.opened_at_ms

        if pos.remaining_size <= 1e-12 or partial_pct >= 100:
            self.risk.on_close(symbol, pnl)
            self.positions.pop(symbol, None)
        else:
            self.risk.state.daily_pnl_usd += pnl
            if self.settings.trading_mode == TradingMode.LIVE:
                pos.sl_order_id = await self.live.amend_stop(
                    symbol, pos.side, pos.remaining_size, pos.stop_state.stop_loss, pos.sl_order_id
                )

        self.risk.update_equity(self.equity)

        full_close = pos.remaining_size <= 1e-12 or partial_pct >= 100
        if full_close:
            exit_ctx = await build_market_context(symbol, self.rest)
            expected_exit = pos.stop_state.take_profit if "tp" in reason.lower() else pos.stop_state.stop_loss
            if "trail" in reason.lower() or "manual" in reason.lower():
                expected_exit = exit_price
            slippage_pct = estimate_slippage_pct(expected_exit, exit_price)
            slippage_usd = slippage_pct / 100 * pos.notional_usd
            direction = 1 if pos.side == "long" else -1
            pnl_pct = direction * (exit_price - pos.entry_price) / pos.entry_price * 100 if pos.entry_price else 0
            exit_fees = pos.notional_usd * self.settings.trading_taker_fee_pct / 100

            await self.repo.save_close(
                trade_id=pos.trade_id,
                exit_price=exit_price,
                pnl_usd=pnl,
                exit_reason=reason,
                hold_ms=hold_ms,
                fees_usd=exit_fees,
                slippage_pct=slippage_pct,
                slippage_usd=slippage_usd,
                pnl_pct=pnl_pct,
                exit_context=exit_ctx,
            )
            await self._persist_analytics_snapshot(pos.strategy)

        await self.journal.log_exit(pos, exit_price, pnl, reason, partial_pct)
        log.info("CLOSE %s %s pnl=%.4f reason=%s (partial=%.0f%%)", pos.strategy, symbol, pnl, reason, partial_pct)
        return {"symbol": symbol, "pnl": pnl, "reason": reason, "partial_pct": partial_pct}

    async def _persist_analytics_snapshot(self, strategy: str) -> None:
        try:
            report = self.analytics.compute(strategy="all", limit=500)
            self.repo.save_analytics_snapshot("all", self.analytics.to_dict(report)["overall"])
            if strategy != "all":
                strat_report = self.analytics.compute(strategy=strategy, limit=500)
                key = strategy
                if key in strat_report.by_strategy:
                    self.repo.save_analytics_snapshot(key, self.analytics.to_dict(strat_report)["by_strategy"][key])
        except Exception as e:
            log.warning("Analytics snapshot failed: %s", e)

    def has_position(self, symbol: str) -> bool:
        return to_swap_symbol(symbol) in self.positions

    def list_positions(self) -> list[ManagedPosition]:
        return list(self.positions.values())

    def list_paper_positions(self) -> list[PaperPosition]:
        return self.paper.list_positions()

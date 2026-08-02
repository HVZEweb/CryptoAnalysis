"""
Unified OKX Futures Trading Bot — single process, multiple strategy plugins.

Run: cd bot && python main.py
"""

from __future__ import annotations

import asyncio
import signal
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from api.server import run_server
from core.config import Settings, StrategyName, TradingMode, get_settings
from core.logger import setup_logging
from core.scheduler import Scheduler
from exchange.market_sync import MarketDataHub
from exchange.okx_rest import OKXRestClient, to_swap_symbol
from exchange.okx_ws import OKXWebSocket
from exchange.order_manager import OrderManager
from risk.account_risk import AccountRisk
from storage.analytics import AnalyticsEngine
from storage.journal import TradeJournal
from storage.trades import TradeRepository
from strategies.ai_predictor.strategy import AIPredictorStrategy
from strategies.base import StrategyContext
from strategies.hft_orderbook.strategy import HFTOrderbookStrategy
from strategies.meta_strategy import MetaStrategy
from strategies.quant_scalping.strategy import QuantScalpingStrategy

log = setup_logging()


class UnifiedTradingBot:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.rest = OKXRestClient(self.settings)
        self.ws = OKXWebSocket(self.settings)
        self.market = MarketDataHub(
            self.rest,
            self.ws,
            desync_threshold_pct=self.settings.trading_desync_threshold_pct,
            ws_stale_ms=self.settings.trading_ws_stale_ms,
        )
        self.risk = AccountRisk(self.settings)
        self.journal = TradeJournal()
        self.repo = TradeRepository()
        self.analytics = AnalyticsEngine(self.repo)
        self.order_manager = OrderManager(self.rest, self.risk, self.journal, self.repo, self.settings)
        self.scheduler = Scheduler()

        self._strategies = {
            StrategyName.META.value: MetaStrategy(self.settings),
            StrategyName.HFT_ORDERBOOK.value: HFTOrderbookStrategy(self.settings),
            StrategyName.QUANT_SCALPING.value: QuantScalpingStrategy(self.settings),
            StrategyName.AI_PREDICTOR.value: AIPredictorStrategy(self.settings),
        }
        self.active_strategy_name = self.settings.trading_active_strategy.value
        self._universe: list[Any] = []
        self._ctx = StrategyContext(rest=self.rest, order_manager=self.order_manager)
        self._running = False
        self._started_at: datetime | None = None
        self._http_runner: Any = None
        self._stats = {
            "scans": 0,
            "signals": 0,
            "trades_opened": 0,
            "net_pnl_usd": 0.0,
        }
        self.last_error: str | None = None

    @property
    def running(self) -> bool:
        return self._running

    def _active_strategy(self):
        if self.active_strategy_name == StrategyName.META.value:
            return self._strategies[StrategyName.META.value]
        return self._strategies.get(self.active_strategy_name, self._strategies[StrategyName.META.value])

    def set_active_strategy(self, name: StrategyName) -> None:
        self.active_strategy_name = name.value
        log.info("Active strategy: %s", name.value)

    def update_config(self, patch: dict[str, Any]) -> None:
        for key, val in patch.items():
            attr = key.lower()
            if hasattr(self.settings, attr):
                setattr(self.settings, attr, val)

    def get_config_snapshot(self) -> dict[str, Any]:
        s = self.settings
        return {
            "mode": s.trading_mode.value,
            "active_strategy": self.active_strategy_name,
            "enabled_strategies": [n.value for n in s.enabled_strategies],
            "leverage": s.trading_leverage,
            "min_score": s.trading_min_score,
            "min_ev_usd": s.trading_min_ev_usd,
            "max_positions": s.trading_max_positions,
            "notional_usd": s.trading_notional_usd,
            "ai_min_confidence": s.trading_ai_min_confidence,
        }

    def get_analytics(self, strategy: str | None = None, limit: int = 500) -> dict[str, Any]:
        report = self.analytics.compute(strategy=strategy, limit=limit)
        data = self.analytics.to_dict(report)
        data["snapshots"] = self.repo.list_analytics_snapshots(20)
        return data

    def get_positions(self) -> list[dict[str, Any]]:
        return [
            {
                "trade_id": p.trade_id,
                "symbol": p.symbol,
                "side": p.side,
                "strategy": p.strategy,
                "entry_price": p.entry_price,
                "size": p.size,
                "notional_usd": p.notional_usd,
                "stop_loss": p.stop_state.stop_loss,
                "take_profit": p.stop_state.take_profit,
            }
            for p in self.order_manager.list_positions()
        ]

    def get_status(self) -> dict[str, Any]:
        uptime = int(time.time() - self._started_at.timestamp()) if self._started_at else 0
        return {
            "running": self._running,
            "mode": self.settings.trading_mode.value,
            "active_strategy": self.active_strategy_name,
            "uptime_sec": uptime,
            "equity": self.order_manager.equity,
            "drawdown_pct": self.risk.drawdown_pct,
            "open_positions": len(self.order_manager.list_positions()),
            "universe": [
                {"symbol": c.symbol, "score": c.score, "reason": c.reason}
                for c in self._universe[:10]
            ],
            "stats": self._stats,
            "config": self.get_config_snapshot(),
            "last_error": self.last_error,
            "emergency_stop": self.risk.state.emergency_stop,
            "exchange_health": self.market.health(),
        }

    async def start(self) -> None:
        if self._running:
            return
        log.info("Starting unified trading bot | mode=%s | strategy=%s", self.settings.trading_mode.value, self.active_strategy_name)
        await self.rest.connect()
        if self.settings.trading_mode == TradingMode.LIVE:
            equity = await self.order_manager.live.sync_equity()
            if equity > 0:
                self.risk.update_equity(equity)
                self.risk.state.peak_equity = max(self.risk.state.peak_equity, equity)
        self._running = True
        self._started_at = datetime.utcnow()

        self._http_runner = await run_server(
            self,
            self.settings.trading_http_host,
            self.settings.trading_http_port,
        )

        await self.scheduler.start()
        self.scheduler.add_interval("scan", self.settings.trading_scan_interval_sec, self._scan_loop)
        self.scheduler.add_interval("hunt", self.settings.trading_hunt_interval_sec, self._hunt_loop)
        self.scheduler.add_interval("positions", self.settings.trading_position_interval_sec, self._position_loop)
        self.scheduler.add_interval("sync", self.settings.trading_sync_interval_sec, self._sync_loop)

        symbols = self.rest.list_usdt_swap_symbols()[: self.settings.trading_top_pairs]
        if symbols:
            await self.market.refresh_symbols(symbols)

        log.info("Bot running on http://%s:%d", self.settings.trading_http_host, self.settings.trading_http_port)

    async def stop(self) -> None:
        if not self._running:
            return
        log.info("Stopping unified trading bot")
        self._running = False
        await self.scheduler.stop()
        await self.ws.stop()
        await self.rest.close()
        if self._http_runner:
            await self._http_runner.cleanup()
            self._http_runner = None

    async def _scan_loop(self) -> None:
        try:
            strat = self._active_strategy()
            self._ctx.universe = await strat.scan(self._ctx)
            self._universe = self._ctx.universe
            self._stats["scans"] += 1

            symbols = [c.symbol for c in self._universe]
            if symbols:
                await self.market.refresh_symbols(symbols)
        except Exception as e:
            self.last_error = str(e)
            log.exception("Scan loop error")

    async def _hunt_loop(self) -> None:
        try:
            strat = self._active_strategy()
            for candidate in self._universe:
                symbol = to_swap_symbol(candidate.symbol)
                if self.order_manager.has_position(symbol):
                    continue
                if self.risk.state.emergency_stop:
                    continue

                book = await self.market.get_book_reliable(symbol)
                if book:
                    self._ctx.books[symbol] = book

                if not await strat.should_enter(self._ctx, symbol):
                    continue

                intent = await strat.build_trade(self._ctx, symbol)
                if not intent:
                    continue

                self._stats["signals"] += 1
                ok, reason, _ = await self.order_manager.request_open(intent)
                if ok:
                    self._stats["trades_opened"] += 1
                else:
                    log.debug("Entry skipped %s: %s", symbol, reason)

                if len(self.order_manager.list_positions()) >= self.settings.trading_max_positions:
                    break
        except Exception as e:
            self.last_error = str(e)
            log.exception("Hunt loop error")

    async def _sync_loop(self) -> None:
        """REST ↔ WS desync check and live position reconciliation."""
        try:
            if self.settings.trading_mode == TradingMode.LIVE:
                for pos in self.order_manager.list_positions():
                    await self.order_manager.live.sync_position_size(pos.symbol)
            for sym in [c.symbol for c in self._universe[:5]]:
                await self.market.get_book_reliable(sym)
        except Exception as e:
            self.last_error = str(e)
            log.debug("Sync loop: %s", e)

    async def _position_loop(self) -> None:
        try:
            results = await self.order_manager.manage_positions()
            for r in results:
                self._stats["net_pnl_usd"] += r.get("pnl", 0)
        except Exception as e:
            self.last_error = str(e)
            log.exception("Position loop error")


async def _main() -> None:
    bot = UnifiedTradingBot()
    loop = asyncio.get_running_loop()

    def _shutdown() -> None:
        asyncio.create_task(bot.stop())

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _shutdown)
        except NotImplementedError:
            pass

    await bot.start()
    try:
        while bot.running:
            await asyncio.sleep(1)
    finally:
        await bot.stop()


if __name__ == "__main__":
    asyncio.run(_main())

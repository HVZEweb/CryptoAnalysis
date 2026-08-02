"""REST ↔ WebSocket market data sync and desync detection."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from exchange.okx_rest import OKXRestClient, to_swap_symbol
from exchange.okx_ws import OKXWebSocket
from market.orderbook import BookSnapshot

log = logging.getLogger("trading_bot.market_sync")


@dataclass
class SymbolSyncState:
    symbol: str
    ws_mid: float = 0.0
    rest_mid: float = 0.0
    desync_pct: float = 0.0
    desync_count: int = 0
    last_ws_ms: int = 0
    last_rest_ms: int = 0
    source: str = "none"


@dataclass
class MarketDataHub:
    rest: OKXRestClient
    ws: OKXWebSocket
    desync_threshold_pct: float = 0.15
    ws_stale_ms: int = 5000
    _states: dict[str, SymbolSyncState] = field(default_factory=dict)

    def _state(self, symbol: str) -> SymbolSyncState:
        swap = to_swap_symbol(symbol)
        if swap not in self._states:
            self._states[swap] = SymbolSyncState(symbol=swap)
        return self._states[swap]

    def get_book(self, symbol: str) -> BookSnapshot | None:
        return self.ws.get_book(symbol)

    async def get_book_reliable(self, symbol: str) -> BookSnapshot | None:
        """Prefer fresh WS; fall back to REST on stale or desync."""
        swap = to_swap_symbol(symbol)
        state = self._state(swap)
        ws_book = self.ws.get_book(swap)
        now_ms = int(time.time() * 1000)

        if ws_book and ws_book.bids and ws_book.asks:
            state.ws_mid = ws_book.mid
            state.last_ws_ms = ws_book.ts_ms or now_ms
            ws_age = now_ms - state.last_ws_ms
            if ws_age <= self.ws_stale_ms:
                desynced = await self._check_desync(swap, ws_book.mid)
                if not desynced:
                    state.source = "ws"
                    return ws_book

        rest_ob = await self.rest.fetch_order_book(swap, limit=50)
        from market.orderbook import OrderBookLevel, parse_levels

        book = BookSnapshot(
            symbol=swap,
            bids=parse_levels(rest_ob.bids),
            asks=parse_levels(rest_ob.asks),
            ts_ms=rest_ob.timestamp or now_ms,
        )
        state.rest_mid = book.mid
        state.last_rest_ms = now_ms
        state.source = "rest"
        self.ws.seed_book(book)
        return book

    async def _check_desync(self, symbol: str, ws_mid: float) -> bool:
        if ws_mid <= 0:
            return True
        state = self._state(symbol)
        try:
            rest_ob = await self.rest.fetch_order_book(symbol, limit=5)
            state.rest_mid = rest_ob.mid
            state.last_rest_ms = int(time.time() * 1000)
            diff_pct = abs(rest_ob.mid - ws_mid) / ws_mid * 100
            state.desync_pct = diff_pct
            if diff_pct > self.desync_threshold_pct:
                state.desync_count += 1
                log.warning("Desync %s: WS mid=%.6f REST mid=%.6f (%.3f%%)", symbol, ws_mid, rest_ob.mid, diff_pct)
                return True
            return False
        except Exception as e:
            log.debug("Desync check failed %s: %s", symbol, e)
            return False

    async def refresh_symbols(self, symbols: list[str]) -> None:
        await self.ws.update_subscriptions(symbols)

    def health(self) -> dict[str, Any]:
        ws_h = self.ws.health()
        return {
            "ws": ws_h,
            "rest_errors": self.rest.api_error_streak,
            "rate_limit": self.rest.rate_limit.snapshot(),
            "symbols": {
                sym: {
                    "source": st.source,
                    "desync_pct": round(st.desync_pct, 4),
                    "desync_count": st.desync_count,
                    "ws_age_ms": max(0, int(time.time() * 1000) - st.last_ws_ms) if st.last_ws_ms else -1,
                }
                for sym, st in self._states.items()
            },
        }

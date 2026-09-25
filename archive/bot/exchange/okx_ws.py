"""OKX WebSocket — order book feeds with reconnect and health tracking."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Callable
from typing import Any

import websockets

from core.config import Settings, get_settings
from exchange.okx_rest import to_swap_symbol
from market.orderbook import BookSnapshot, parse_levels

log = logging.getLogger("trading_bot.exchange.ws")


class OKXWebSocket:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._symbols: set[str] = set()
        self._books: dict[str, BookSnapshot] = {}
        self._running = False
        self._task: asyncio.Task[Any] | None = None
        self._on_book: Callable[[BookSnapshot], None] | None = None
        self._connected = False
        self._reconnect_count = 0
        self._last_message_ms = 0
        self._messages_received = 0
        self._resubscribe_event = asyncio.Event()

    def set_book_callback(self, cb: Callable[[BookSnapshot], None]) -> None:
        self._on_book = cb

    def get_book(self, symbol: str) -> BookSnapshot | None:
        return self._books.get(to_swap_symbol(symbol))

    def seed_book(self, book: BookSnapshot) -> None:
        self._books[book.symbol] = book

    def health(self) -> dict[str, Any]:
        now = int(time.time() * 1000)
        return {
            "connected": self._connected,
            "running": self._running,
            "reconnect_count": self._reconnect_count,
            "messages_received": self._messages_received,
            "last_message_age_ms": (now - self._last_message_ms) if self._last_message_ms else -1,
            "subscribed_symbols": len(self._symbols),
            "books_cached": len(self._books),
        }

    async def subscribe(self, symbols: list[str]) -> None:
        await self.update_subscriptions(symbols)

    async def update_subscriptions(self, symbols: list[str]) -> None:
        new_set = {to_swap_symbol(s) for s in symbols}
        if new_set == self._symbols and self._running:
            return
        self._symbols = new_set
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._listen())
        else:
            self._resubscribe_event.set()

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self._connected = False

    async def _listen(self) -> None:
        url = self.settings.ws_url
        backoff = 1.0
        max_backoff = 30.0

        while self._running:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=30) as ws:
                    self._connected = True
                    backoff = 1.0
                    await self._send_subscribe(ws)

                    while self._running:
                        if self._resubscribe_event.is_set():
                            self._resubscribe_event.clear()
                            await self._send_subscribe(ws)

                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=30.0)
                        except asyncio.TimeoutError:
                            await ws.ping()
                            continue

                        self._last_message_ms = int(time.time() * 1000)
                        self._messages_received += 1
                        self._handle_message(raw)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._connected = False
                self._reconnect_count += 1
                log.warning("WS disconnected: %s — reconnect in %.1fs", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(max_backoff, backoff * 2)

        self._connected = False

    async def _send_subscribe(self, ws: Any) -> None:
        if not self._symbols:
            return
        args = [{"channel": "books5", "instId": self._inst_id(s)} for s in self._symbols]
        await ws.send(json.dumps({"op": "subscribe", "args": args}))
        log.info("WS subscribed to %d symbols", len(self._symbols))

    def _handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        if msg.get("event") in ("subscribe", "error"):
            if msg.get("event") == "error":
                log.warning("WS subscribe error: %s", msg)
            return
        arg = msg.get("arg", {})
        if arg.get("channel") != "books5":
            return
        data = msg.get("data")
        if not data:
            return
        book_data = data[0]
        inst = book_data.get("instId", "")
        symbol = self._symbol_from_inst(inst)
        bids = parse_levels([(float(p), float(s)) for p, s, *_ in book_data.get("bids", [])])
        asks = parse_levels([(float(p), float(s)) for p, s, *_ in book_data.get("asks", [])])
        snap = BookSnapshot(
            symbol=symbol,
            bids=bids,
            asks=asks,
            ts_ms=int(book_data.get("ts", 0)),
        )
        self._books[symbol] = snap
        if self._on_book:
            self._on_book(snap)

    @staticmethod
    def _inst_id(symbol: str) -> str:
        swap = to_swap_symbol(symbol)
        base = swap.split("/")[0]
        return f"{base}-USDT-SWAP"

    @staticmethod
    def _symbol_from_inst(inst_id: str) -> str:
        base = inst_id.replace("-USDT-SWAP", "")
        return f"{base}/USDT:USDT"

"""OKX Futures public WebSocket client — standalone implementation."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection

log = logging.getLogger("msb.okx_ws")

MessageHandler = Callable[[dict[str, Any]], Awaitable[None]]


class OKXWebSocket:
    """Reconnecting OKX v5 public WebSocket."""

    def __init__(
        self,
        url: str,
        *,
        subscriptions: list[dict[str, str]],
        on_message: MessageHandler,
        reconnect_delay: float = 5.0,
    ) -> None:
        self.url = url
        self.subscriptions = subscriptions
        self.on_message = on_message
        self.reconnect_delay = reconnect_delay
        self._running = False
        self._ws: ClientConnection | None = None

    async def run(self) -> None:
        self._running = True
        while self._running:
            try:
                async with websockets.connect(
                    self.url,
                    ping_interval=20,
                    ping_timeout=20,
                    max_size=10 * 1024 * 1024,
                ) as ws:
                    self._ws = ws
                    await self._subscribe(ws)
                    log.info("OKX WS connected, %d subscriptions", len(self.subscriptions))
                    async for raw in ws:
                        if not self._running:
                            break
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if msg.get("event") in ("subscribe", "unsubscribe"):
                            log.debug("WS event: %s", msg)
                            continue
                        if msg.get("event") == "error":
                            log.error("WS error: %s", msg)
                            continue
                        await self.on_message(msg)
            except asyncio.CancelledError:
                self._running = False
                raise
            except Exception as e:
                log.warning("WS disconnected: %s — reconnect in %.0fs", e, self.reconnect_delay)
                await asyncio.sleep(self.reconnect_delay)

    async def _subscribe(self, ws: ClientConnection) -> None:
        for sub in self.subscriptions:
            payload = {"op": "subscribe", "args": [sub]}
            await ws.send(json.dumps(payload))
            await asyncio.sleep(0.05)

    def stop(self) -> None:
        self._running = False


def build_subscriptions(symbols: list[str], *, book_channel: str = "books") -> list[dict[str, str]]:
    subs: list[dict[str, str]] = []
    for inst in symbols:
        subs.append({"channel": book_channel, "instId": inst})
        subs.append({"channel": "trades", "instId": inst})
        subs.append({"channel": "tickers", "instId": inst})
    return subs

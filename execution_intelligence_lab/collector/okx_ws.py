"""OKX public WebSocket client — Execution Intelligence Lab."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Awaitable, Callable

import websockets

log = logging.getLogger("eil.ws")

MessageHandler = Callable[[dict], Awaitable[None]]


def build_subscriptions(symbols: list[str], *, book_channel: str = "books") -> list[dict]:
    subs: list[dict] = []
    for sym in symbols:
        subs.append({"channel": book_channel, "instId": sym})
        subs.append({"channel": "trades", "instId": sym})
        subs.append({"channel": "tickers", "instId": sym})
    return subs


class OKXWebSocket:
    def __init__(
        self,
        url: str,
        *,
        subscriptions: list[dict],
        on_message: MessageHandler,
        reconnect_delay: float = 5.0,
    ) -> None:
        self.url = url
        self.subscriptions = subscriptions
        self.on_message = on_message
        self.reconnect_delay = reconnect_delay
        self._stop = False

    def stop(self) -> None:
        self._stop = True

    async def run(self) -> None:
        while not self._stop:
            try:
                async with websockets.connect(self.url, ping_interval=20, ping_timeout=20) as ws:
                    for sub in self.subscriptions:
                        await ws.send(json.dumps({"op": "subscribe", "args": [sub]}))
                    log.info("Subscribed to %d channels", len(self.subscriptions))
                    async for raw in ws:
                        if self._stop:
                            break
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if msg.get("event") in ("subscribe", "error"):
                            if msg.get("event") == "error":
                                log.warning("WS error: %s", msg)
                            continue
                        await self.on_message(msg)
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.warning("WS disconnected: %s — retry in %.0fs", e, self.reconnect_delay)
                await asyncio.sleep(self.reconnect_delay)

"""Public trades recorder."""

from __future__ import annotations

from collector.storage import ParquetStore


class TradesRecorder:
    def __init__(self, store: ParquetStore) -> None:
        self.store = store

    async def on_message(self, msg: dict) -> None:
        arg = msg.get("arg") or {}
        if arg.get("channel") != "trades":
            return
        for t in msg.get("data") or []:
            px = float(t.get("px") or 0)
            sz = float(t.get("sz") or 0)
            side = t.get("side") or ""
            self.store.buffer(
                "trades",
                {
                    "ts": int(t.get("ts") or 0),
                    "inst_id": arg.get("instId"),
                    "price": px,
                    "size": sz,
                    "notional": px * sz,
                    "side": side,
                    "aggressive": side,
                    "trade_id": t.get("tradeId"),
                },
            )

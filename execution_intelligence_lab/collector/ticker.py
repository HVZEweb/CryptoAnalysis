"""Ticker recorder."""

from __future__ import annotations

from collector.storage import ParquetStore


class TickerRecorder:
    def __init__(self, store: ParquetStore) -> None:
        self.store = store

    async def on_message(self, msg: dict) -> None:
        arg = msg.get("arg") or {}
        if arg.get("channel") != "tickers":
            return
        for t in msg.get("data") or []:
            self.store.buffer(
                "ticker",
                {
                    "ts": int(t.get("ts") or 0),
                    "inst_id": arg.get("instId"),
                    "last": float(t.get("last") or 0),
                    "vol_24h": float(t.get("vol24h") or 0),
                    "oi": float(t.get("oi") or 0),
                    "funding_rate": float(t.get("fundingRate") or 0),
                },
            )

"""Trades tape + ticker recorder."""

from __future__ import annotations

import logging
from typing import Any

from collector.storage import ParquetStore

log = logging.getLogger("msb.trades_recorder")


class TradesRecorder:
    def __init__(self, store: ParquetStore) -> None:
        self.store = store

    async def on_message(self, msg: dict[str, Any]) -> None:
        arg = msg.get("arg") or {}
        channel = arg.get("channel", "")
        inst_id = arg.get("instId", "")

        if channel == "trades":
            for t in msg.get("data") or []:
                self.store.buffer(
                    "trades",
                    {
                        "inst_id": inst_id,
                        "ts": int(t.get("ts", 0)),
                        "trade_id": t.get("tradeId", ""),
                        "price": float(t.get("px", 0)),
                        "size": float(t.get("sz", 0)),
                        "side": t.get("side", ""),  # buy | sell (taker side)
                    },
                )
        elif channel == "tickers":
            for t in msg.get("data") or []:
                bid = float(t.get("bidPx", 0))
                ask = float(t.get("askPx", 0))
                mid = (bid + ask) / 2 if bid and ask else 0.0
                spread = ask - bid if bid and ask else 0.0
                spread_bps = (spread / mid * 10000) if mid else 0.0
                self.store.buffer(
                    "ticker",
                    {
                        "inst_id": inst_id,
                        "ts": int(t.get("ts", 0)),
                        "best_bid": bid,
                        "best_ask": ask,
                        "last": float(t.get("last", 0)),
                        "spread": spread,
                        "spread_bps": spread_bps,
                        "vol_24h": float(t.get("vol24h", 0)),
                    },
                )

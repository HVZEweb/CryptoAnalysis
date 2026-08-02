"""L2 order book recorder — snapshot + incremental updates."""

from __future__ import annotations

import json
import logging
from typing import Any

from collector.storage import ParquetStore
from market.orderbook import OrderBook

log = logging.getLogger("msb.orderbook_recorder")


class OrderBookRecorder:
    """Maintains local books and records top-N levels append-only."""

    def __init__(self, store: ParquetStore, *, levels: int = 25) -> None:
        self.store = store
        self.levels = levels
        self._books: dict[str, OrderBook] = {}

    def _book(self, inst_id: str) -> OrderBook:
        if inst_id not in self._books:
            self._books[inst_id] = OrderBook(inst_id)
        return self._books[inst_id]

    async def on_message(self, msg: dict[str, Any]) -> None:
        arg = msg.get("arg") or {}
        channel = arg.get("channel", "")
        if channel not in ("books", "books5", "books50", "books-l2-tbt"):
            return

        inst_id = arg.get("instId", "")
        action = msg.get("action", "")
        for item in msg.get("data") or []:
            book = self._book(inst_id)
            if action == "snapshot":
                book.apply_snapshot(item)
            elif action == "update":
                book.apply_update(item)
            else:
                book.apply_snapshot(item)

            row = self._serialize(inst_id, book, item)
            self.store.buffer("orderbook", row)

    def _serialize(self, inst_id: str, book: OrderBook, raw: dict[str, Any]) -> dict[str, Any]:
        bids = book.top_bids(self.levels)
        asks = book.top_asks(self.levels)
        return {
            "inst_id": inst_id,
            "ts": int(raw.get("ts") or book.timestamp),
            "seq_id": int(raw.get("seqId") or book.seq_id or 0),
            "best_bid": bids[0][0] if bids else 0.0,
            "best_ask": asks[0][0] if asks else 0.0,
            "mid": book.mid,
            "spread": book.spread,
            "spread_bps": book.spread_bps,
            "bid_vol_5": book.bid_volume(5),
            "ask_vol_5": book.ask_volume(5),
            "bid_vol_10": book.bid_volume(10),
            "ask_vol_10": book.ask_volume(10),
            "bid_vol_25": book.bid_volume(25),
            "ask_vol_25": book.ask_volume(25),
            "bids_json": json.dumps(bids),
            "asks_json": json.dumps(asks),
        }

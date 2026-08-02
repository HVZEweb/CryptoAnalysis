"""L2 orderbook recorder."""

from __future__ import annotations

from collector.storage import ParquetStore


class OrderBookRecorder:
    def __init__(self, store: ParquetStore, *, levels: int = 25) -> None:
        self.store = store
        self.levels = levels

    async def on_message(self, msg: dict) -> None:
        arg = msg.get("arg") or {}
        if arg.get("channel") not in ("books", "books5"):
            return
        data = msg.get("data")
        if not data:
            return
        for book in data:
            bids = (book.get("bids") or [])[: self.levels]
            asks = (book.get("asks") or [])[: self.levels]
            if not bids or not asks:
                continue
            best_bid = float(bids[0][0])
            best_ask = float(asks[0][0])
            bid_depth = sum(float(b[1]) for b in bids)
            ask_depth = sum(float(a[1]) for a in asks)
            ts = int(book.get("ts") or 0)
            self.store.buffer(
                "orderbook",
                {
                    "ts": ts,
                    "inst_id": arg.get("instId"),
                    "best_bid": best_bid,
                    "best_ask": best_ask,
                    "mid": (best_bid + best_ask) / 2,
                    "spread_bps": (best_ask - best_bid) / ((best_bid + best_ask) / 2) * 10_000,
                    "bid_depth": bid_depth,
                    "ask_depth": ask_depth,
                    "seq_id": int(book.get("seqId") or 0),
                },
            )

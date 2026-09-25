"""L2 order book state — snapshot + incremental maintenance."""

from __future__ import annotations

from dataclasses import dataclass, field


def _parse_level(row: list) -> tuple[float, float]:
    return float(row[0]), float(row[1])


@dataclass
class OrderBook:
    inst_id: str
    bids: dict[float, float] = field(default_factory=dict)
    asks: dict[float, float] = field(default_factory=dict)
    timestamp: int = 0
    seq_id: int = 0

    def apply_snapshot(self, data: dict) -> None:
        self.bids = {_parse_level(r)[0]: _parse_level(r)[1] for r in data.get("bids") or [] if _parse_level(r)[1] > 0}
        self.asks = {_parse_level(r)[0]: _parse_level(r)[1] for r in data.get("asks") or [] if _parse_level(r)[1] > 0}
        self.timestamp = int(data.get("ts", 0))
        self.seq_id = int(data.get("seqId", 0))

    def apply_update(self, data: dict) -> None:
        for row in data.get("bids") or []:
            px, sz = _parse_level(row)
            if sz <= 0:
                self.bids.pop(px, None)
            else:
                self.bids[px] = sz
        for row in data.get("asks") or []:
            px, sz = _parse_level(row)
            if sz <= 0:
                self.asks.pop(px, None)
            else:
                self.asks[px] = sz
        self.timestamp = int(data.get("ts", self.timestamp))
        self.seq_id = int(data.get("seqId", self.seq_id))

    def top_bids(self, n: int) -> list[tuple[float, float]]:
        return sorted(self.bids.items(), key=lambda x: -x[0])[:n]

    def top_asks(self, n: int) -> list[tuple[float, float]]:
        return sorted(self.asks.items(), key=lambda x: x[0])[:n]

    @property
    def best_bid(self) -> float:
        return self.top_bids(1)[0][0] if self.bids else 0.0

    @property
    def best_ask(self) -> float:
        return self.top_asks(1)[0][0] if self.asks else 0.0

    @property
    def mid(self) -> float:
        if not self.best_bid or not self.best_ask:
            return 0.0
        return (self.best_bid + self.best_ask) / 2

    @property
    def spread(self) -> float:
        if not self.best_bid or not self.best_ask:
            return 0.0
        return self.best_ask - self.best_bid

    @property
    def spread_bps(self) -> float:
        m = self.mid
        return (self.spread / m * 10000) if m else 0.0

    def bid_volume(self, levels: int) -> float:
        return sum(sz for _, sz in self.top_bids(levels))

    def ask_volume(self, levels: int) -> float:
        return sum(sz for _, sz in self.top_asks(levels))

    def imbalance(self, levels: int = 10) -> float:
        b = self.bid_volume(levels)
        a = self.ask_volume(levels)
        t = b + a
        return (b - a) / t if t > 0 else 0.0

    def microprice(self, levels: int = 1) -> float:
        bids = self.top_bids(levels)
        asks = self.top_asks(levels)
        if not bids or not asks:
            return self.mid
        bp, bs = bids[0]
        ap, a_s = asks[0]
        denom = bs + a_s
        if denom <= 0:
            return self.mid
        return (ap * bs + bp * a_s) / denom

    def depth_usd(self, levels: int = 10) -> tuple[float, float]:
        bid_usd = sum(p * s for p, s in self.top_bids(levels))
        ask_usd = sum(p * s for p, s in self.top_asks(levels))
        return bid_usd, ask_usd

    def total_depth(self, levels: int = 25) -> float:
        return self.bid_volume(levels) + self.ask_volume(levels)

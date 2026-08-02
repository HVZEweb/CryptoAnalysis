"""Order book models and density analysis — canonical HFT logic for futures."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal


class BookSide(str, Enum):
    BID = "bid"
    ASK = "ask"


@dataclass
class OrderBookLevel:
    price: float
    size: float

    @property
    def usd(self) -> float:
        return self.price * self.size


@dataclass
class DensityWall:
    price: float
    total_usd: float
    side: BookSide
    level_count: int = 1
    anomaly_ratio: float = 1.0
    avg_level_usd: float = 0.0


@dataclass
class BookSnapshot:
    symbol: str
    bids: list[OrderBookLevel] = field(default_factory=list)
    asks: list[OrderBookLevel] = field(default_factory=list)
    ts_ms: int = 0

    @property
    def best_bid(self) -> float:
        return self.bids[0].price if self.bids else 0.0

    @property
    def best_ask(self) -> float:
        return self.asks[0].price if self.asks else 0.0

    @property
    def mid(self) -> float:
        if not self.bids or not self.asks:
            return 0.0
        return (self.best_bid + self.best_ask) / 2

    @property
    def spread_pct(self) -> float:
        mid = self.mid
        if mid <= 0:
            return 0.0
        return ((self.best_ask - self.best_bid) / mid) * 100

    def depth_usd(self, levels: int = 10) -> tuple[float, float]:
        bid = sum(l.usd for l in self.bids[:levels])
        ask = sum(l.usd for l in self.asks[:levels])
        return bid, ask

    def imbalance(self, levels: int = 10) -> float:
        bid, ask = self.depth_usd(levels)
        total = bid + ask
        if total <= 0:
            return 0.0
        return (bid - ask) / total

    @property
    def microprice(self) -> float:
        if not self.bids or not self.asks:
            return self.mid
        bid_sz = self.bids[0].size
        ask_sz = self.asks[0].size
        total = bid_sz + ask_sz
        if total <= 0:
            return self.mid
        return (self.best_ask * bid_sz + self.best_bid * ask_sz) / total


@dataclass
class SpikeAnalysis:
    symbol: str
    best_bid: float
    best_ask: float
    mid: float
    spread_pct: float
    bid_walls: list[DensityWall] = field(default_factory=list)
    ask_walls: list[DensityWall] = field(default_factory=list)
    max_level_usd: float = 0.0
    avg_level_usd: float = 0.0
    target_entry_price: float | None = None
    target_side: Literal["buy", "sell"] = "buy"
    distance_pct: float = 0.0
    has_opportunity: bool = False
    reason: str = ""


def parse_levels(raw: list[tuple[float, float]]) -> list[OrderBookLevel]:
    return [OrderBookLevel(price=p, size=s) for p, s in raw if p > 0 and s > 0]


def avg_level_usd(levels: list[OrderBookLevel]) -> float:
    if not levels:
        return 0.0
    return sum(l.usd for l in levels) / len(levels)


def find_anomaly_walls(
    levels: list[OrderBookLevel],
    min_density_usd: float,
    anomaly_multiplier: float,
    side: BookSide,
    max_cluster_steps: int = 6,
) -> list[DensityWall]:
    if not levels:
        return []

    avg = avg_level_usd(levels)
    threshold = max(min_density_usd, avg * anomaly_multiplier)
    walls: list[DensityWall] = []

    for i, level in enumerate(levels):
        ratio = level.usd / avg if avg > 0 else 1.0
        if level.usd >= threshold:
            walls.append(
                DensityWall(
                    price=level.price,
                    total_usd=level.usd,
                    side=side,
                    level_count=1,
                    anomaly_ratio=ratio,
                    avg_level_usd=avg,
                )
            )
            continue

        cluster_usd = level.usd
        cluster_levels = 1
        top_price = level.price
        for j in range(i + 1, min(i + max_cluster_steps + 1, len(levels))):
            cluster_usd += levels[j].usd
            cluster_levels += 1
            if cluster_usd >= threshold:
                walls.append(
                    DensityWall(
                        price=top_price,
                        total_usd=cluster_usd,
                        side=side,
                        level_count=cluster_levels,
                        anomaly_ratio=cluster_usd / avg if avg > 0 else 1.0,
                        avg_level_usd=avg,
                    )
                )
                break

    return sorted(walls, key=lambda w: w.total_usd, reverse=True)


def _distance_pct(mid: float, price: float) -> float:
    if mid <= 0:
        return 0.0
    return abs(price - mid) / mid * 100


def analyze_spike_entry(
    book: BookSnapshot,
    *,
    min_density_usd: float,
    anomaly_multiplier: float,
    min_spread_pct: float,
    max_spread_pct: float,
    direction: Literal["long", "short"] = "long",
) -> SpikeAnalysis:
    bids = book.bids
    asks = book.asks

    if not bids or not asks:
        return SpikeAnalysis(
            symbol=book.symbol,
            best_bid=0,
            best_ask=0,
            mid=0,
            spread_pct=0,
            reason="Пустой стакан",
        )

    best_bid = bids[0].price
    best_ask = asks[0].price
    mid = (best_bid + best_ask) / 2
    spread_pct = (best_ask - best_bid) / mid * 100

    bid_walls = find_anomaly_walls(bids, min_density_usd, anomaly_multiplier, BookSide.BID)
    ask_walls = find_anomaly_walls(asks, min_density_usd, anomaly_multiplier, BookSide.ASK)

    is_long = direction == "long"
    walls = bid_walls if is_long else ask_walls
    relevant = bids if is_long else asks
    max_level = max((l.usd for l in relevant), default=0.0)
    avg_lvl = avg_level_usd(relevant)

    if not walls:
        return SpikeAnalysis(
            symbol=book.symbol,
            best_bid=best_bid,
            best_ask=best_ask,
            mid=mid,
            spread_pct=spread_pct,
            bid_walls=bid_walls,
            ask_walls=ask_walls,
            max_level_usd=max_level,
            avg_level_usd=avg_lvl,
            target_side="buy" if is_long else "sell",
            reason=f"Нет плотности ≥ ${min_density_usd:.0f} (макс ${max_level:.0f})",
        )

    strongest = walls[0]
    offset = 0.0002

    if is_long:
        target = min(best_bid, strongest.price * (1 + offset))
        target = max(target, strongest.price * 1.00005)
    else:
        target = max(best_ask, strongest.price * (1 - offset))
        target = min(target, strongest.price * 0.99995)

    dist = _distance_pct(mid, target)

    if dist < min_spread_pct:
        return SpikeAnalysis(
            symbol=book.symbol,
            best_bid=best_bid,
            best_ask=best_ask,
            mid=mid,
            spread_pct=spread_pct,
            bid_walls=bid_walls,
            ask_walls=ask_walls,
            max_level_usd=max_level,
            avg_level_usd=avg_lvl,
            target_entry_price=target,
            target_side="buy" if is_long else "sell",
            distance_pct=dist,
            reason=f"Слишком близко: {dist:.3f}%",
        )

    if dist > max_spread_pct:
        return SpikeAnalysis(
            symbol=book.symbol,
            best_bid=best_bid,
            best_ask=best_ask,
            mid=mid,
            spread_pct=spread_pct,
            bid_walls=bid_walls,
            ask_walls=ask_walls,
            max_level_usd=max_level,
            avg_level_usd=avg_lvl,
            target_entry_price=target,
            target_side="buy" if is_long else "sell",
            distance_pct=dist,
            reason=f"Слишком далеко: {dist:.3f}%",
        )

    return SpikeAnalysis(
        symbol=book.symbol,
        best_bid=best_bid,
        best_ask=best_ask,
        mid=mid,
        spread_pct=spread_pct,
        bid_walls=bid_walls,
        ask_walls=ask_walls,
        max_level_usd=max_level,
        avg_level_usd=avg_lvl,
        target_entry_price=target,
        target_side="buy" if is_long else "sell",
        distance_pct=dist,
        has_opportunity=True,
    )


def should_reposition(current: float, target: float, tolerance_pct: float) -> bool:
    if current <= 0 or target <= 0:
        return True
    drift = abs(current - target) / target * 100
    return drift > tolerance_pct


def detect_spoof(wall: DensityWall, prev_wall: DensityWall | None, vanish_ms: int, threshold_ms: int = 3000) -> bool:
    """Wall appeared and vanished quickly — likely spoof."""
    if prev_wall is None:
        return False
    if vanish_ms < threshold_ms and prev_wall.total_usd >= wall.total_usd * 0.8:
        return True
    return False

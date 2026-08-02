"""Iceberg detection — repeated replenishment at same price level."""

from __future__ import annotations

from collections import defaultdict


class IcebergDetector:
    """Track size replenishment at stable price levels."""

    def __init__(self, *, min_replenish: int = 3, window_ms: int = 30_000) -> None:
        self.min_replenish = min_replenish
        self.window_ms = window_ms
        self._fills: dict[tuple[str, float, str], list[int]] = defaultdict(list)

    def record_fill(self, inst_id: str, price: float, side: str, ts: int) -> bool:
        key = (inst_id, round(price, 8), side)
        self._fills[key].append(ts)
        cutoff = ts - self.window_ms
        self._fills[key] = [t for t in self._fills[key] if t >= cutoff]
        return len(self._fills[key]) >= self.min_replenish

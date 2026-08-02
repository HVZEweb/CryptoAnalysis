"""Liquidity depth tracking — changes, vacuum, replenishment."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class LiquidityTracker:
    """Track depth changes across book updates."""

    inst_id: str
    levels: int = 25
    _history: list[tuple[int, float, float, float]] = field(default_factory=list)
    _max_history: int = 500

    def update(self, ts: int, bid_vol: float, ask_vol: float, total_depth: float) -> None:
        self._history.append((ts, bid_vol, ask_vol, total_depth))
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history :]

    @property
    def last_depth(self) -> float:
        return self._history[-1][3] if self._history else 0.0

    def depth_change_pct(self, lookback: int = 5) -> float:
        if len(self._history) < lookback + 1:
            return 0.0
        prev = self._history[-lookback - 1][3]
        curr = self._history[-1][3]
        if prev <= 0:
            return 0.0
        return (curr - prev) / prev * 100

    def is_vacuum(self, threshold_pct: float = -30.0, lookback: int = 3) -> bool:
        return self.depth_change_pct(lookback) <= threshold_pct

    def is_replenishment(self, threshold_pct: float = 20.0, lookback: int = 3) -> bool:
        ch = self.depth_change_pct(lookback)
        if len(self._history) < lookback + 2:
            return False
        prior_drop = self._history[-lookback - 2][3] - self._history[-lookback][3]
        return prior_drop < 0 and ch >= threshold_pct

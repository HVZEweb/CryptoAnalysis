"""Extended regime performance study on trade lists."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from research.metrics import ResearchMetrics, build_research_metrics
from research.trade_record import SimulatedTrade

REGIME_DIMENSIONS = (
    "regime",
    "trend_regime",
    "volatility_regime",
    "liquidity_regime",
    "impulse_regime",
)


@dataclass
class RegimeSlice:
    dimension: str
    label: str
    metrics: ResearchMetrics
    avg_hold_min: float = 0.0

    def to_dict(self) -> dict:
        return {
            "dimension": self.dimension,
            "label": self.label,
            "metrics": self.metrics.to_dict(),
            "avg_hold_min": round(self.avg_hold_min, 2),
        }


@dataclass
class RegimeStudyReport:
    strategy: str
    symbol: str
    slices: list[RegimeSlice] = field(default_factory=list)
    losing_regimes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "strategy": self.strategy,
            "symbol": self.symbol,
            "slices": [s.to_dict() for s in self.slices],
            "losing_regimes": self.losing_regimes,
        }


def study_regimes(trades: list[SimulatedTrade], *, strategy: str, symbol: str) -> RegimeStudyReport:
    if not trades:
        return RegimeStudyReport(strategy=strategy, symbol=symbol)

    slices: list[RegimeSlice] = []
    losing: list[str] = []

    for dim in REGIME_DIMENSIONS:
        buckets: dict[str, list[SimulatedTrade]] = defaultdict(list)
        for t in trades:
            label = getattr(t, dim, "unknown") or "unknown"
            buckets[label].append(t)
        for label, group in sorted(buckets.items()):
            m = build_research_metrics(group)
            avg_hold = float(np.mean([g.hold_minutes for g in group])) if group else 0.0
            slices.append(RegimeSlice(dimension=dim, label=label, metrics=m, avg_hold_min=avg_hold))
            if m.trades >= 10 and m.expectancy_pct < -0.05:
                losing.append(f"{dim}:{label}")

    return RegimeStudyReport(strategy=strategy, symbol=symbol, slices=slices, losing_regimes=losing)

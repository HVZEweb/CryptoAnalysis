"""Alpha module base types and context."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum

import pandas as pd

from research.metrics import ResearchMetrics
from research.trade_record import SimulatedTrade


class AlphaStatus(str, Enum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    REJECTED_DATA_UNAVAILABLE = "rejected_data_unavailable"
    REJECTED_INSUFFICIENT_TRADES = "rejected_insufficient_trades"
    REJECTED_NEGATIVE_OOS = "rejected_negative_oos"
    REJECTED_OVERFIT = "rejected_overfit"
    REJECTED_UNSTABLE = "rejected_unstable"
    SKIPPED_L2_REQUIRED = "skipped_l2_required"


@dataclass
class AlphaModuleMeta:
    id: str
    name: str
    category: str
    description: str
    data_requirements: tuple[str, ...] = ()
    requires_l2: bool = False


@dataclass
class AlphaContext:
    symbol: str
    timeframe: str
    ohlcv: pd.DataFrame
    funding: pd.DataFrame | None = None
    open_interest: pd.DataFrame | None = None
    liquidations: pd.DataFrame | None = None
    orderbook_snapshots: pd.DataFrame | None = None
    trades_tape: pd.DataFrame | None = None
    cross_assets: dict[str, pd.DataFrame] = field(default_factory=dict)
    events: pd.DataFrame | None = None


@dataclass
class SignificanceResult:
    mean_return_pct: float = 0.0
    ci_low_pct: float = 0.0
    ci_high_pct: float = 0.0
    p_value: float = 1.0
    significant: bool = False
    bootstrap_samples: int = 0

    def to_dict(self) -> dict:
        return {
            "mean_return_pct": round(self.mean_return_pct, 4),
            "ci_low_pct": round(self.ci_low_pct, 4),
            "ci_high_pct": round(self.ci_high_pct, 4),
            "p_value": round(self.p_value, 4),
            "significant": self.significant,
            "bootstrap_samples": self.bootstrap_samples,
        }


@dataclass
class AlphaModuleResult:
    meta: AlphaModuleMeta
    symbol: str
    status: AlphaStatus
    verdict: str
    full_sample: ResearchMetrics | None = None
    in_sample: ResearchMetrics | None = None
    out_of_sample: ResearchMetrics | None = None
    walk_forward: ResearchMetrics | None = None
    rolling: ResearchMetrics | None = None
    significance: SignificanceResult | None = None
    overfitting_score: float = 1.0
    stability_score: float = 0.0
    trades_count: int = 0
    feature_summary: dict = field(default_factory=dict)

    @property
    def viable(self) -> bool:
        return self.status == AlphaStatus.ACCEPTED

    def to_dict(self) -> dict:
        return {
            "module_id": self.meta.id,
            "name": self.meta.name,
            "category": self.meta.category,
            "description": self.meta.description,
            "symbol": self.symbol,
            "status": self.status.value,
            "verdict": self.verdict,
            "viable": self.viable,
            "full_sample": self.full_sample.to_dict() if self.full_sample else None,
            "in_sample": self.in_sample.to_dict() if self.in_sample else None,
            "out_of_sample": self.out_of_sample.to_dict() if self.out_of_sample else None,
            "walk_forward": self.walk_forward.to_dict() if self.walk_forward else None,
            "rolling": self.rolling.to_dict() if self.rolling else None,
            "significance": self.significance.to_dict() if self.significance else None,
            "overfitting_score": round(self.overfitting_score, 3),
            "stability_score": round(self.stability_score, 3),
            "trades_count": self.trades_count,
            "feature_summary": self.feature_summary,
        }


class AlphaModule(ABC):
    meta: AlphaModuleMeta
    tp_pct: float = 0.35
    sl_pct: float = 0.18
    max_hold_bars: int = 12

    def check_data(self, ctx: AlphaContext) -> str | None:
        """Return error message if required data missing."""
        reqs = self.meta.data_requirements
        if "ohlcv" in reqs and (ctx.ohlcv is None or len(ctx.ohlcv) < 100):
            return "OHLCV unavailable"
        if "funding" in reqs and (ctx.funding is None or len(ctx.funding) < 10):
            return "Funding history unavailable — run: python -m alpha.download_data --type funding"
        if "open_interest" in reqs and (ctx.open_interest is None or len(ctx.open_interest) < 10):
            return "Open interest history unavailable — run: python -m alpha.download_data --type oi"
        if "liquidations" in reqs and (ctx.liquidations is None or len(ctx.liquidations) < 5):
            return "Liquidation data unavailable — run: python -m alpha.download_data --type liquidations"
        if "cross_asset" in reqs and not ctx.cross_assets:
            return "Cross-asset OHLCV unavailable"
        if self.meta.requires_l2:
            if ctx.orderbook_snapshots is None or len(ctx.orderbook_snapshots) < 50:
                return "L2 orderbook history required — use alpha.collect_l2 (live collection)"
            if "trades_tape" in reqs and (ctx.trades_tape is None or len(ctx.trades_tape) < 50):
                return "Trade tape required — use alpha.collect_l2"
        return None

    @abstractmethod
    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        """Return feature dataframe aligned to OHLCV index."""

    @abstractmethod
    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        """Return list of (bar_index, side) where side is 'long' or 'short'."""

    def run(self, ctx: AlphaContext) -> list[SimulatedTrade]:
        from alpha.backtest import simulate_entries

        err = self.check_data(ctx)
        if err:
            return []
        features = self.build_features(ctx)
        entries = self.generate_entries(features, ctx)
        return simulate_entries(
            ctx.ohlcv,
            entries,
            strategy=f"alpha:{self.meta.id}",
            symbol=ctx.symbol,
            tp_pct=self.tp_pct,
            sl_pct=self.sl_pct,
            max_hold_bars=self.max_hold_bars,
        )

"""Toggleable simulation components for ablation / forensic analysis."""

from __future__ import annotations

from dataclasses import dataclass, field


ABLATION_COMPONENTS = (
    "ema",
    "rsi",
    "vwap",
    "atr",
    "bollinger",
    "mean_reversion",
    "ev_filter",
    "ai_filter",
    "confidence_filter",
    "trend_filter",
    "regime_filter",
    "trailing_stop",
    "take_profit",
    "stop_loss",
)

HFT_ABLATION_COMPONENTS = (
    "density_filter",
    "anomaly_filter",
    "spread_distance",
    "ev_filter",
    "score_filter",
    "ai_filter",
    "take_profit",
    "stop_loss",
)


@dataclass
class SimulationFlags:
    """Quant scalping simulation toggles."""

    use_ema: bool = True
    use_rsi: bool = True
    use_vwap: bool = False
    use_atr: bool = True
    use_bollinger: bool = True
    use_mean_reversion: bool = True
    use_ev_filter: bool = False
    use_ai_filter: bool = False
    use_confidence_filter: bool = False
    use_trend_filter: bool = True
    use_regime_filter: bool = False
    use_trailing_stop: bool = False
    use_take_profit: bool = True
    use_stop_loss: bool = True

    min_ev_usd: float = 0.0
    min_confidence: float = 60.0
    min_ai_confidence: float = 60.0
    blocked_regimes: tuple[str, ...] = ("high_volatility",)
    notional_usd: float = 25.0

    @classmethod
    def legacy(cls) -> SimulationFlags:
        """Matches pre-forensic chronological simulator."""
        return cls()

    @classmethod
    def forensic_baseline(cls, *, min_ev_usd: float = 0.0, min_confidence: float = 60.0) -> SimulationFlags:
        """Full component set for forensic ablation baseline."""
        return cls(
            use_vwap=True,
            use_ev_filter=True,
            use_ai_filter=True,
            use_confidence_filter=True,
            use_regime_filter=True,
            use_trailing_stop=True,
            min_ev_usd=min_ev_usd,
            min_confidence=min_confidence,
        )

    def with_disabled(self, component: str) -> SimulationFlags:
        import copy

        f = copy.copy(self)
        key = {
            "ema": "use_ema",
            "rsi": "use_rsi",
            "vwap": "use_vwap",
            "atr": "use_atr",
            "bollinger": "use_bollinger",
            "mean_reversion": "use_mean_reversion",
            "ev_filter": "use_ev_filter",
            "ai_filter": "use_ai_filter",
            "confidence_filter": "use_confidence_filter",
            "trend_filter": "use_trend_filter",
            "regime_filter": "use_regime_filter",
            "trailing_stop": "use_trailing_stop",
            "take_profit": "use_take_profit",
            "stop_loss": "use_stop_loss",
        }.get(component)
        if key:
            setattr(f, key, False)
        return f

    def active_components(self) -> list[str]:
        return [c for c in ABLATION_COMPONENTS if getattr(self, f"use_{c}" if c != "ev_filter" else "use_ev_filter", True)]


@dataclass
class HftSimulationFlags:
    """HFT orderbook simulation toggles (synthetic book)."""

    use_density_filter: bool = True
    use_anomaly_filter: bool = True
    use_spread_distance: bool = True
    use_ev_filter: bool = True
    use_score_filter: bool = True
    use_ai_filter: bool = False
    use_take_profit: bool = True
    use_stop_loss: bool = True

    min_score: float = 75.0
    min_ev_usd: float = 0.05
    min_ai_confidence: float = 60.0

    @classmethod
    def legacy(cls) -> HftSimulationFlags:
        return cls()

    @classmethod
    def forensic_baseline(cls, *, min_score: float = 75.0, min_ev_usd: float = 0.05) -> HftSimulationFlags:
        return cls(use_ai_filter=True, min_score=min_score, min_ev_usd=min_ev_usd)

    def with_disabled(self, component: str) -> HftSimulationFlags:
        import copy

        f = copy.copy(self)
        key = {
            "density_filter": "use_density_filter",
            "anomaly_filter": "use_anomaly_filter",
            "spread_distance": "use_spread_distance",
            "ev_filter": "use_ev_filter",
            "score_filter": "use_score_filter",
            "ai_filter": "use_ai_filter",
            "take_profit": "use_take_profit",
            "stop_loss": "use_stop_loss",
        }.get(component)
        if key:
            setattr(f, key, False)
        return f

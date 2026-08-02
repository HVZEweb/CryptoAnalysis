"""Trade diagnostics — grouping, factor heatmaps, loss analysis."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from research.metrics import ResearchMetrics, build_research_metrics
from research.trade_record import SimulatedTrade


@dataclass
class TradeGroupStats:
    name: str
    count: int
    metrics: ResearchMetrics
    avg_rsi: float = 0.0
    avg_confidence: float = 0.0
    avg_hold_bars: float = 0.0
    common_signal_modes: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "count": self.count,
            "metrics": self.metrics.to_dict(),
            "avg_rsi": round(self.avg_rsi, 2),
            "avg_confidence": round(self.avg_confidence, 2),
            "avg_hold_bars": round(self.avg_hold_bars, 2),
            "common_signal_modes": self.common_signal_modes,
        }


@dataclass
class DiagnosticsReport:
    strategy: str
    symbol: str
    total_trades: int
    groups: list[TradeGroupStats] = field(default_factory=list)
    heatmap: dict[str, dict[str, float]] = field(default_factory=dict)
    loss_drivers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "strategy": self.strategy,
            "symbol": self.symbol,
            "total_trades": self.total_trades,
            "groups": [g.to_dict() for g in self.groups],
            "heatmap": self.heatmap,
            "loss_drivers": self.loss_drivers,
        }


def _group_stats(name: str, trades: list[SimulatedTrade]) -> TradeGroupStats:
    m = build_research_metrics(trades)
    modes: dict[str, int] = defaultdict(int)
    for t in trades:
        modes[t.signal_mode or "unknown"] += 1
    return TradeGroupStats(
        name=name,
        count=len(trades),
        metrics=m,
        avg_rsi=float(np.mean([t.entry_rsi for t in trades])) if trades else 0.0,
        avg_confidence=float(np.mean([t.entry_confidence for t in trades])) if trades else 0.0,
        avg_hold_bars=float(np.mean([t.hold_bars for t in trades])) if trades else 0.0,
        common_signal_modes=dict(modes),
    )


def _heatmap_factor(trades: list[SimulatedTrade], factor: str) -> dict[str, float]:
    buckets: dict[str, list[float]] = defaultdict(list)
    for t in trades:
        val = getattr(t, factor, None) or t.extra.get(factor)
        if val is None or val == "" or val == "unknown":
            key = "unknown"
        elif factor == "entry_rsi":
            if val < 35:
                key = "rsi_oversold"
            elif val > 65:
                key = "rsi_overbought"
            else:
                key = "rsi_neutral"
        elif factor == "entry_atr_pct":
            key = "atr_high" if val > 1.5 else "atr_low"
        else:
            key = str(val)
        buckets[key].append(t.net_return_pct)
    return {k: round(float(np.mean(v)), 4) for k, v in buckets.items() if v}


def analyze_trades(trades: list[SimulatedTrade], *, strategy: str, symbol: str) -> DiagnosticsReport:
    if not trades:
        return DiagnosticsReport(strategy=strategy, symbol=symbol, total_trades=0)

    winners = [t for t in trades if t.net_return_pct > 0]
    losers = [t for t in trades if t.net_return_pct <= 0]
    by_exit: dict[str, list[SimulatedTrade]] = defaultdict(list)
    for t in trades:
        by_exit[t.exit_reason or "unknown"].append(t)

    groups = [
        _group_stats("profitable", winners),
        _group_stats("losing", losers),
        _group_stats("stop_loss", by_exit.get("sl", [])),
        _group_stats("take_profit", by_exit.get("tp", [])),
        _group_stats("timeout", by_exit.get("timeout", [])),
        _group_stats("trailing", by_exit.get("trailing", [])),
        _group_stats("hft_capture", by_exit.get("hft_capture", [])),
    ]
    groups = [g for g in groups if g.count > 0]

    heatmap = {
        "signal_mode": _heatmap_factor(trades, "signal_mode"),
        "exit_reason": _heatmap_factor(trades, "exit_reason"),
        "trend_regime": _heatmap_factor(trades, "trend_regime"),
        "volatility_regime": _heatmap_factor(trades, "volatility_regime"),
        "liquidity_regime": _heatmap_factor(trades, "liquidity_regime"),
        "impulse_regime": _heatmap_factor(trades, "impulse_regime"),
        "entry_rsi": _heatmap_factor(trades, "entry_rsi"),
        "entry_atr_pct": _heatmap_factor(trades, "entry_atr_pct"),
        "side": _heatmap_factor(trades, "side"),
    }

    loss_drivers: list[str] = []
    if losers:
        sl_share = len(by_exit.get("sl", [])) / len(trades) * 100
        timeout_share = len(by_exit.get("timeout", [])) / len(trades) * 100
        if sl_share > 40:
            loss_drivers.append(f"Stop-loss exits dominate ({sl_share:.0f}% of trades)")
        if timeout_share > 30:
            loss_drivers.append(f"Time exits dominate ({timeout_share:.0f}% of trades)")
        worst_regime = min(
            heatmap.get("trend_regime", {"n/a": 0}).items(),
            key=lambda x: x[1],
            default=("n/a", 0),
        )
        if worst_regime[1] < -0.1:
            loss_drivers.append(f"Worst trend regime: {worst_regime[0]} (avg EV {worst_regime[1]:.3f}%)")
        trend_losses = [t for t in losers if t.signal_mode == "trend"]
        mr_losses = [t for t in losers if t.signal_mode == "mean_reversion"]
        if len(trend_losses) > len(mr_losses) * 1.5:
            loss_drivers.append("Trend signals contribute disproportionately to losses")
        elif len(mr_losses) > len(trend_losses) * 1.5:
            loss_drivers.append("Mean-reversion signals contribute disproportionately to losses")

    return DiagnosticsReport(
        strategy=strategy,
        symbol=symbol,
        total_trades=len(trades),
        groups=groups,
        heatmap=heatmap,
        loss_drivers=loss_drivers,
    )

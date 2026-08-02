"""Extended research metrics with expectancy, fees, hold time."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from backtest.metrics import build_metrics, max_drawdown_pct, sharpe_ratio, sortino_ratio
from research.trade_record import SimulatedTrade


@dataclass
class ResearchMetrics:
    trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    profit_factor: float = 0.0
    expectancy_pct: float = 0.0
    expectancy_usd_per_notional: float = 0.0
    total_return_pct: float = 0.0
    max_drawdown_pct: float = 100.0
    sharpe_ratio: float = -5.0
    sortino_ratio: float = -5.0
    calmar_ratio: float = 0.0
    avg_hold_bars: float = 0.0
    avg_hold_min: float = 0.0
    total_fees_pct: float = 0.0
    total_slippage_pct: float = 0.0
    avg_win_pct: float = 0.0
    avg_loss_pct: float = 0.0
    stability_score: float = 0.0
    equity_curve: list[float] = field(default_factory=lambda: [1.0])

    @property
    def has_edge(self) -> bool:
        return (
            self.trades >= 5
            and self.expectancy_pct > 0
            and self.profit_factor > 1.0
            and self.sharpe_ratio > 0
        )

    @property
    def recovery_factor(self) -> float:
        if self.max_drawdown_pct <= 0:
            return 0.0
        return self.total_return_pct / self.max_drawdown_pct

    def to_dict(self) -> dict[str, float | int | bool]:
        return {
            "trades": self.trades,
            "wins": self.wins,
            "losses": self.losses,
            "win_rate": round(self.win_rate, 2),
            "profit_factor": round(self.profit_factor, 3),
            "expectancy_pct": round(self.expectancy_pct, 4),
            "expectancy_usd_per_notional": round(self.expectancy_usd_per_notional, 6),
            "total_return_pct": round(self.total_return_pct, 3),
            "max_drawdown_pct": round(self.max_drawdown_pct, 2),
            "sharpe_ratio": round(self.sharpe_ratio, 3),
            "sortino_ratio": round(self.sortino_ratio, 3),
            "calmar_ratio": round(self.calmar_ratio, 3),
            "recovery_factor": round(self.recovery_factor, 3),
            "avg_hold_bars": round(self.avg_hold_bars, 2),
            "avg_hold_min": round(self.avg_hold_min, 2),
            "total_fees_pct": round(self.total_fees_pct, 4),
            "total_slippage_pct": round(self.total_slippage_pct, 4),
            "avg_win_pct": round(self.avg_win_pct, 4),
            "avg_loss_pct": round(self.avg_loss_pct, 4),
            "stability_score": round(self.stability_score, 3),
            "has_edge": self.has_edge,
        }


def overfitting_score(in_sample: ResearchMetrics, out_of_sample: ResearchMetrics) -> float:
    """Higher = more overfit. 0 = stable, 1+ = severe."""
    if in_sample.trades < 5 or out_of_sample.trades < 5:
        return 1.0
    sharpe_gap = in_sample.sharpe_ratio - out_of_sample.sharpe_ratio
    ev_gap = in_sample.expectancy_pct - out_of_sample.expectancy_pct
    denom = max(abs(in_sample.sharpe_ratio), 0.01)
    return max(0.0, min(2.0, sharpe_gap / denom + ev_gap * 0.1))


def build_research_metrics(
    trades: list[SimulatedTrade],
    *,
    bar_minutes: int = 5,
    stability_score: float = 0.0,
) -> ResearchMetrics:
    if not trades:
        return ResearchMetrics(stability_score=stability_score)

    net_returns = [t.net_return_pct / 100 for t in trades]
    base = build_metrics(net_returns)

    wins = [t for t in trades if t.net_return_pct > 0]
    losses = [t for t in trades if t.net_return_pct < 0]
    gross_profit = sum(t.net_return_pct for t in wins)
    gross_loss = abs(sum(t.net_return_pct for t in losses))
    pf = gross_profit / gross_loss if gross_loss > 0 else (10.0 if gross_profit > 0 else 0.0)

    win_rate = len(wins) / len(trades)
    avg_win = float(np.mean([t.net_return_pct for t in wins])) if wins else 0.0
    avg_loss = float(np.mean([t.net_return_pct for t in losses])) if losses else 0.0
    loss_rate = len(losses) / len(trades)
    expectancy = win_rate * avg_win + loss_rate * avg_loss

    hold_bars = [float(t.hold_bars) for t in trades]
    fees = sum(t.fees_pct for t in trades)
    slip = sum(t.slippage_pct for t in trades)

    return ResearchMetrics(
        trades=len(trades),
        wins=len(wins),
        losses=len(losses),
        win_rate=win_rate * 100,
        profit_factor=pf,
        expectancy_pct=expectancy,
        expectancy_usd_per_notional=expectancy / 100,
        total_return_pct=base.total_return_pct,
        max_drawdown_pct=base.max_drawdown_pct,
        sharpe_ratio=base.sharpe_ratio,
        sortino_ratio=base.sortino_ratio,
        calmar_ratio=base.calmar_ratio,
        avg_hold_bars=float(np.mean(hold_bars)),
        avg_hold_min=float(np.mean(hold_bars)) * bar_minutes,
        total_fees_pct=fees,
        total_slippage_pct=slip,
        avg_win_pct=avg_win,
        avg_loss_pct=avg_loss,
        stability_score=stability_score,
        equity_curve=base.equity_curve[-100:],
    )


def aggregate_fold_metrics(folds: list[ResearchMetrics]) -> ResearchMetrics:
    if not folds:
        return ResearchMetrics()

    sharpes = [f.sharpe_ratio for f in folds if f.trades >= 3]
    expectancies = [f.expectancy_pct for f in folds if f.trades >= 3]
    positive = sum(1 for e in expectancies if e > 0)
    stability = (positive / len(expectancies) * 100) if expectancies else 0.0

    trades = sum(f.trades for f in folds)
    total_return = float(np.median([f.total_return_pct for f in folds]))
    max_dd = float(np.percentile([f.max_drawdown_pct for f in folds], 75))
    pf = float(np.median([f.profit_factor for f in folds if f.trades > 0] or [0]))
    exp = float(np.median(expectancies or [0]))
    sharpe = float(np.median(sharpes or [-5]))
    sortino = float(np.median([f.sortino_ratio for f in folds if f.trades > 0] or [-5]))

    return ResearchMetrics(
        trades=trades,
        win_rate=float(np.median([f.win_rate for f in folds if f.trades > 0] or [0])),
        profit_factor=pf,
        expectancy_pct=exp,
        total_return_pct=total_return,
        max_drawdown_pct=max_dd,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        avg_hold_min=float(np.median([f.avg_hold_min for f in folds if f.trades > 0] or [0])),
        total_fees_pct=float(np.sum([f.total_fees_pct for f in folds])),
        total_slippage_pct=float(np.sum([f.total_slippage_pct for f in folds])),
        stability_score=stability,
    )

"""Risk-adjusted performance metrics — Sharpe, drawdown, composite score."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass
class PerformanceMetrics:
    trades: int
    win_rate: float
    total_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    sortino_ratio: float
    profit_factor: float
    avg_trade_pct: float
    equity_curve: list[float]

    @property
    def calmar_ratio(self) -> float:
        if self.max_drawdown_pct <= 0.01:
            return self.total_return_pct
        return self.total_return_pct / self.max_drawdown_pct


def compute_equity_curve(trade_returns: list[float], start: float = 1.0) -> list[float]:
    curve = [start]
    for r in trade_returns:
        curve.append(curve[-1] * (1 + r))
    return curve


def max_drawdown_pct(equity: list[float]) -> float:
    if len(equity) < 2:
        return 0.0
    peak = equity[0]
    max_dd = 0.0
    for v in equity:
        peak = max(peak, v)
        dd = (peak - v) / peak * 100 if peak > 0 else 0.0
        max_dd = max(max_dd, dd)
    return max_dd


def sharpe_ratio(returns: list[float], periods_per_year: float = 252 * 24 * 12) -> float:
    """Annualized Sharpe from per-trade returns (5m scalping ~ many trades/year)."""
    if len(returns) < 2:
        return -1.0
    arr = np.array(returns, dtype=float)
    std = float(arr.std(ddof=1))
    if std < 1e-12:
        return 0.0 if abs(float(arr.mean())) < 1e-12 else (10.0 if arr.mean() > 0 else -10.0)
    # Scale: assume ~trades_per_year proportional to sample
    trades_per_year = min(periods_per_year, len(returns) * 12)
    return float(arr.mean() / std * math.sqrt(trades_per_year))


def sortino_ratio(returns: list[float], periods_per_year: float = 252 * 24 * 12) -> float:
    if len(returns) < 2:
        return -1.0
    arr = np.array(returns, dtype=float)
    downside = arr[arr < 0]
    if len(downside) == 0:
        return 10.0 if float(arr.mean()) > 0 else 0.0
    down_std = float(downside.std(ddof=1))
    if down_std < 1e-12:
        return 10.0
    trades_per_year = min(periods_per_year, len(returns) * 12)
    return float(arr.mean() / down_std * math.sqrt(trades_per_year))


def build_metrics(trade_returns: list[float]) -> PerformanceMetrics:
    if not trade_returns:
        return PerformanceMetrics(
            trades=0,
            win_rate=0.0,
            total_return_pct=0.0,
            max_drawdown_pct=100.0,
            sharpe_ratio=-5.0,
            sortino_ratio=-5.0,
            profit_factor=0.0,
            avg_trade_pct=0.0,
            equity_curve=[1.0],
        )

    equity = compute_equity_curve(trade_returns)
    wins = sum(1 for r in trade_returns if r > 0)
    gross_profit = sum(r for r in trade_returns if r > 0)
    gross_loss = abs(sum(r for r in trade_returns if r < 0))
    pf = gross_profit / gross_loss if gross_loss > 0 else (10.0 if gross_profit > 0 else 0.0)

    return PerformanceMetrics(
        trades=len(trade_returns),
        win_rate=wins / len(trade_returns) * 100,
        total_return_pct=(equity[-1] - 1) * 100,
        max_drawdown_pct=max_drawdown_pct(equity),
        sharpe_ratio=sharpe_ratio(trade_returns),
        sortino_ratio=sortino_ratio(trade_returns),
        profit_factor=pf,
        avg_trade_pct=float(np.mean(trade_returns)) * 100,
        equity_curve=equity,
    )


def composite_score(
    sharpe: float,
    max_dd_pct: float,
    trades: int,
    *,
    min_trades: int = 3,
    sharpe_weight: float = 0.55,
    dd_weight: float = 0.35,
    trades_weight: float = 0.10,
) -> float:
    """
    Оптимизация под Sharpe + минимальная просадка (не под raw profit).
    max_dd_pct: чем меньше, тем лучше.
    """
    if trades < min_trades:
        return -10.0 + trades * 0.5

    sharpe_norm = max(-2.0, min(5.0, sharpe)) / 5.0
    dd_norm = max(0.0, min(50.0, max_dd_pct)) / 50.0
    dd_score = 1.0 - dd_norm
    trades_norm = min(1.0, trades / 20.0)

    return sharpe_weight * sharpe_norm + dd_weight * dd_score + trades_weight * trades_norm


def aggregate_metrics(metrics_list: list[PerformanceMetrics]) -> dict[str, float]:
    """Aggregate across scenarios — conservative (median sharpe, p90 drawdown)."""
    if not metrics_list:
        return {"sharpe": -5, "max_dd": 100, "trades": 0, "return_pct": 0, "score": -10}

    sharpes = [m.sharpe_ratio for m in metrics_list]
    dds = [m.max_drawdown_pct for m in metrics_list]
    trades = [m.trades for m in metrics_list]
    returns = [m.total_return_pct for m in metrics_list]

    med_sharpe = float(np.median(sharpes))
    p90_dd = float(np.percentile(dds, 90))
    med_trades = float(np.median(trades))
    med_return = float(np.median(returns))
    sortinos = [m.sortino_ratio for m in metrics_list if not (isinstance(m.sortino_ratio, float) and np.isnan(m.sortino_ratio))]
    med_sortino = float(np.median(sortinos)) if sortinos else 0.0

    score = composite_score(med_sharpe, p90_dd, int(med_trades))
    return {
        "sharpe": med_sharpe,
        "max_dd": p90_dd,
        "trades": med_trades,
        "return_pct": med_return,
        "score": score,
        "sortino": med_sortino,
        "win_rate": float(np.median([m.win_rate for m in metrics_list])),
    }

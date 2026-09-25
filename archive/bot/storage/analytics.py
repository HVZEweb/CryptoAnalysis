"""Trade analytics — aggregate metrics from closed trades."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np

from backtest.metrics import build_metrics, max_drawdown_pct, sharpe_ratio, sortino_ratio
from storage.trades import TradeRecord, TradeRepository


@dataclass
class StrategyAnalytics:
    strategy: str
    trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    total_pnl_usd: float = 0.0
    profit_factor: float = 0.0
    expectancy_usd: float = 0.0
    avg_win_usd: float = 0.0
    avg_loss_usd: float = 0.0
    avg_pnl_usd: float = 0.0
    sharpe_ratio: float = 0.0
    sortino_ratio: float = 0.0
    calmar_ratio: float = 0.0
    max_drawdown_pct: float = 0.0
    recovery_factor: float = 0.0
    avg_hold_ms: float = 0.0
    avg_hold_min: float = 0.0
    avg_ev: float = 0.0
    avg_confidence: float = 0.0


@dataclass
class AnalyticsReport:
    computed_at: str
    total_trades: int
    closed_trades: int
    open_trades: int
    overall: StrategyAnalytics
    by_strategy: dict[str, StrategyAnalytics] = field(default_factory=dict)
    equity_curve: list[float] = field(default_factory=list)
    recent_trades: list[dict[str, Any]] = field(default_factory=list)


class AnalyticsEngine:
    def __init__(self, repo: TradeRepository | None = None) -> None:
        self.repo = repo or TradeRepository()

    def compute(self, *, strategy: str | None = None, limit: int = 500) -> AnalyticsReport:
        trades = self.repo.list_trades(limit=limit, strategy=strategy)
        closed = [t for t in trades if t.get("status") == "closed"]
        open_trades = [t for t in trades if t.get("status") == "open"]

        overall = self._aggregate(closed, "all")
        by_strat: dict[str, StrategyAnalytics] = {}
        strategies = {t["strategy"] for t in closed}
        for strat in strategies:
            strat_closed = [t for t in closed if t["strategy"] == strat]
            by_strat[strat] = self._aggregate(strat_closed, strat)

        returns = self._trade_returns(closed)
        equity = [1.0]
        for r in returns:
            equity.append(equity[-1] * (1 + r))

        return AnalyticsReport(
            computed_at=datetime.utcnow().isoformat(),
            total_trades=len(trades),
            closed_trades=len(closed),
            open_trades=len(open_trades),
            overall=overall,
            by_strategy=by_strat,
            equity_curve=equity[-50:],
            recent_trades=trades[:20],
        )

    def _aggregate(self, closed: list[dict[str, Any]], label: str) -> StrategyAnalytics:
        if not closed:
            return StrategyAnalytics(strategy=label)

        pnls = [float(t.get("pnl_usd") or 0) for t in closed]
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p < 0]

        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))
        pf = gross_profit / gross_loss if gross_loss > 0 else (10.0 if gross_profit > 0 else 0.0)

        win_rate = len(wins) / len(closed) * 100
        avg_win = float(np.mean(wins)) if wins else 0.0
        avg_loss = float(np.mean(losses)) if losses else 0.0
        loss_rate = len(losses) / len(closed)
        win_r = len(wins) / len(closed)
        expectancy = win_r * avg_win + loss_rate * avg_loss

        returns = self._trade_returns(closed)
        metrics = build_metrics(returns)
        equity = metrics.equity_curve
        max_dd = max_drawdown_pct(equity)
        total_pnl = sum(pnls)
        recovery = total_pnl / max(max_dd * sum(float(t.get("notional_usd") or 1) for t in closed) / len(closed) / 100, 0.01)

        hold_times = [float(t.get("hold_ms") or 0) for t in closed]
        avg_hold = float(np.mean(hold_times)) if hold_times else 0.0

        return StrategyAnalytics(
            strategy=label,
            trades=len(closed),
            wins=len(wins),
            losses=len(losses),
            win_rate=win_rate,
            total_pnl_usd=total_pnl,
            profit_factor=pf,
            expectancy_usd=expectancy,
            avg_win_usd=avg_win,
            avg_loss_usd=avg_loss,
            avg_pnl_usd=float(np.mean(pnls)),
            sharpe_ratio=metrics.sharpe_ratio,
            sortino_ratio=metrics.sortino_ratio,
            calmar_ratio=metrics.calmar_ratio,
            max_drawdown_pct=max_dd,
            recovery_factor=recovery,
            avg_hold_ms=avg_hold,
            avg_hold_min=avg_hold / 60_000,
            avg_ev=float(np.mean([float(t.get("expected_value") or 0) for t in closed])),
            avg_confidence=float(np.mean([float(t.get("confidence") or 0) for t in closed])),
        )

    @staticmethod
    def _trade_returns(closed: list[dict[str, Any]]) -> list[float]:
        returns: list[float] = []
        for t in closed:
            if t.get("pnl_pct"):
                returns.append(float(t["pnl_pct"]) / 100)
                continue
            pnl = float(t.get("pnl_usd") or 0)
            notional = float(t.get("notional_usd") or 0)
            if notional > 0:
                returns.append(pnl / notional)
            elif t.get("entry_price") and t.get("exit_price"):
                entry = float(t["entry_price"])
                exit_p = float(t["exit_price"])
                side = t.get("side", "long")
                if side == "long":
                    returns.append((exit_p - entry) / entry)
                else:
                    returns.append((entry - exit_p) / entry)
        return returns

    def to_dict(self, report: AnalyticsReport) -> dict[str, Any]:
        def strat_dict(s: StrategyAnalytics) -> dict[str, Any]:
            return {
                "strategy": s.strategy,
                "trades": s.trades,
                "wins": s.wins,
                "losses": s.losses,
                "win_rate": round(s.win_rate, 2),
                "total_pnl_usd": round(s.total_pnl_usd, 4),
                "profit_factor": round(s.profit_factor, 3),
                "expectancy_usd": round(s.expectancy_usd, 4),
                "avg_win_usd": round(s.avg_win_usd, 4),
                "avg_loss_usd": round(s.avg_loss_usd, 4),
                "avg_pnl_usd": round(s.avg_pnl_usd, 4),
                "sharpe_ratio": round(s.sharpe_ratio, 3),
                "sortino_ratio": round(s.sortino_ratio, 3),
                "calmar_ratio": round(s.calmar_ratio, 3),
                "max_drawdown_pct": round(s.max_drawdown_pct, 2),
                "recovery_factor": round(s.recovery_factor, 3),
                "avg_hold_min": round(s.avg_hold_min, 2),
                "avg_ev": round(s.avg_ev, 4),
                "avg_confidence": round(s.avg_confidence, 1),
            }

        return {
            "computed_at": report.computed_at,
            "total_trades": report.total_trades,
            "closed_trades": report.closed_trades,
            "open_trades": report.open_trades,
            "overall": strat_dict(report.overall),
            "by_strategy": {k: strat_dict(v) for k, v in report.by_strategy.items()},
            "equity_curve": [round(v, 4) for v in report.equity_curve],
            "recent_trades": report.recent_trades,
        }

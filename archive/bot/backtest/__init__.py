"""Backtest package — unified framework for strategy evaluation."""

from backtest.framework import BacktestConfig, BacktestRunner, BacktestRunResult
from backtest.metrics import PerformanceMetrics, build_metrics, composite_score

__all__ = [
    "BacktestConfig",
    "BacktestRunner",
    "BacktestRunResult",
    "PerformanceMetrics",
    "build_metrics",
    "composite_score",
]

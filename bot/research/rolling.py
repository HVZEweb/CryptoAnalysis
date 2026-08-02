"""Rolling window backtests — stability across sliding periods."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from backtest.fast_backtest import StrategyParams
from research.chronological import run_hft_chronological, run_quant_chronological
from research.config import ExecutionModel, ResearchConfig
from research.metrics import ResearchMetrics, build_research_metrics


@dataclass
class RollingWindowResult:
    strategy: str
    symbol: str
    windows: list[ResearchMetrics] = field(default_factory=list)
    aggregate: ResearchMetrics | None = None
    positive_windows_pct: float = 0.0
    sharpe_std: float = 0.0


def run_rolling_quant(
    df: pd.DataFrame,
    params: StrategyParams,
    execution: ExecutionModel,
    config: ResearchConfig,
    *,
    symbol: str,
) -> RollingWindowResult:
    result = RollingWindowResult(strategy="quant_scalping", symbol=symbol)
    all_trades = []

    start = 0
    while start + config.rolling_window_bars <= len(df):
        window = df.iloc[start : start + config.rolling_window_bars]
        trades = run_quant_chronological(window, params, execution, symbol=symbol)
        metrics = build_research_metrics(trades)
        result.windows.append(metrics)
        all_trades.extend(trades)
        start += config.rolling_step_bars

    if result.windows:
        positive = sum(1 for w in result.windows if w.expectancy_pct > 0 and w.trades >= 3)
        result.positive_windows_pct = positive / len(result.windows) * 100
        sharpes = [w.sharpe_ratio for w in result.windows if w.trades >= 3]
        result.sharpe_std = float(np.std(sharpes)) if len(sharpes) > 1 else 0.0

    stability = result.positive_windows_pct
    result.aggregate = build_research_metrics(all_trades, stability_score=stability)
    return result


def run_rolling_hft(
    df: pd.DataFrame,
    execution: ExecutionModel,
    config: ResearchConfig,
    *,
    symbol: str,
) -> RollingWindowResult:
    result = RollingWindowResult(strategy="hft_orderbook", symbol=symbol)
    all_trades = []

    start = 0
    while start + config.rolling_window_bars <= len(df):
        window = df.iloc[start : start + config.rolling_window_bars]
        trades = run_hft_chronological(window, execution, symbol=symbol, latency_bars=execution.latency_bars)
        metrics = build_research_metrics(trades)
        result.windows.append(metrics)
        all_trades.extend(trades)
        start += config.rolling_step_bars

    if result.windows:
        positive = sum(1 for w in result.windows if w.expectancy_pct > 0 and w.trades >= 3)
        result.positive_windows_pct = positive / len(result.windows) * 100
        sharpes = [w.sharpe_ratio for w in result.windows if w.trades >= 3]
        result.sharpe_std = float(np.std(sharpes)) if len(sharpes) > 1 else 0.0

    stability = result.positive_windows_pct
    result.aggregate = build_research_metrics(all_trades, stability_score=stability)
    return result

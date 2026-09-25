"""Walk-forward testing — train window then test on next unseen period."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from backtest.fast_backtest import StrategyParams
from research.chronological import run_hft_chronological, run_quant_chronological
from research.config import ExecutionModel, ResearchConfig
from research.metrics import ResearchMetrics, build_research_metrics


@dataclass
class WalkForwardFold:
    fold_id: int
    train_start: int
    train_end: int
    test_start: int
    test_end: int
    train_metrics: ResearchMetrics
    test_metrics: ResearchMetrics
    strategy: str
    symbol: str


@dataclass
class WalkForwardResult:
    strategy: str
    symbol: str
    folds: list[WalkForwardFold] = field(default_factory=list)
    aggregate_oos: ResearchMetrics | None = None


def _split_folds(
    df: pd.DataFrame,
    train_bars: int,
    test_bars: int,
    step_bars: int,
) -> list[tuple[slice, slice]]:
    folds: list[tuple[slice, slice]] = []
    start = 0
    fold_id = 0
    while start + train_bars + test_bars <= len(df):
        train_sl = slice(start, start + train_bars)
        test_sl = slice(start + train_bars, start + train_bars + test_bars)
        folds.append((train_sl, test_sl))
        start += step_bars
        fold_id += 1
        if fold_id > 50:
            break
    return folds


def run_walk_forward_quant(
    df: pd.DataFrame,
    params: StrategyParams,
    execution: ExecutionModel,
    config: ResearchConfig,
    *,
    symbol: str,
) -> WalkForwardResult:
    folds_data = _split_folds(df, config.train_bars, config.test_bars, config.walk_forward_step)
    result = WalkForwardResult(strategy="quant_scalping", symbol=symbol)
    oos_trades = []

    for i, (train_sl, test_sl) in enumerate(folds_data):
        train_df = df.iloc[train_sl]
        test_df = df.iloc[test_sl]
        train_trades = run_quant_chronological(train_df, params, execution, symbol=symbol)
        test_trades = run_quant_chronological(test_df, params, execution, symbol=symbol)
        oos_trades.extend(test_trades)

        result.folds.append(
            WalkForwardFold(
                fold_id=i,
                train_start=train_sl.start or 0,
                train_end=train_sl.stop or 0,
                test_start=test_sl.start or 0,
                test_end=test_sl.stop or 0,
                train_metrics=build_research_metrics(train_trades),
                test_metrics=build_research_metrics(test_trades),
                strategy="quant_scalping",
                symbol=symbol,
            )
        )

    positive_folds = sum(1 for f in result.folds if f.test_metrics.expectancy_pct > 0 and f.test_metrics.trades >= 3)
    stability = (positive_folds / len(result.folds) * 100) if result.folds else 0.0
    result.aggregate_oos = build_research_metrics(oos_trades, stability_score=stability)
    return result


def run_walk_forward_hft(
    df: pd.DataFrame,
    execution: ExecutionModel,
    config: ResearchConfig,
    *,
    symbol: str,
) -> WalkForwardResult:
    folds_data = _split_folds(df, config.train_bars, config.test_bars, config.walk_forward_step)
    result = WalkForwardResult(strategy="hft_orderbook", symbol=symbol)
    oos_trades = []

    for i, (train_sl, test_sl) in enumerate(folds_data):
        train_df = df.iloc[train_sl]
        test_df = df.iloc[test_sl]
        train_trades = run_hft_chronological(train_df, execution, symbol=symbol, latency_bars=execution.latency_bars)
        test_trades = run_hft_chronological(test_df, execution, symbol=symbol, latency_bars=execution.latency_bars)
        oos_trades.extend(test_trades)

        result.folds.append(
            WalkForwardFold(
                fold_id=i,
                train_start=train_sl.start or 0,
                train_end=train_sl.stop or 0,
                test_start=test_sl.start or 0,
                test_end=test_sl.stop or 0,
                train_metrics=build_research_metrics(train_trades),
                test_metrics=build_research_metrics(test_trades),
                strategy="hft_orderbook",
                symbol=symbol,
            )
        )

    positive_folds = sum(1 for f in result.folds if f.test_metrics.expectancy_pct > 0 and f.test_metrics.trades >= 3)
    stability = (positive_folds / len(result.folds) * 100) if result.folds else 0.0
    result.aggregate_oos = build_research_metrics(oos_trades, stability_score=stability)
    return result

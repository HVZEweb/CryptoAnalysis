"""Regime-segmented performance analysis."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from backtest.fast_backtest import StrategyParams
from research.chronological import run_hft_chronological, run_quant_chronological
from research.config import ExecutionModel
from research.metrics import ResearchMetrics, build_research_metrics
from research.regime_analyzer import segment_by_regime


@dataclass
class RegimeBreakdown:
    strategy: str
    symbol: str
    by_regime: dict[str, ResearchMetrics] = field(default_factory=dict)
    best_regime: str = ""
    worst_regime: str = ""


def analyze_by_regime_quant(
    df: pd.DataFrame,
    params: StrategyParams,
    execution: ExecutionModel,
    *,
    symbol: str,
) -> RegimeBreakdown:
    segments = segment_by_regime(df)
    result = RegimeBreakdown(strategy="quant_scalping", symbol=symbol)

    for regime, seg_df in segments.items():
        if len(seg_df) < 80:
            continue
        trades = run_quant_chronological(seg_df, params, execution, symbol=symbol)
        result.by_regime[regime] = build_research_metrics(trades)

    if result.by_regime:
        ranked = sorted(result.by_regime.items(), key=lambda x: x[1].expectancy_pct, reverse=True)
        result.best_regime = ranked[0][0]
        result.worst_regime = ranked[-1][0]
    return result


def analyze_by_regime_hft(
    df: pd.DataFrame,
    execution: ExecutionModel,
    *,
    symbol: str,
) -> RegimeBreakdown:
    segments = segment_by_regime(df)
    result = RegimeBreakdown(strategy="hft_orderbook", symbol=symbol)

    for regime, seg_df in segments.items():
        if len(seg_df) < 80:
            continue
        trades = run_hft_chronological(seg_df, execution, symbol=symbol, latency_bars=execution.latency_bars)
        result.by_regime[regime] = build_research_metrics(trades)

    if result.by_regime:
        ranked = sorted(result.by_regime.items(), key=lambda x: x[1].expectancy_pct, reverse=True)
        result.best_regime = ranked[0][0]
        result.worst_regime = ranked[-1][0]
    return result

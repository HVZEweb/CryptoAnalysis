"""Out-of-sample validation on chronological holdout."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from backtest.fast_backtest import StrategyParams
from research.chronological import run_hft_chronological, run_quant_chronological
from research.config import ExecutionModel
from research.metrics import ResearchMetrics, build_research_metrics


@dataclass
class OOSResult:
    strategy: str
    symbol: str
    in_sample: ResearchMetrics
    out_of_sample: ResearchMetrics
    holdout_pct: float
    is_bars: int
    oos_bars: int


def split_holdout(df: pd.DataFrame, holdout_pct: float = 0.25) -> tuple[pd.DataFrame, pd.DataFrame]:
    holdout_pct = max(0.1, min(0.5, holdout_pct))
    split = int(len(df) * (1 - holdout_pct))
    return df.iloc[:split].copy(), df.iloc[split:].copy()


def validate_quant_oos(
    df: pd.DataFrame,
    params: StrategyParams,
    execution: ExecutionModel,
    *,
    symbol: str,
    holdout_pct: float = 0.25,
) -> OOSResult:
    is_df, oos_df = split_holdout(df, holdout_pct)
    is_trades = run_quant_chronological(is_df, params, execution, symbol=symbol)
    oos_trades = run_quant_chronological(oos_df, params, execution, symbol=symbol)
    return OOSResult(
        strategy="quant_scalping",
        symbol=symbol,
        in_sample=build_research_metrics(is_trades),
        out_of_sample=build_research_metrics(oos_trades),
        holdout_pct=holdout_pct,
        is_bars=len(is_df),
        oos_bars=len(oos_df),
    )


def validate_hft_oos(
    df: pd.DataFrame,
    execution: ExecutionModel,
    *,
    symbol: str,
    holdout_pct: float = 0.25,
) -> OOSResult:
    is_df, oos_df = split_holdout(df, holdout_pct)
    is_trades = run_hft_chronological(is_df, execution, symbol=symbol, latency_bars=execution.latency_bars)
    oos_trades = run_hft_chronological(oos_df, execution, symbol=symbol, latency_bars=execution.latency_bars)
    return OOSResult(
        strategy="hft_orderbook",
        symbol=symbol,
        in_sample=build_research_metrics(is_trades),
        out_of_sample=build_research_metrics(oos_trades),
        holdout_pct=holdout_pct,
        is_bars=len(is_df),
        oos_bars=len(oos_df),
    )

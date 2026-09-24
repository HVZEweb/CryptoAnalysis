"""Parameter stability ranking — prefer consistent OOS edge over peak profit."""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from backtest.fast_backtest import StrategyParams
from backtest.optimizer import PARAM_RANGES
from research.config import ExecutionModel, ResearchConfig
from research.metrics import ResearchMetrics
from research.oos import validate_quant_oos


@dataclass
class ParamStabilityRank:
    params: dict
    oos_metrics: ResearchMetrics
    is_metrics: ResearchMetrics
    stability_score: float
    rank_score: float


@dataclass
class StabilityRanking:
    strategy: str
    symbol: str
    ranked: list[ParamStabilityRank] = field(default_factory=list)
    best: ParamStabilityRank | None = None


def _sample_params(rng: random.Random) -> StrategyParams:
    return StrategyParams(
        tp_pct=rng.choice(PARAM_RANGES["tp_pct"]),
        sl_pct=rng.choice(PARAM_RANGES["sl_pct"]),
        trailing_pct=rng.choice(PARAM_RANGES["trailing_pct"]),
        min_rr=rng.choice(PARAM_RANGES["min_rr"]),
        min_profit_pct=rng.choice(PARAM_RANGES["min_profit_pct"]),
        rsi_low=float(rng.choice(PARAM_RANGES["rsi_low"])),
        rsi_high=float(rng.choice(PARAM_RANGES["rsi_high"])),
        max_hold_bars=rng.choice(PARAM_RANGES["max_hold_bars"]),
        min_bullish_score=rng.choice(PARAM_RANGES["min_bullish_score"]),
    )


def rank_quant_params(
    df,
    execution: ExecutionModel,
    config: ResearchConfig,
    *,
    symbol: str,
    n_samples: int | None = None,
    rng_seed: int = 42,
) -> StabilityRanking:
    import pandas as pd

    if not isinstance(df, pd.DataFrame):
        raise TypeError("df must be DataFrame")

    rng = random.Random(rng_seed)
    n = n_samples or config.param_samples
    ranking = StabilityRanking(strategy="quant_scalping", symbol=symbol)

    for _ in range(n):
        base = _sample_params(rng)
        params = StrategyParams(
            **{**base.to_dict(), "taker_fee_pct": execution.taker_fee_pct, "slippage_pct": execution.slippage_pct}
        )
        oos = validate_quant_oos(df, params, execution, symbol=symbol, holdout_pct=config.oos_holdout_pct)

        oos_m = oos.out_of_sample
        is_m = oos.in_sample
        stability = oos_m.stability_score
        if oos_m.expectancy_pct > 0:
            stability = min(100, stability + 20)
        if is_m.expectancy_pct > 0 and oos_m.expectancy_pct > 0:
            stability = min(100, stability + 15)

        rank_score = (
            oos_m.sharpe_ratio * 0.35
            + (oos_m.profit_factor - 1) * 0.25
            + oos_m.expectancy_pct * 10 * 0.25
            + stability / 100 * 0.15
            - oos_m.max_drawdown_pct / 100 * 0.2
        )

        entry = ParamStabilityRank(
            params=params.to_dict(),
            oos_metrics=oos_m,
            is_metrics=is_m,
            stability_score=stability,
            rank_score=rank_score,
        )
        ranking.ranked.append(entry)

    ranking.ranked.sort(key=lambda x: x.rank_score, reverse=True)
    ranking.best = ranking.ranked[0] if ranking.ranked else None
    return ranking

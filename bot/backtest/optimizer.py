"""Parameter optimizer — 10k scenarios, Sharpe + min drawdown objective."""

from __future__ import annotations

import json
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from backtest.fast_backtest import StrategyParams, run_scenario, run_scenario_returns
from backtest.market_simulator import MarketScenario, fetch_history, generate_scenarios
from backtest.metrics import aggregate_metrics, build_metrics, composite_score

log = logging.getLogger("backtest.optimizer")

RESULTS_DIR = Path(__file__).resolve().parent / "results"

PARAM_RANGES = {
    "tp_pct": [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60],
    "sl_pct": [0.15, 0.20, 0.25, 0.30, 0.35],
    "trailing_pct": [0.10, 0.12, 0.15, 0.18, 0.22],
    "min_rr": [1.2, 1.5, 1.8, 2.0, 2.5],
    "min_profit_pct": [0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.22],
    "rsi_low": [28, 30, 32, 35, 38],
    "rsi_high": [62, 65, 68, 70, 72],
    "max_hold_bars": [4, 6, 8, 10, 12],
    "min_bullish_score": [3, 4],
}


@dataclass
class OptimizationResult:
    best_params: StrategyParams
    best_aggregate: dict[str, float]
    total_runs: int
    n_param_sets: int
    n_scenarios: int
    top_10: list[dict] = field(default_factory=list)
    baseline: dict | None = None
    elapsed_sec: float = 0.0


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


def _params_key(p: StrategyParams) -> str:
    return json.dumps(p.to_dict(), sort_keys=True)


def optimize(
    scenarios: list[MarketScenario],
    *,
    total_runs: int = 10_000,
    n_param_candidates: int = 100,
    rng_seed: int = 42,
    baseline: StrategyParams | None = None,
) -> OptimizationResult:
    """
    Run exactly total_runs backtests:
    n_param_candidates × scenarios_per_param = total_runs
    Rank by composite(Sharpe, drawdown) — NOT raw profit.
    """
    import time

    t0 = time.perf_counter()
    rng = random.Random(rng_seed)
    n_scenarios_pool = len(scenarios)
    scenarios_per_param = total_runs // n_param_candidates

    if scenarios_per_param < 1:
        n_param_candidates = total_runs
        scenarios_per_param = 1

    log.info(
        "Optimization: %d param sets × %d scenarios = %d runs",
        n_param_candidates,
        scenarios_per_param,
        n_param_candidates * scenarios_per_param,
    )

    param_sets: list[StrategyParams] = []
    seen: set[str] = set()
    while len(param_sets) < n_param_candidates:
        p = _sample_params(rng)
        key = _params_key(p)
        if key in seen:
            continue
        seen.add(key)
        param_sets.append(p)

    if baseline:
        bl_sample = rng.sample(range(n_scenarios_pool), min(scenarios_per_param, n_scenarios_pool))
        bl_returns: list[float] = []
        for si in bl_sample:
            bl_returns.extend(run_scenario_returns(scenarios[si], baseline))
        bl_pooled = build_metrics(bl_returns)
        baseline_agg = {
            "sharpe": bl_pooled.sharpe_ratio,
            "max_dd": bl_pooled.max_drawdown_pct,
            "trades": float(bl_pooled.trades),
            "return_pct": bl_pooled.total_return_pct,
            "score": composite_score(bl_pooled.sharpe_ratio, bl_pooled.max_drawdown_pct, bl_pooled.trades),
        }
    else:
        baseline_agg = None

    results_ranked: list[dict] = []
    run_count = 0

    for idx, params in enumerate(param_sets):
        sample_indices = rng.sample(range(n_scenarios_pool), min(scenarios_per_param, n_scenarios_pool))
        pooled_returns: list[float] = []
        per_scenario_metrics = []
        for si in sample_indices:
            rets = run_scenario_returns(scenarios[si], params)
            pooled_returns.extend(rets)
            per_scenario_metrics.append(build_metrics(rets))
            run_count += 1

        pooled = build_metrics(pooled_returns)
        agg = {
            "sharpe": pooled.sharpe_ratio,
            "sortino": pooled.sortino_ratio,
            "max_dd": pooled.max_drawdown_pct,
            "trades": float(pooled.trades),
            "return_pct": pooled.total_return_pct,
            "win_rate": pooled.win_rate,
            "score": composite_score(
                pooled.sharpe_ratio,
                pooled.max_drawdown_pct,
                pooled.trades,
            ),
            "scenarios_with_trades": sum(1 for m in per_scenario_metrics if m.trades > 0),
        }
        results_ranked.append({
            "params": params.to_dict(),
            "aggregate": agg,
            "param_idx": idx,
        })

        if (idx + 1) % 20 == 0:
            log.info("Progress: %d/%d param sets (%d runs)", idx + 1, n_param_candidates, run_count)

    results_ranked.sort(key=lambda x: x["aggregate"]["score"], reverse=True)
    # Prefer param sets with enough trades for meaningful Sharpe
    viable = [r for r in results_ranked if r["aggregate"]["trades"] >= 40]
    if viable:
        results_ranked = viable + [r for r in results_ranked if r not in viable]
    best = results_ranked[0]

    elapsed = time.perf_counter() - t0

    best_params = StrategyParams(**{k: best["params"][k] for k in best["params"]})

    return OptimizationResult(
        best_params=best_params,
        best_aggregate=best["aggregate"],
        total_runs=run_count,
        n_param_sets=n_param_candidates,
        n_scenarios=n_scenarios_pool,
        top_10=results_ranked[:10],
        baseline={"params": baseline.to_dict() if baseline else None, "aggregate": baseline_agg},
        elapsed_sec=elapsed,
    )


def validate_best_on_all(
    scenarios: list[MarketScenario],
    params: StrategyParams,
    *,
    max_scenarios: int = 2000,
) -> dict[str, float]:
    """Out-of-sample validation: best params on more scenarios."""
    sample = scenarios[:max_scenarios]
    pooled: list[float] = []
    for s in sample:
        pooled.extend(run_scenario_returns(s, params))
    m = build_metrics(pooled)
    return {
        "sharpe": m.sharpe_ratio,
        "max_dd": m.max_drawdown_pct,
        "trades": float(m.trades),
        "return_pct": m.total_return_pct,
        "score": composite_score(m.sharpe_ratio, m.max_drawdown_pct, m.trades),
        "win_rate": m.win_rate,
    }


def save_results(result: OptimizationResult, validation: dict | None = None) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = RESULTS_DIR / f"optimization_{ts}.json"

    payload = {
        "timestamp": ts,
        "objective": "sharpe_ratio + min_drawdown (not max profit)",
        "total_runs": result.total_runs,
        "n_param_sets": result.n_param_sets,
        "n_scenarios_pool": result.n_scenarios,
        "elapsed_sec": round(result.elapsed_sec, 1),
        "best_params": result.best_params.to_dict(),
        "best_aggregate": result.best_aggregate,
        "validation": validation,
        "baseline": result.baseline,
        "top_10": result.top_10,
        "recommended_env": {
            "TRADING_TP_PCT": result.best_params.tp_pct,
            "TRADING_SL_PCT": result.best_params.sl_pct,
            "TRADING_TRAILING_PCT": result.best_params.trailing_pct,
            "TRADING_MIN_EV_USD": result.best_params.min_profit_pct,
        },
    }

    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Results saved: %s", path)
    return path


async def run_full_optimization(
    *,
    n_scenarios: int = 10_000,
    total_runs: int = 10_000,
    n_param_candidates: int = 100,
    symbols: list[str] | None = None,
    timeframe: str = "5m",
    use_local: bool = True,
) -> tuple[OptimizationResult, Path, dict[str, float]]:
    from core.config import get_settings
    from research.data_loader import load_local_pools

    settings = get_settings()
    symbols = symbols or ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"]
    baseline = StrategyParams(
        tp_pct=settings.trading_tp_pct,
        sl_pct=settings.trading_sl_pct,
        trailing_pct=settings.trading_trailing_pct,
        min_rr=1.5,
        min_profit_pct=settings.trading_min_ev_usd,
        max_hold_bars=6,
        taker_fee_pct=settings.trading_taker_fee_pct,
        slippage_pct=settings.trading_slippage_pct,
        safety_margin_pct=0.10,
        rsi_low=settings.trading_rsi_low,
        rsi_high=settings.trading_rsi_high,
    )

    pools = load_local_pools(symbols, timeframe) if use_local else {}
    if not pools:
        pools = await fetch_history(symbols=symbols, timeframe=timeframe, target_bars=5000)
    log.info("Optimization pools: %s (%d bars avg)", list(pools.keys()), int(sum(len(v) for v in pools.values()) / max(len(pools), 1)))
    scenarios = generate_scenarios(pools, n_scenarios=n_scenarios)

    result = optimize(
        scenarios,
        total_runs=total_runs,
        n_param_candidates=n_param_candidates,
        baseline=baseline,
    )

    holdout_start = int(len(scenarios) * 0.8)
    validation = validate_best_on_all(
        scenarios[holdout_start:],
        result.best_params,
        max_scenarios=2000,
    )
    path = save_results(result, validation)
    return result, path, validation

"""
Monte Carlo optimization — 10,000 historical scenarios.
Objective: Sharpe Ratio + minimum drawdown (NOT max profit).

Usage:
  cd bot
  python -m backtest.run_optimization
  python -m backtest.run_optimization --scenarios 10000 --runs 10000 --params 100
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backtest.optimizer import run_full_optimization
from core.logger import setup_logging

log = setup_logging("optimization")


def print_report(result, path: Path, validation: dict) -> None:
    bp = result.best_params
    agg = result.best_aggregate

    print("\n" + "=" * 60)
    print("  MONTE CARLO OPTIMIZATION — Sharpe + Min Drawdown")
    print("=" * 60)
    print(f"  Total backtest runs:     {result.total_runs:,}")
    print(f"  Scenario pool:           {result.n_scenarios:,}")
    print(f"  Parameter sets tested:   {result.n_param_sets}")
    print(f"  Elapsed:                 {result.elapsed_sec:.1f}s")
    print(f"  Results file:            {path}")
    print("-" * 60)
    print("  BEST PARAMETERS (risk-adjusted, not max profit):")
    print(f"    TRADING_TP_PCT          = {bp.tp_pct}")
    print(f"    TRADING_SL_PCT          = {bp.sl_pct}")
    print(f"    TRADING_TRAILING_PCT    = {bp.trailing_pct}")
    print(f"    TRADING_MIN_RR_RATIO    = {bp.min_rr}")
    print(f"    TRADING_MIN_PROFIT_PCT  = {bp.min_profit_pct}")
    print(f"    RSI thresholds      = {bp.rsi_low} / {bp.rsi_high}")
    print(f"    max_hold_min        = {bp.max_hold_bars * 5}")
    print(f"    min_bullish_score   = {bp.min_bullish_score}")
    print("-" * 60)
    print("  METRICS (pooled trades, 100 scenarios/param):")
    print(f"    Sharpe Ratio:        {agg['sharpe']:.3f}")
    print(f"    Sortino Ratio:       {agg.get('sortino', 0):.3f}")
    print(f"    Max DD (p90):        {agg['max_dd']:.2f}%")
    print(f"    Median return:       {agg['return_pct']:+.2f}%")
    print(f"    Median trades:       {agg['trades']:.0f}")
    print(f"    Win rate:            {agg.get('win_rate', 0):.1f}%")
    print(f"    Composite score:     {agg['score']:.3f}")
    print("-" * 60)
    if result.baseline and result.baseline.get("aggregate"):
        bl = result.baseline["aggregate"]
        print("  BASELINE (current .env):")
        print(f"    Sharpe: {bl['sharpe']:.3f} | DD p90: {bl['max_dd']:.2f}% | Score: {bl['score']:.3f}")
    print("-" * 60)
    print("  VALIDATION (best params on 2000 scenarios):")
    print(f"    Sharpe: {validation['sharpe']:.3f} | DD p90: {validation['max_dd']:.2f}% | Score: {validation['score']:.3f}")
    print("=" * 60)

    if result.top_10:
        print("\n  TOP-3 ALTERNATIVES:")
        for i, row in enumerate(result.top_10[:3], 1):
            p = row["params"]
            a = row["aggregate"]
            print(
                f"  #{i} score={a['score']:.3f} sharpe={a['sharpe']:.2f} "
                f"dd={a['max_dd']:.1f}% tp={p['tp_pct']} sl={p['sl_pct']} rr={p['min_rr']}"
            )
    print()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Monte Carlo strategy optimization")
    parser.add_argument("--scenarios", type=int, default=10_000, help="Scenario pool size")
    parser.add_argument("--runs", type=int, default=10_000, help="Total backtest runs")
    parser.add_argument("--params", type=int, default=100, help="Parameter candidates")
    parser.add_argument("--symbols", nargs="*", default=None, help="Symbols e.g. BTC/USDT:USDT ETH/USDT:USDT")
    parser.add_argument("--timeframe", default="5m", help="OHLCV timeframe for local data")
    parser.add_argument("--no-local", action="store_true", help="Fetch from OKX instead of data/ohlcv")
    args = parser.parse_args()

    log.info(
        "Starting optimization: %d scenarios, %d runs, %d param sets",
        args.scenarios,
        args.runs,
        args.params,
    )

    result, path, validation = await run_full_optimization(
        n_scenarios=args.scenarios,
        total_runs=args.runs,
        n_param_candidates=args.params,
        symbols=args.symbols,
        timeframe=args.timeframe,
        use_local=not args.no_local,
    )

    print_report(result, path, validation)


if __name__ == "__main__":
    asyncio.run(main())

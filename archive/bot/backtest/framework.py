"""Unified backtest framework — shared runner for all strategies."""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from backtest.fast_backtest import StrategyParams, run_scenario_returns
from backtest.market_simulator import MarketScenario, fetch_history, generate_scenarios
from backtest.metrics import PerformanceMetrics, build_metrics

log = logging.getLogger("backtest.framework")


@dataclass
class BacktestConfig:
    symbol: str = "ETH/USDT:USDT"
    timeframe: str = "5m"
    bars: int = 500
    scenarios: int = 100
    strategy_params: StrategyParams = field(default_factory=StrategyParams)


@dataclass
class BacktestRunResult:
    strategy: str
    symbol: str
    metrics: PerformanceMetrics
    trade_returns: list[float] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)


class BacktestStrategy(ABC):
    name: str

    @abstractmethod
    async def run(self, config: BacktestConfig) -> BacktestRunResult:
        ...


class QuantScalpingBacktest(BacktestStrategy):
    name = "quant_scalping"

    async def run(self, config: BacktestConfig) -> BacktestRunResult:
        pools = await fetch_history([config.symbol], config.timeframe, config.bars)
        symbol = list(pools.keys())[0] if pools else config.symbol
        scenario_list = generate_scenarios(pools, n_scenarios=config.scenarios)
        returns: list[float] = []
        for sc in scenario_list:
            returns.extend(run_scenario_returns(sc, config.strategy_params))
        return BacktestRunResult(
            strategy=self.name,
            symbol=symbol,
            metrics=build_metrics(returns),
            trade_returns=returns,
            meta={"scenarios": len(scenario_list)},
        )


class HFTOrderbookBacktest(BacktestStrategy):
    name = "hft_orderbook"

    async def run(self, config: BacktestConfig) -> BacktestRunResult:
        from backtest.engine import UnifiedBacktestEngine

        engine = UnifiedBacktestEngine()
        report = await engine.run_hft(config.symbol, config.bars, config.timeframe)
        returns = [t.pnl_pct / 100 for t in report.trades]
        return BacktestRunResult(
            strategy=self.name,
            symbol=config.symbol,
            metrics=report.metrics or build_metrics(returns),
            trade_returns=returns,
            meta={"trades": len(report.trades)},
        )


class BacktestRunner:
    """Single entry point for all strategy backtests."""

    def __init__(self) -> None:
        self._strategies: dict[str, BacktestStrategy] = {
            "quant_scalping": QuantScalpingBacktest(),
            "hft_orderbook": HFTOrderbookBacktest(),
        }

    def register(self, strategy: BacktestStrategy) -> None:
        self._strategies[strategy.name] = strategy

    async def run(self, strategy_name: str, config: BacktestConfig | None = None) -> BacktestRunResult:
        cfg = config or BacktestConfig()
        strat = self._strategies.get(strategy_name)
        if not strat:
            raise ValueError(f"Unknown backtest strategy: {strategy_name}")
        log.info("Running backtest: %s on %s", strategy_name, cfg.symbol)
        return await strat.run(cfg)

    async def run_all(self, config: BacktestConfig | None = None) -> dict[str, BacktestRunResult]:
        cfg = config or BacktestConfig()
        results: dict[str, BacktestRunResult] = {}
        for name in self._strategies:
            results[name] = await self.run(name, cfg)
        return results

    def summary(self, results: dict[str, BacktestRunResult]) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        for name, r in results.items():
            m = r.metrics
            out[name] = {
                "trades": m.trades,
                "win_rate": m.win_rate,
                "total_return_pct": m.total_return_pct,
                "max_drawdown_pct": m.max_drawdown_pct,
                "sharpe": m.sharpe_ratio,
                "sortino": m.sortino_ratio,
                "profit_factor": m.profit_factor,
                "calmar": m.calmar_ratio,
            }
        return out


async def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    runner = BacktestRunner()
    results = await runner.run_all()
    for name, summary in runner.summary(results).items():
        print(f"\n=== {name} ===")
        for k, v in summary.items():
            print(f"  {k}: {v:.3f}" if isinstance(v, float) else f"  {k}: {v}")


if __name__ == "__main__":
    asyncio.run(_main())

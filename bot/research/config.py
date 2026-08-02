"""Research framework configuration."""

from __future__ import annotations

from dataclasses import dataclass, field

from backtest.fast_backtest import StrategyParams


@dataclass
class ExecutionModel:
    """Realistic execution assumptions for research."""

    maker_fee_pct: float = 0.02
    taker_fee_pct: float = 0.05
    slippage_pct: float = 0.03
    spread_pct: float = 0.05
    safety_margin_pct: float = 0.10
    latency_bars: int = 1
    funding_pct_per_8h: float = 0.01

    def round_trip_cost_pct(self, use_limit_entry: bool = False) -> float:
        entry_fee = self.maker_fee_pct if use_limit_entry else self.taker_fee_pct
        return entry_fee + self.taker_fee_pct + self.slippage_pct * 2 + self.spread_pct * 0.5 + self.safety_margin_pct


@dataclass
class ResearchConfig:
    symbols: list[str] = field(default_factory=lambda: ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"])
    timeframe: str = "5m"
    total_bars: int = 0
    hft_timeframe: str = "5m"
    hft_bars: int = 0

    train_bars: int = 3000
    test_bars: int = 1000
    walk_forward_step: int = 1000
    rolling_window_bars: int = 5000
    rolling_step_bars: int = 1000

    oos_holdout_pct: float = 0.25
    min_trades_per_fold: int = 5
    min_positive_folds_pct: float = 55.0

    bootstrap_scenarios: int = 80
    param_samples: int = 24

    quant_params: StrategyParams | None = None
    execution: ExecutionModel = field(default_factory=ExecutionModel)

    export_html: bool = True
    offline: bool = False
    results_dir: str = "research/results"

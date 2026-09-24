"""Alpha Research Platform configuration."""

from __future__ import annotations

from dataclasses import dataclass, field

from research.config import ExecutionModel


@dataclass
class AlphaConfig:
    symbols: list[str] = field(default_factory=lambda: ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"])
    timeframe: str = "5m"
    total_bars: int = 0
    offline: bool = True
    export_html: bool = True

    oos_holdout_pct: float = 0.25
    train_bars: int = 3000
    test_bars: int = 1000
    walk_forward_step: int = 1000
    rolling_window_bars: int = 5000
    rolling_step_bars: int = 1000

    bootstrap_samples: int = 1000
    min_trades_oos: int = 5
    min_walk_forward_stability: float = 40.0
    max_overfitting_score: float = 0.8

    execution: ExecutionModel = field(default_factory=ExecutionModel)
    results_dir: str = "alpha/results"
    data_dir: str = "data/alpha"

    categories: list[str] | None = None
    module_ids: list[str] | None = None

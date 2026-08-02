"""Position sizing, SL/TP, emergency stop — for live stage only."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RiskLimits:
    max_position_usd: float = 500.0
    max_daily_loss_usd: float = 100.0
    stop_loss_pct: float = 0.15
    take_profit_pct: float = 0.25
    emergency_stop: bool = False

    def position_size(self, equity_usd: float, risk_pct: float = 0.01) -> float:
        if self.emergency_stop:
            return 0.0
        return min(self.max_position_usd, equity_usd * risk_pct)

    def should_stop_out(self, unrealized_pnl_pct: float) -> bool:
        return unrealized_pnl_pct <= -self.stop_loss_pct

    def should_take_profit(self, unrealized_pnl_pct: float) -> bool:
        return unrealized_pnl_pct >= self.take_profit_pct

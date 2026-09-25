"""Position sizing based on risk budget."""

from __future__ import annotations

from core.config import Settings, get_settings


class PositionSizer:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def size_from_risk(
        self,
        equity: float,
        entry_price: float,
        stop_distance_pct: float,
        leverage: int | None = None,
    ) -> tuple[float, float]:
        """Return (contracts, notional_usd)."""
        lev = leverage or self.settings.trading_leverage
        risk_usd = equity * self.settings.trading_max_risk_per_trade_pct / 100
        if stop_distance_pct <= 0 or entry_price <= 0:
            notional = self.settings.trading_notional_usd
            contracts = notional / entry_price
            return contracts, notional

        notional = risk_usd / (stop_distance_pct / 100)
        notional = min(notional, self.settings.trading_notional_usd * 2)
        notional = max(notional, self.settings.trading_notional_usd * 0.5)
        contracts = (notional * lev) / entry_price
        return contracts, notional

    def liquidation_distance_pct(self, entry: float, side: str, leverage: int) -> float:
        if entry <= 0 or leverage <= 0:
            return 100.0
        move = 100 / leverage
        return move * 0.9

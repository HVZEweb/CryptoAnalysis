"""Unified account-level risk engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from core.config import Settings, get_settings


@dataclass
class RiskDecision:
    allowed: bool
    reason: str
    max_notional_usd: float = 0.0


@dataclass
class RiskState:
    daily_pnl_usd: float = 0.0
    peak_equity: float = 0.0
    current_equity: float = 0.0
    open_positions: int = 0
    position_by_symbol: dict[str, float] = field(default_factory=dict)
    strategy_by_symbol: dict[str, str] = field(default_factory=dict)
    emergency_stop: bool = False
    day: str = field(default_factory=lambda: date.today().isoformat())


class AccountRisk:
    """All strategies must get approval before opening positions."""

    def __init__(self, settings: Settings | None = None) -> None:
        s = settings or get_settings()
        self.settings = s
        self.state = RiskState(
            peak_equity=s.trading_paper_balance,
            current_equity=s.trading_paper_balance,
            emergency_stop=s.trading_emergency_stop,
        )

    def _roll_day(self) -> None:
        today = date.today().isoformat()
        if self.state.day != today:
            self.state.day = today
            self.state.daily_pnl_usd = 0.0

    def update_equity(self, equity: float) -> None:
        self.state.current_equity = equity
        if equity > self.state.peak_equity:
            self.state.peak_equity = equity

    @property
    def drawdown_pct(self) -> float:
        if self.state.peak_equity <= 0:
            return 0.0
        return max(0.0, (self.state.peak_equity - self.state.current_equity) / self.state.peak_equity * 100)

    def can_open(
        self,
        symbol: str,
        strategy: str,
        notional_usd: float,
        leverage: int,
        liquidation_distance_pct: float | None = None,
    ) -> RiskDecision:
        self._roll_day()
        s = self.settings

        if self.state.emergency_stop:
            return RiskDecision(False, "emergency stop")

        if symbol in self.state.position_by_symbol:
            return RiskDecision(False, f"position already open on {symbol}")

        if self.state.open_positions >= s.trading_max_positions:
            return RiskDecision(False, "max positions reached")

        correlated = sum(
            1 for sym, strat in self.state.strategy_by_symbol.items() if strat == strategy
        )
        if correlated >= s.trading_max_correlated_positions:
            return RiskDecision(False, "max correlated strategy positions")

        daily_limit = self.state.peak_equity * s.trading_max_daily_loss_pct / 100
        if self.state.daily_pnl_usd <= -daily_limit:
            return RiskDecision(False, "daily loss limit")

        if self.drawdown_pct >= s.trading_max_drawdown_pct:
            return RiskDecision(False, f"max drawdown {self.drawdown_pct:.1f}%")

        risk_cap = self.state.current_equity * s.trading_max_risk_per_trade_pct / 100
        if notional_usd > risk_cap:
            return RiskDecision(False, f"risk per trade cap ${risk_cap:.2f}")

        if leverage > s.trading_leverage:
            return RiskDecision(False, f"leverage {leverage} > max {s.trading_leverage}")

        if liquidation_distance_pct is not None:
            if liquidation_distance_pct < s.trading_liquidation_buffer_pct:
                return RiskDecision(False, "liquidation risk too high")

        return RiskDecision(True, "ok", max_notional_usd=min(notional_usd, risk_cap))

    def on_open(self, symbol: str, strategy: str, notional_usd: float) -> None:
        self.state.open_positions += 1
        self.state.position_by_symbol[symbol] = notional_usd
        self.state.strategy_by_symbol[symbol] = strategy

    def on_close(self, symbol: str, pnl_usd: float) -> None:
        self.state.open_positions = max(0, self.state.open_positions - 1)
        self.state.position_by_symbol.pop(symbol, None)
        self.state.strategy_by_symbol.pop(symbol, None)
        self.state.daily_pnl_usd += pnl_usd
        self.state.current_equity += pnl_usd

    def check_flash_move(self, prev_mid: float, mid: float) -> bool:
        if prev_mid <= 0:
            return False
        move = abs(mid - prev_mid) / prev_mid * 100
        return move >= self.settings.trading_flash_move_pct

    def set_emergency_stop(self, value: bool) -> None:
        self.state.emergency_stop = value

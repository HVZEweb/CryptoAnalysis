"""Simulated trade record with execution costs and forensic metadata."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SimulatedTrade:
    strategy: str
    symbol: str
    side: str
    entry_bar: int
    exit_bar: int
    entry_price: float
    exit_price: float
    gross_return_pct: float
    fees_pct: float
    slippage_pct: float
    net_return_pct: float
    hold_bars: int
    regime: str = "unknown"
    exit_reason: str = ""

    # Forensic metadata
    signal_mode: str = ""
    entry_rsi: float = 0.0
    entry_atr_pct: float = 0.0
    entry_confidence: float = 0.0
    entry_ev_usd: float = 0.0
    spread_cost_pct: float = 0.0
    latency_cost_pct: float = 0.0
    funding_cost_pct: float = 0.0

    # Cost ladder (PnL at each friction level)
    pnl_no_costs_pct: float = 0.0
    pnl_fees_only_pct: float = 0.0
    pnl_fees_slip_pct: float = 0.0

    mfe_pct: float = 0.0
    mae_pct: float = 0.0
    trend_regime: str = ""
    volatility_regime: str = ""
    liquidity_regime: str = ""
    impulse_regime: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def hold_minutes(self) -> float:
        return self.hold_bars * 5

    @property
    def is_winner(self) -> bool:
        return self.net_return_pct > 0

    def to_dict(self) -> dict:
        return {
            "strategy": self.strategy,
            "symbol": self.symbol,
            "side": self.side,
            "entry_bar": self.entry_bar,
            "exit_bar": self.exit_bar,
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "gross_return_pct": round(self.gross_return_pct, 4),
            "fees_pct": round(self.fees_pct, 4),
            "slippage_pct": round(self.slippage_pct, 4),
            "net_return_pct": round(self.net_return_pct, 4),
            "hold_bars": self.hold_bars,
            "regime": self.regime,
            "exit_reason": self.exit_reason,
            "signal_mode": self.signal_mode,
            "entry_rsi": round(self.entry_rsi, 2),
            "entry_atr_pct": round(self.entry_atr_pct, 4),
            "entry_confidence": round(self.entry_confidence, 2),
            "entry_ev_usd": round(self.entry_ev_usd, 4),
            "pnl_no_costs_pct": round(self.pnl_no_costs_pct, 4),
            "pnl_fees_only_pct": round(self.pnl_fees_only_pct, 4),
            "pnl_fees_slip_pct": round(self.pnl_fees_slip_pct, 4),
            "mfe_pct": round(self.mfe_pct, 4),
            "mae_pct": round(self.mae_pct, 4),
            "trend_regime": self.trend_regime,
            "volatility_regime": self.volatility_regime,
            "liquidity_regime": self.liquidity_regime,
            "impulse_regime": self.impulse_regime,
        }

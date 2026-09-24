"""Shared trading types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from risk.stop_manager import StopState


@dataclass
class TradeIntent:
    symbol: str
    side: str
    strategy: str
    entry_price: float
    stop_loss: float
    take_profit: float
    confidence: float
    expected_value: float
    signals: dict[str, Any] = field(default_factory=dict)
    use_limit: bool = False
    limit_price: float | None = None
    leverage: int | None = None
    book_snapshot: dict[str, Any] | None = None
    ai_probability: float | None = None
    risk_decision: str = ""


@dataclass
class ManagedPosition:
    trade_id: str
    symbol: str
    side: str
    strategy: str
    entry_price: float
    size: float
    remaining_size: float
    notional_usd: float
    leverage: int
    stop_state: StopState
    opened_at_ms: int
    partial_stage: int = 0
    entry_order_id: str | None = None
    sl_order_id: str | None = None
    tp_order_id: str | None = None
    liquidation_price: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

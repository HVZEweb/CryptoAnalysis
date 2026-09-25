"""Paper trading engine for futures."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PaperPosition:
    id: str
    symbol: str
    side: str
    strategy: str
    entry_price: float
    size: float
    remaining_size: float
    notional_usd: float
    leverage: int
    stop_loss: float
    take_profit: float
    opened_at_ms: int
    fees_usd: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


class PaperEngine:
    def __init__(self, starting_balance: float, maker_fee_pct: float, taker_fee_pct: float) -> None:
        self.balance = starting_balance
        self.equity = starting_balance
        self.maker_fee_pct = maker_fee_pct
        self.taker_fee_pct = taker_fee_pct
        self.positions: dict[str, PaperPosition] = {}
        self.closed_pnl: float = 0.0

    def open_position(
        self,
        symbol: str,
        side: str,
        strategy: str,
        entry_price: float,
        size: float,
        notional_usd: float,
        leverage: int,
        stop_loss: float,
        take_profit: float,
        *,
        is_maker: bool = True,
        metadata: dict[str, Any] | None = None,
    ) -> PaperPosition:
        fee_pct = self.maker_fee_pct if is_maker else self.taker_fee_pct
        fees = notional_usd * fee_pct / 100
        margin = notional_usd / leverage
        if margin + fees > self.balance:
            raise ValueError("Insufficient paper margin")

        import time

        pos = PaperPosition(
            id=str(uuid.uuid4()),
            symbol=symbol,
            side=side,
            strategy=strategy,
            entry_price=entry_price,
            size=size,
            remaining_size=size,
            notional_usd=notional_usd,
            leverage=leverage,
            stop_loss=stop_loss,
            take_profit=take_profit,
            opened_at_ms=int(time.time() * 1000),
            fees_usd=fees,
            metadata=metadata or {},
        )
        self.balance -= margin + fees
        self.positions[symbol] = pos
        return pos

    def close_position(self, symbol: str, exit_price: float, *, partial_pct: float = 100.0) -> tuple[float, PaperPosition]:
        pos = self.positions.get(symbol)
        if not pos:
            raise ValueError(f"No position for {symbol}")

        close_size = pos.remaining_size * (partial_pct / 100)
        if close_size <= 0:
            raise ValueError("Nothing to close")

        direction = 1 if pos.side == "long" else -1
        pnl = direction * (exit_price - pos.entry_price) * close_size
        exit_fees = pos.notional_usd * (partial_pct / 100) * self.taker_fee_pct / 100
        net_pnl = pnl - exit_fees

        margin_release = (pos.notional_usd / pos.leverage) * (partial_pct / 100)
        self.balance += margin_release + net_pnl
        self.closed_pnl += net_pnl
        self.equity = self.balance

        pos.remaining_size -= close_size
        pos.fees_usd += exit_fees

        if pos.remaining_size <= 1e-12 or partial_pct >= 100:
            del self.positions[symbol]

        return net_pnl, pos

    def get_position(self, symbol: str) -> PaperPosition | None:
        return self.positions.get(symbol)

    def list_positions(self) -> list[PaperPosition]:
        return list(self.positions.values())

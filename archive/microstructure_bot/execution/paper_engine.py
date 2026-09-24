"""Paper trading engine — OKX fees, slippage, latency."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from execution.order_manager import Order, OrderManager, OrderSide, OrderStatus
from execution.risk import RiskLimits


@dataclass
class PaperPosition:
    inst_id: str
    side: str
    size: float
    entry_price: float
    entry_ts: int

    def unrealized_pnl_pct(self, mark: float) -> float:
        if self.side == "long":
            return (mark - self.entry_price) / self.entry_price * 100
        return (self.entry_price - mark) / self.entry_price * 100


@dataclass
class PaperEngine:
    equity_usd: float = 10_000.0
    taker_fee_bps: float = 5.0
    slippage_bps: float = 1.0
    latency_ms: int = 50
    risk: RiskLimits = field(default_factory=RiskLimits)
    orders: OrderManager = field(default_factory=OrderManager)
    positions: list[PaperPosition] = field(default_factory=list)
    realized_pnl: float = 0.0
    trade_log: list[dict] = field(default_factory=list)

    def _apply_slippage(self, price: float, side: OrderSide) -> float:
        slip = price * self.slippage_bps / 10000
        return price + slip if side == OrderSide.BUY else price - slip

    def _fee(self, notional: float) -> float:
        return notional * self.taker_fee_bps / 10000

    def market_order(self, inst_id: str, side: OrderSide, size: float, mid: float) -> Order | None:
        if self.risk.emergency_stop:
            return None
        notional = size * mid
        if notional > self.risk.max_position_usd:
            size = self.risk.max_position_usd / mid

        time.sleep(self.latency_ms / 1000)
        fill = self._apply_slippage(mid, side)
        fee = self._fee(fill * size)
        order = Order.create(inst_id, side, size, mid)
        order.status = OrderStatus.FILLED
        order.fill_price = fill
        order.fee = fee
        self.orders.submit(order)

        pos_side = "long" if side == OrderSide.BUY else "short"
        self.positions.append(
            PaperPosition(inst_id=inst_id, side=pos_side, size=size, entry_price=fill, entry_ts=int(time.time() * 1000))
        )
        self.equity_usd -= fee
        self.trade_log.append(
            {"inst_id": inst_id, "side": side.value, "size": size, "fill": fill, "fee": fee, "mid": mid}
        )
        return order

    def close_all(self, marks: dict[str, float]) -> float:
        pnl = 0.0
        for pos in self.positions:
            mark = marks.get(pos.inst_id, pos.entry_price)
            if pos.side == "long":
                pnl += (mark - pos.entry_price) * pos.size
            else:
                pnl += (pos.entry_price - mark) * pos.size
            pnl -= self._fee(mark * pos.size)
        self.realized_pnl += pnl
        self.equity_usd += pnl
        self.positions.clear()
        return pnl

    @property
    def metrics(self) -> dict:
        return {
            "equity": round(self.equity_usd, 2),
            "realized_pnl": round(self.realized_pnl, 2),
            "open_positions": len(self.positions),
            "trades": len(self.trade_log),
        }

"""Simulated order lifecycle."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from uuid import uuid4


class OrderSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderStatus(str, Enum):
    PENDING = "pending"
    FILLED = "filled"
    CANCELLED = "cancelled"


@dataclass
class Order:
    id: str
    inst_id: str
    side: OrderSide
    size: float
    price: float
    status: OrderStatus = OrderStatus.PENDING
    fill_price: float = 0.0
    fee: float = 0.0

    @classmethod
    def create(cls, inst_id: str, side: OrderSide, size: float, price: float) -> Order:
        return cls(id=str(uuid4())[:8], inst_id=inst_id, side=side, size=size, price=price)


@dataclass
class OrderManager:
    orders: list[Order] = field(default_factory=list)

    def submit(self, order: Order) -> Order:
        self.orders.append(order)
        return order

    def open_orders(self) -> list[Order]:
        return [o for o in self.orders if o.status == OrderStatus.PENDING]

    def filled(self) -> list[Order]:
        return [o for o in self.orders if o.status == OrderStatus.FILLED]

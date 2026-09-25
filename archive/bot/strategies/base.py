"""Strategy plugin interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from core.models import TradeIntent
from exchange.okx_rest import OKXRestClient, to_swap_symbol


@dataclass
class ScanCandidate:
    symbol: str
    score: float
    volume_24h: float
    spread_pct: float
    reason: str = ""


@dataclass
class StrategyContext:
    rest: OKXRestClient
    order_manager: Any
    universe: list[ScanCandidate] = field(default_factory=list)
    books: dict[str, Any] = field(default_factory=dict)
    ai_filter: dict[str, float] = field(default_factory=dict)


class Strategy(ABC):
    name: str

    @abstractmethod
    async def scan(self, ctx: StrategyContext) -> list[ScanCandidate]:
        ...

    @abstractmethod
    async def should_enter(self, ctx: StrategyContext, symbol: str) -> bool:
        ...

    @abstractmethod
    async def build_trade(self, ctx: StrategyContext, symbol: str) -> TradeIntent | None:
        ...

    @abstractmethod
    async def manage_position(self, ctx: StrategyContext, symbol: str) -> str | None:
        ...

    def _swap(self, symbol: str) -> str:
        return to_swap_symbol(symbol)

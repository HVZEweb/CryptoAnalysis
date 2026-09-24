"""Live order execution — OCO brackets, partial close, liquidation guard."""

from __future__ import annotations

import logging
from typing import Any

from core.retry import with_retry
from exchange.okx_rest import FuturesPosition, OKXRestClient
from execution.brackets import BracketManager, BracketOrders

log = logging.getLogger("trading_bot.execution.live")


class LiveEngine:
    def __init__(self, rest: OKXRestClient) -> None:
        self.rest = rest
        self.brackets = BracketManager(rest)
        self._active_brackets: dict[str, BracketOrders] = {}

    async def sync_equity(self) -> float:
        return await with_retry(lambda: self.rest.fetch_balance_usdt(), label="fetch_balance")

    async def get_position(self, symbol: str) -> FuturesPosition | None:
        positions = await with_retry(lambda: self.rest.fetch_positions(symbol), label="fetch_positions")
        return positions[0] if positions else None

    def get_bracket(self, symbol: str) -> BracketOrders | None:
        return self._active_brackets.get(symbol)

    def liquidation_distance_pct(self, side: str, mark: float, liq: float | None) -> float | None:
        if not liq or mark <= 0:
            return None
        if side == "long":
            return (mark - liq) / mark * 100
        return (liq - mark) / mark * 100

    async def open_position(
        self,
        symbol: str,
        side: str,
        size: float,
        *,
        order_type: str = "market",
        price: float | None = None,
        leverage: int = 5,
        stop_loss: float | None = None,
        take_profit: float | None = None,
    ) -> dict[str, Any]:
        sl = stop_loss or 0.0
        tp = take_profit or 0.0

        if sl > 0 and tp > 0:
            entry, bracket = await self.brackets.open_with_brackets(
                symbol, side, size,
                order_type=order_type, price=price, leverage=leverage,
                stop_loss=sl, take_profit=tp,
            )
        else:
            await self.rest.set_leverage(symbol, leverage)
            ccxt_side = "buy" if side == "long" else "sell"
            entry = await with_retry(
                lambda: self.rest.create_order(symbol, ccxt_side, size, order_type, price),
                label=f"entry {symbol}",
            )
            bracket = BracketOrders(entry_order_id=str(entry.get("id", "")), size=size)

        self._active_brackets[symbol] = bracket
        fill_price = float(entry.get("average") or entry.get("price") or price or 0)
        exchange_pos = await self.get_position(symbol)

        return {
            **entry,
            "fill_price": fill_price,
            "sl_order_id": bracket.sl_algo_id,
            "tp_order_id": bracket.tp_algo_id,
            "liquidation_price": exchange_pos.liquidation_price if exchange_pos else None,
        }

    async def amend_stop(self, symbol: str, side: str, size: float, new_stop: float, old_sl_order_id: str | None) -> str | None:
        bracket = self._active_brackets.get(symbol)
        if bracket:
            return await self.brackets.amend_stop(symbol, side, bracket, new_stop)
        return old_sl_order_id

    async def close_position(
        self,
        symbol: str,
        side: str,
        size: float,
        *,
        order_type: str = "market",
        price: float | None = None,
        partial_pct: float = 100.0,
        cancel_brackets: bool = False,
    ) -> dict[str, Any]:
        bracket = self._active_brackets.get(symbol)
        if bracket:
            if cancel_brackets or partial_pct >= 100:
                await self.brackets.cancel_all(symbol, bracket)
                if partial_pct >= 100:
                    self._active_brackets.pop(symbol, None)
            elif partial_pct < 100:
                new_size = bracket.size * (1 - partial_pct / 100)
                await self.brackets.resize_brackets(symbol, side, bracket, new_size)

        return await with_retry(
            lambda: self.rest.close_position_reduce_only(symbol, side, size, order_type, price),
            label=f"close {symbol}",
        )

    async def cancel(self, symbol: str, order_id: str) -> dict[str, Any]:
        return await self.rest.cancel_order(symbol, order_id)

    async def check_liquidation_risk(self, symbol: str, side: str, buffer_pct: float) -> tuple[bool, str, float | None]:
        pos = await self.get_position(symbol)
        if not pos or not pos.liquidation_price:
            return False, "no position", None
        dist = self.liquidation_distance_pct(side, pos.mark_price, pos.liquidation_price)
        if dist is None:
            return False, "unknown liq distance", None
        if dist < buffer_pct:
            return True, f"liquidation risk {dist:.2f}% < buffer {buffer_pct}%", dist
        return False, "ok", dist

    async def sync_position_size(self, symbol: str) -> float | None:
        """Reconcile local state with exchange position size."""
        pos = await self.get_position(symbol)
        if not pos:
            return 0.0
        bracket = self._active_brackets.get(symbol)
        if bracket:
            bracket.size = pos.size
        return pos.size

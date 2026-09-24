"""OCO / SL / TP bracket order management for live futures."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from core.retry import with_retry
from exchange.okx_rest import OKXRestClient

log = logging.getLogger("trading_bot.execution.brackets")


@dataclass
class BracketOrders:
    entry_order_id: str | None = None
    sl_algo_id: str | None = None
    tp_algo_id: str | None = None
    sl_trigger: float = 0.0
    tp_trigger: float = 0.0
    size: float = 0.0


class BracketManager:
    def __init__(self, rest: OKXRestClient) -> None:
        self.rest = rest

    async def open_with_brackets(
        self,
        symbol: str,
        side: str,
        size: float,
        *,
        order_type: str = "market",
        price: float | None = None,
        leverage: int = 5,
        stop_loss: float,
        take_profit: float,
    ) -> tuple[dict[str, Any], BracketOrders]:
        await self.rest.set_leverage(symbol, leverage)
        ccxt_side = "buy" if side == "long" else "sell"

        entry = await with_retry(
            lambda: self.rest.create_order_with_brackets(
                symbol, ccxt_side, size, order_type, price, stop_loss, take_profit
            ),
            label=f"entry+brackets {symbol}",
        )

        bracket = BracketOrders(
            entry_order_id=str(entry.get("id", "")),
            sl_algo_id=entry.get("sl_algo_id"),
            tp_algo_id=entry.get("tp_algo_id"),
            sl_trigger=stop_loss,
            tp_trigger=take_profit,
            size=size,
        )
        return entry, bracket

    async def amend_stop(
        self,
        symbol: str,
        side: str,
        bracket: BracketOrders,
        new_stop: float,
    ) -> str | None:
        if bracket.sl_algo_id:
            try:
                await with_retry(
                    lambda: self.rest.amend_algo_order(symbol, bracket.sl_algo_id, new_trigger_px=new_stop),
                    max_attempts=2,
                    label=f"amend SL {symbol}",
                )
                bracket.sl_trigger = new_stop
                return bracket.sl_algo_id
            except Exception as e:
                log.warning("Amend algo SL failed, recreating: %s", e)

        if bracket.sl_algo_id:
            await self.rest.cancel_algo_orders(symbol, [bracket.sl_algo_id])

        close_side = "sell" if side == "long" else "buy"
        new_id = await with_retry(
            lambda: self.rest.place_algo_stop(symbol, close_side, bracket.size, new_stop),
            label=f"recreate SL {symbol}",
        )
        bracket.sl_algo_id = new_id
        bracket.sl_trigger = new_stop
        return new_id

    async def resize_brackets(
        self,
        symbol: str,
        side: str,
        bracket: BracketOrders,
        new_size: float,
    ) -> None:
        """After partial close — resize remaining SL/TP algo orders."""
        if new_size <= 0:
            await self.cancel_all(symbol, bracket)
            return
        bracket.size = new_size
        for algo_id, trigger in ((bracket.sl_algo_id, bracket.sl_trigger), (bracket.tp_algo_id, bracket.tp_trigger)):
            if not algo_id or trigger <= 0:
                continue
            try:
                await self.rest.amend_algo_order(symbol, algo_id, new_size=new_size)
            except Exception:
                pass

    async def cancel_all(self, symbol: str, bracket: BracketOrders) -> None:
        ids = [x for x in (bracket.sl_algo_id, bracket.tp_algo_id) if x]
        if ids:
            await self.rest.cancel_algo_orders(symbol, ids)
        if bracket.entry_order_id:
            try:
                await self.rest.cancel_order(symbol, bracket.entry_order_id)
            except Exception:
                pass

    @staticmethod
    def new_cl_ord_id() -> str:
        return f"brk{uuid.uuid4().hex[:12]}"

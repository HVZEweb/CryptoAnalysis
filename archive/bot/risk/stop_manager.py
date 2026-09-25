"""Stop loss, take profit, trailing management."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class PositionAction(str, Enum):
    HOLD = "hold"
    PARTIAL_CLOSE = "partial_close"
    CLOSE = "close"
    MOVE_STOP = "move_stop"
    TRAIL = "trail"


@dataclass
class StopState:
    stop_loss: float
    take_profit: float
    trailing_stop: float | None = None
    highest_price: float = 0.0
    lowest_price: float = 0.0


class StopManager:
    def __init__(self, trailing_pct: float = 0.2) -> None:
        self.trailing_pct = trailing_pct

    def init_stops(self, entry: float, side: str, sl_pct: float, tp_pct: float) -> StopState:
        if side == "long":
            return StopState(
                stop_loss=entry * (1 - sl_pct / 100),
                take_profit=entry * (1 + tp_pct / 100),
                highest_price=entry,
                lowest_price=entry,
            )
        return StopState(
            stop_loss=entry * (1 + sl_pct / 100),
            take_profit=entry * (1 - tp_pct / 100),
            highest_price=entry,
            lowest_price=entry,
        )

    def evaluate(
        self,
        price: float,
        side: str,
        state: StopState,
        *,
        conditions_deteriorated: bool = False,
    ) -> tuple[PositionAction, StopState, str]:
        state.highest_price = max(state.highest_price, price)
        state.lowest_price = min(state.lowest_price, price)

        if conditions_deteriorated:
            return PositionAction.CLOSE, state, "conditions deteriorated"

        if side == "long":
            if price <= state.stop_loss:
                return PositionAction.CLOSE, state, "stop loss"
            if price >= state.take_profit:
                return PositionAction.PARTIAL_CLOSE, state, "take profit partial"
            trail = state.highest_price * (1 - self.trailing_pct / 100)
            if trail > state.stop_loss and price <= trail:
                return PositionAction.CLOSE, state, "trailing stop"
            if trail > state.stop_loss:
                state.stop_loss = trail
                return PositionAction.TRAIL, state, "trail updated"
        else:
            if price >= state.stop_loss:
                return PositionAction.CLOSE, state, "stop loss"
            if price <= state.take_profit:
                return PositionAction.PARTIAL_CLOSE, state, "take profit partial"
            trail = state.lowest_price * (1 + self.trailing_pct / 100)
            if trail < state.stop_loss and price >= trail:
                return PositionAction.CLOSE, state, "trailing stop"
            if trail < state.stop_loss:
                state.stop_loss = trail
                return PositionAction.TRAIL, state, "trail updated"

        return PositionAction.HOLD, state, "hold"

"""Sweep detection — multi-level book consumption."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SweepEvent:
    ts: int
    inst_id: str
    side: str  # buy | sell
    levels_crossed: int
    total_size: float
    start_price: float
    end_price: float

    @property
    def price_move_bps(self) -> float:
        if not self.start_price:
            return 0.0
        return (self.end_price - self.start_price) / self.start_price * 10000


def detect_sweep(
    prev_best_bid: float,
    prev_best_ask: float,
    new_best_bid: float,
    new_best_ask: float,
    trade_size: float,
    trade_side: str,
    *,
    min_levels: int = 2,
    min_size: float = 0.5,
) -> SweepEvent | None:
    """
    Heuristic: aggressive trade moves BBO through multiple ticks.
    """
    if trade_size < min_size:
        return None

    if trade_side == "buy" and prev_best_ask and new_best_ask:
        tick = abs(new_best_ask - prev_best_ask)
        if tick <= 0:
            return None
        levels = max(1, int(abs(new_best_ask - prev_best_ask) / tick))
        if levels >= min_levels:
            return SweepEvent(
                ts=0,
                inst_id="",
                side="buy",
                levels_crossed=levels,
                total_size=trade_size,
                start_price=prev_best_ask,
                end_price=new_best_ask,
            )
    elif trade_side == "sell" and prev_best_bid and new_best_bid:
        tick = abs(prev_best_bid - new_best_bid)
        if tick <= 0:
            return None
        levels = max(1, int(abs(prev_best_bid - new_best_bid) / tick))
        if levels >= min_levels:
            return SweepEvent(
                ts=0,
                inst_id="",
                side="sell",
                levels_crossed=levels,
                total_size=trade_size,
                start_price=prev_best_bid,
                end_price=new_best_bid,
            )
    return None

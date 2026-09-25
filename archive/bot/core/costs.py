"""Execution cost model — fees, slippage, net edge."""

from __future__ import annotations


def round_trip_cost_pct(
    taker_fee_pct: float,
    slippage_entry_pct: float,
    slippage_exit_pct: float,
    safety_margin_pct: float = 0.0,
) -> float:
    return taker_fee_pct * 2 + slippage_entry_pct + slippage_exit_pct + safety_margin_pct


def estimate_slippage_pct(order_usd: float, book_depth_usd: float, base_slippage: float = 0.05) -> float:
    if book_depth_usd <= 0:
        return base_slippage * 3
    impact = (order_usd / book_depth_usd) * 0.15
    return min(0.8, base_slippage + impact)

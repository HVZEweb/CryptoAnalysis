"""Order book imbalance at multiple depth levels."""

from __future__ import annotations


def imbalance(bid_vol: float, ask_vol: float) -> float:
    total = bid_vol + ask_vol
    if total <= 0:
        return 0.0
    return (bid_vol - ask_vol) / total


def imbalance_from_book(bid_vols: dict[int, float], ask_vols: dict[int, float], level: int) -> float:
    return imbalance(bid_vols.get(level, 0), ask_vols.get(level, 0))

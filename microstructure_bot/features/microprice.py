"""Microprice — queue pressure weighted mid."""

from __future__ import annotations


def microprice(best_bid: float, best_ask: float, bid_size: float, ask_size: float) -> float:
    denom = bid_size + ask_size
    if denom <= 0 or not best_bid or not best_ask:
        return (best_bid + best_ask) / 2 if best_bid and best_ask else 0.0
    return (best_ask * bid_size + best_bid * ask_size) / denom


def microprice_divergence_bps(mid: float, mp: float) -> float:
    if not mid:
        return 0.0
    return (mp - mid) / mid * 10000

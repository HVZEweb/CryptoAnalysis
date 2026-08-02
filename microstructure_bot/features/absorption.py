"""Absorption — aggressive flow without proportional price move."""

from __future__ import annotations


def detect_absorption(
    aggressive_vol: float,
    price_change_bps: float,
    *,
    min_vol: float = 1.0,
    max_price_move_bps: float = 2.0,
) -> bool:
    """
    Large aggressive volume but price barely moves — passive side absorbing.
    """
    if aggressive_vol < min_vol:
        return False
    return abs(price_change_bps) <= max_price_move_bps

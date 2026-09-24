"""Liquidity replenishment after execution."""

from __future__ import annotations


def detect_replenishment(
    depth_after_drop: float,
    depth_current: float,
    depth_before_drop: float,
    *,
    min_recovery_pct: float = 50.0,
) -> bool:
    """
    Depth dropped then recovered — passive liquidity replenished.
    """
    drop = depth_before_drop - depth_after_drop
    if drop <= 0:
        return False
    recovery = depth_current - depth_after_drop
    return recovery / drop * 100 >= min_recovery_pct

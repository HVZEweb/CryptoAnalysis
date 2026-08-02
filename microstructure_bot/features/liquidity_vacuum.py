"""Liquidity vacuum — sudden depth disappearance."""

from __future__ import annotations


def detect_liquidity_vacuum(
    depth_now: float,
    depth_before: float,
    *,
    threshold_pct: float = -25.0,
) -> bool:
    if depth_before <= 0:
        return False
    change = (depth_now - depth_before) / depth_before * 100
    return change <= threshold_pct

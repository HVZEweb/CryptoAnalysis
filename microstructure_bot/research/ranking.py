"""Alpha Ranking — sort events by statistical strength."""

from __future__ import annotations

from typing import Any


def rank_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Sort by:
    1. Expectancy
    2. Profit Factor
    3. OOS Stability (walk-forward)
    4. Bootstrap significance (lower p better)
    5. Cross-symbol stability
    """
    if not candidates:
        return []

    def sort_key(c: dict) -> tuple:
        ev = c.get("expectancy", -999)
        pf = c.get("profit_factor", 0)
        oos = 1 if c.get("oos_pass") else 0
        wf = 1 if c.get("walk_forward_stable") else 0
        boot = c.get("bootstrap_p", 1.0)
        cross = c.get("cross_symbol_pass", 0)
        return (-ev, -pf, -(oos + wf), boot, -cross)

    ranked = sorted(candidates, key=sort_key)
    for i, c in enumerate(ranked, 1):
        c["rank"] = i
    return ranked


def build_ranking_entry(
    event_key: str,
    horizon_sec: int,
    exploration: dict,
    validation: dict,
    *,
    cross_symbol_pass: bool,
    symbols_passed: list[str],
) -> dict[str, Any]:
    horizons = exploration.get("horizons", [])
    h_stats = next((h for h in horizons if h.get("horizon_sec") == horizon_sec), horizons[0] if horizons else {})

    return {
        "event_key": event_key,
        "horizon_sec": horizon_sec,
        "events": exploration.get("count", 0),
        "expectancy": validation.get("test_ev", h_stats.get("expectancy_pct", 0)),
        "profit_factor": h_stats.get("profit_factor", 0),
        "prob_up_pct": h_stats.get("prob_up_pct", 0),
        "prob_down_pct": h_stats.get("prob_down_pct", 0),
        "oos_pass": validation.get("oos_pass", False),
        "walk_forward_stable": validation.get("walk_forward_stable", False),
        "bootstrap_p": validation.get("bootstrap_p", 1.0),
        "independent_days_pass": validation.get("independent_days_pass", False),
        "cross_symbol_pass": cross_symbol_pass,
        "symbols_passed": symbols_passed,
        "accepted": validation.get("accepted", False) and cross_symbol_pass,
        "verdict": validation.get("verdict", ""),
    }

"""Event Explorer — what happened after each detected event."""

from __future__ import annotations

from typing import Any

import pandas as pd

from config import Config
from research.causal import select_best_horizon_train
from research.labeling import label_forward_returns
from research.statistics import event_study_table


def explore_events(
    prices: pd.DataFrame,
    events: pd.DataFrame,
    config: Config,
    *,
    event_key: str,
) -> dict[str, Any]:
    """Answer: what happened after this event? Across all horizons."""
    if events.empty:
        return {"event_key": event_key, "count": 0, "horizons": [], "labeled_sample": []}

    labeled = label_forward_returns(prices, events, horizons_sec=config.event_horizons_sec)
    horizons = event_study_table(labeled, config.event_horizons_sec)

    best_h_sec = select_best_horizon_train(
        labeled, config.event_horizons_sec, config.oos_holdout_pct
    )
    best_h = next((h for h in horizons if h.get("horizon_sec") == best_h_sec), horizons[0] if horizons else None)
    sample = labeled.head(5).to_dict(orient="records") if len(labeled) else []

    return {
        "event_key": event_key,
        "count": len(events),
        "horizons": horizons,
        "best_horizon_sec": best_h.get("horizon_sec") if best_h else None,
        "best_expectancy": best_h.get("expectancy_pct") if best_h else None,
        "labeled_sample": sample,
    }


def explore_all_event_types(
    prices: pd.DataFrame,
    all_events: pd.DataFrame,
    config: Config,
) -> list[dict[str, Any]]:
    if all_events.empty:
        return []
    results = []
    for (event, quantile), grp in all_events.groupby(["event", "quantile"]):
        key = f"{event}_{quantile}"
        results.append(explore_events(prices, grp.reset_index(drop=True), config, event_key=key))
    return results

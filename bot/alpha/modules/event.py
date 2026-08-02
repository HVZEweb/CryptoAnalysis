"""Event-driven alpha research."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleMeta
from alpha.features import align_series_to_ohlcv, funding_window_proximity, pct_change


class FundingWindowEffect(AlphaModule):
    meta = AlphaModuleMeta(
        "event_funding_window",
        "Funding Window Effect",
        "event",
        "Price behaviour in 30min before/after funding settlement",
        data_requirements=("ohlcv", "funding"),
    )
    max_hold_bars = 6

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["funding_rate"] = align_series_to_ohlcv(f, ctx.funding, "funding_rate")
        f["funding_dist_min"] = funding_window_proximity(f["ts"])
        f["ret"] = pct_change(f["close"], 3)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(20, len(features) - 8):
            row = features.iloc[i]
            if row["funding_dist_min"] > 15:
                continue
            if row["funding_rate"] > 0.0001:
                entries.append((i, "short"))
            elif row["funding_rate"] < -0.0001:
                entries.append((i, "long"))
        return entries


class MacroEventStub(AlphaModule):
    """CPI / FOMC / NFP — requires external economic calendar data."""

    meta = AlphaModuleMeta(
        "event_macro_calendar",
        "Macro Event Calendar",
        "event",
        "CPI, FOMC, NFP — requires external calendar feed (not available via OKX OHLCV)",
        data_requirements=("events",),
    )

    def check_data(self, ctx: AlphaContext) -> str | None:
        if ctx.events is None or len(ctx.events) < 3:
            return "Macro event calendar unavailable — integrate external economic calendar API"
        return None

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        return ctx.events.copy() if ctx.events is not None else pd.DataFrame()

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        return []


EVENT_MODULES = [FundingWindowEffect(), MacroEventStub()]

"""Open interest alpha modules."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleMeta
from alpha.features import align_series_to_ohlcv, pct_change


class OIAccumulationBreakout(AlphaModule):
    meta = AlphaModuleMeta(
        "oi_accumulation_breakout",
        "OI Accumulation Breakout",
        "open_interest",
        "Rising OI without price move — positioning buildup before expansion",
        data_requirements=("ohlcv", "open_interest"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["open_interest"] = align_series_to_ohlcv(f, ctx.open_interest, "open_interest")
        f["oi_chg"] = pct_change(f["open_interest"], 12)
        f["price_chg"] = pct_change(f["close"], 12)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(60, len(features) - 15):
            row = features.iloc[i]
            if pd.isna(row["oi_chg"]) or pd.isna(row["price_chg"]):
                continue
            if row["oi_chg"] > 2.0 and abs(row["price_chg"]) < 0.3:
                entries.append((i, "long"))
            elif row["oi_chg"] > 2.0 and row["price_chg"] < -0.3:
                entries.append((i, "short"))
        return entries


class OIDropUnwind(AlphaModule):
    meta = AlphaModuleMeta(
        "oi_drop_unwind",
        "OI Drop Unwind",
        "open_interest",
        "Sharp OI drop — forced unwind, fade the move",
        data_requirements=("ohlcv", "open_interest"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["open_interest"] = align_series_to_ohlcv(f, ctx.open_interest, "open_interest")
        f["oi_chg"] = pct_change(f["open_interest"], 6)
        f["price_chg"] = pct_change(f["close"], 6)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(40, len(features) - 12):
            row = features.iloc[i]
            if pd.isna(row["oi_chg"]):
                continue
            if row["oi_chg"] < -2.5 and row["price_chg"] < -0.5:
                entries.append((i, "long"))
            elif row["oi_chg"] < -2.5 and row["price_chg"] > 0.5:
                entries.append((i, "short"))
        return entries


class PriceOIDivergence(AlphaModule):
    meta = AlphaModuleMeta(
        "price_oi_divergence",
        "Price vs OI Divergence",
        "open_interest",
        "Price up + OI down (short covering) or price down + OI up (new shorts)",
        data_requirements=("ohlcv", "open_interest"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["open_interest"] = align_series_to_ohlcv(f, ctx.open_interest, "open_interest")
        f["oi_chg"] = pct_change(f["open_interest"], 12)
        f["price_chg"] = pct_change(f["close"], 12)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(60, len(features) - 12):
            row = features.iloc[i]
            if pd.isna(row["oi_chg"]) or pd.isna(row["price_chg"]):
                continue
            if row["price_chg"] > 0.8 and row["oi_chg"] < -1.0:
                entries.append((i, "long"))
            elif row["price_chg"] < -0.8 and row["oi_chg"] > 1.0:
                entries.append((i, "short"))
        return entries


class OIBreakoutContinuation(AlphaModule):
    meta = AlphaModuleMeta(
        "oi_breakout_continuation",
        "OI Breakout Continuation",
        "open_interest",
        "Price breakout with concurrent OI expansion — trend continuation",
        data_requirements=("ohlcv", "open_interest"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["open_interest"] = align_series_to_ohlcv(f, ctx.open_interest, "open_interest")
        f["oi_chg"] = pct_change(f["open_interest"], 6)
        f["range_high"] = f["high"].rolling(24).max().shift(1)
        f["range_low"] = f["low"].rolling(24).min().shift(1)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(50, len(features) - 12):
            row = features.iloc[i]
            if pd.isna(row["oi_chg"]) or pd.isna(row["range_high"]):
                continue
            if row["close"] > row["range_high"] and row["oi_chg"] > 1.0:
                entries.append((i, "long"))
            elif row["close"] < row["range_low"] and row["oi_chg"] > 1.0:
                entries.append((i, "short"))
        return entries


OI_MODULES = [
    OIAccumulationBreakout(),
    OIDropUnwind(),
    PriceOIDivergence(),
    OIBreakoutContinuation(),
]

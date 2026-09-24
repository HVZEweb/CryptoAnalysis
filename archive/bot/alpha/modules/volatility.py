"""Volatility research — no EMA/RSI/Bollinger signals."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleMeta
from alpha.features import pct_change, realised_volatility, true_range_pct


class VolatilityExpansionBreakout(AlphaModule):
    meta = AlphaModuleMeta(
        "vol_expansion_breakout",
        "Volatility Expansion Breakout",
        "volatility",
        "Realised vol spike + range break — expansion continuation",
        data_requirements=("ohlcv",),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["rvol"] = realised_volatility(f["close"], 48)
        f["rvol_chg"] = pct_change(f["rvol"], 6)
        f["range_high"] = f["high"].rolling(36).max().shift(1)
        f["range_low"] = f["low"].rolling(36).min().shift(1)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(60, len(features) - 12):
            row = features.iloc[i]
            if pd.isna(row["rvol_chg"]) or row["rvol_chg"] < 15:
                continue
            if row["close"] > row["range_high"]:
                entries.append((i, "long"))
            elif row["close"] < row["range_low"]:
                entries.append((i, "short"))
        return entries


class VolatilityCompressionBreakout(AlphaModule):
    meta = AlphaModuleMeta(
        "vol_compression_breakout",
        "Volatility Compression Breakout",
        "volatility",
        "Low realised vol percentile then range expansion",
        data_requirements=("ohlcv",),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["rvol"] = realised_volatility(f["close"], 48)
        f["rvol_pct"] = f["rvol"].rolling(200, min_periods=50).apply(lambda x: (x.iloc[-1] <= x.quantile(0.2)), raw=False)
        f["tr_pct"] = true_range_pct(f["high"], f["low"], f["close"])
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(220, len(features) - 12):
            row = features.iloc[i]
            prev = features.iloc[i - 6 : i]
            if not row["rvol_pct"]:
                continue
            if prev["tr_pct"].mean() < row["tr_pct"] * 0.7:
                continue
            if row["close"] > prev["high"].max():
                entries.append((i, "long"))
            elif row["close"] < prev["low"].min():
                entries.append((i, "short"))
        return entries


class RealisedVolRegimeShift(AlphaModule):
    meta = AlphaModuleMeta(
        "realised_vol_regime_shift",
        "Realised Vol Regime Shift",
        "volatility",
        "Transition from low to high realised vol — momentum entry",
        data_requirements=("ohlcv",),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["rvol"] = realised_volatility(f["close"], 24)
        f["rvol_ma"] = f["rvol"].rolling(96).mean()
        f["regime_shift"] = (f["rvol"] > f["rvol_ma"] * 1.4) & (f["rvol"].shift(6) < f["rvol_ma"].shift(6))
        f["mom"] = pct_change(f["close"], 6)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(120, len(features) - 10):
            row = features.iloc[i]
            if not row["regime_shift"]:
                continue
            if row["mom"] > 0.3:
                entries.append((i, "long"))
            elif row["mom"] < -0.3:
                entries.append((i, "short"))
        return entries


class ATRRegimeShift(AlphaModule):
    meta = AlphaModuleMeta(
        "atr_regime_shift",
        "ATR Regime Shift",
        "volatility",
        "True range regime expansion — not used as classic indicator combo",
        data_requirements=("ohlcv",),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["tr_pct"] = true_range_pct(f["high"], f["low"], f["close"])
        f["tr_ma"] = f["tr_pct"].rolling(48).mean()
        f["shift"] = f["tr_pct"] > f["tr_ma"] * 1.6
        f["dir"] = pct_change(f["close"], 3)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(60, len(features) - 10):
            row = features.iloc[i]
            if not row["shift"]:
                continue
            if row["dir"] > 0.2:
                entries.append((i, "long"))
            elif row["dir"] < -0.2:
                entries.append((i, "short"))
        return entries


VOLATILITY_MODULES = [
    VolatilityExpansionBreakout(),
    VolatilityCompressionBreakout(),
    RealisedVolRegimeShift(),
    ATRRegimeShift(),
]

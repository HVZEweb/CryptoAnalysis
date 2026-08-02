"""Liquidation research modules."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleMeta
from alpha.features import align_series_to_ohlcv, pct_change


def _liq_volume_series(ctx: AlphaContext, ohlcv: pd.DataFrame) -> pd.Series:
    if ctx.liquidations is None or ctx.liquidations.empty:
        return pd.Series(0.0, index=ohlcv.index)
    agg = ctx.liquidations.groupby("ts").agg(sz=("sz", "sum")).reset_index()
    return align_series_to_ohlcv(ohlcv, agg, "sz").fillna(0)


class LiquidationCascadeReversal(AlphaModule):
    meta = AlphaModuleMeta(
        "liquidation_cascade_reversal",
        "Liquidation Cascade Reversal",
        "liquidation",
        "Fade sharp move after liquidation volume spike",
        data_requirements=("ohlcv", "liquidations"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["liq_vol"] = _liq_volume_series(ctx, f)
        f["price_chg"] = pct_change(f["close"], 3)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        thr_series = features["liq_vol"].expanding(min_periods=50).quantile(0.85).shift(1)
        for i in range(30, len(features) - 10):
            row = features.iloc[i]
            thr = thr_series.iloc[i]
            if pd.isna(thr) or row["liq_vol"] < thr:
                continue
            if row["price_chg"] < -0.8:
                entries.append((i, "long"))
            elif row["price_chg"] > 0.8:
                entries.append((i, "short"))
        return entries


class LiquidationContinuation(AlphaModule):
    meta = AlphaModuleMeta(
        "liquidation_continuation",
        "Liquidation Continuation",
        "liquidation",
        "Liquidation spike in trend direction — momentum continues",
        data_requirements=("ohlcv", "liquidations"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["liq_vol"] = _liq_volume_series(ctx, f)
        f["price_chg"] = pct_change(f["close"], 12)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        thr_series = features["liq_vol"].expanding(min_periods=50).quantile(0.8).shift(1)
        for i in range(40, len(features) - 10):
            row = features.iloc[i]
            thr = thr_series.iloc[i]
            if pd.isna(thr) or row["liq_vol"] < thr:
                continue
            if row["price_chg"] > 1.0:
                entries.append((i, "long"))
            elif row["price_chg"] < -1.0:
                entries.append((i, "short"))
        return entries


class LiquidationVolumeReturn(AlphaModule):
    meta = AlphaModuleMeta(
        "liquidation_volume_return",
        "Liquidation Volume → Forward Return",
        "liquidation",
        "High liquidation notional predicts short-horizon mean reversion",
        data_requirements=("ohlcv", "liquidations"),
    )
    max_hold_bars = 8

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["liq_vol"] = _liq_volume_series(ctx, f)
        f["liq_z"] = (f["liq_vol"] - f["liq_vol"].rolling(48).mean()) / f["liq_vol"].rolling(48).std()
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(60, len(features) - 10):
            z = features.iloc[i]["liq_z"]
            if pd.isna(z) or z < 2.0:
                continue
            chg = pct_change(features["close"], 3).iloc[i]
            if pd.isna(chg):
                continue
            entries.append((i, "short" if chg > 0 else "long"))
        return entries


LIQUIDATION_MODULES = [
    LiquidationCascadeReversal(),
    LiquidationContinuation(),
    LiquidationVolumeReturn(),
]

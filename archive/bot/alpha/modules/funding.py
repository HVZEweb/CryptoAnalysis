"""Funding rate alpha modules."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleMeta
from alpha.features import align_series_to_ohlcv, rolling_zscore


class ExtremeFundingFade(AlphaModule):
    meta = AlphaModuleMeta(
        "funding_extreme_fade",
        "Extreme Funding Fade",
        "funding",
        "Fade extreme funding rates — crowded positioning mean reverts",
        data_requirements=("ohlcv", "funding"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["funding_rate"] = align_series_to_ohlcv(f, ctx.funding, "funding_rate")
        f["funding_z"] = rolling_zscore(f["funding_rate"], 90)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(100, len(features) - 20):
            z = features.iloc[i]["funding_z"]
            if pd.isna(z):
                continue
            if z > 2.0:
                entries.append((i, "short"))
            elif z < -2.0:
                entries.append((i, "long"))
        return entries


class FundingSettlementReversion(AlphaModule):
    meta = AlphaModuleMeta(
        "funding_settlement_reversion",
        "Funding Settlement Reversion",
        "funding",
        "Mean reversion in the 12 bars after funding settlement",
        data_requirements=("ohlcv", "funding"),
    )
    max_hold_bars = 12

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["funding_rate"] = align_series_to_ohlcv(f, ctx.funding, "funding_rate")
        f["funding_chg"] = f["funding_rate"].diff()
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(5, len(features) - 15):
            chg = features.iloc[i]["funding_chg"]
            rate = features.iloc[i]["funding_rate"]
            if pd.isna(chg) or pd.isna(rate):
                continue
            if abs(chg) < 0.0001:
                continue
            if rate > 0.0003:
                entries.append((i, "short"))
            elif rate < -0.0003:
                entries.append((i, "long"))
        return entries


class FundingOICombo(AlphaModule):
    meta = AlphaModuleMeta(
        "funding_oi_combo",
        "Funding + Open Interest Combo",
        "funding",
        "Extreme funding with rising OI — positioning squeeze hypothesis",
        data_requirements=("ohlcv", "funding", "open_interest"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["funding_rate"] = align_series_to_ohlcv(f, ctx.funding, "funding_rate")
        f["open_interest"] = align_series_to_ohlcv(f, ctx.open_interest, "open_interest")
        f["oi_chg_pct"] = f["open_interest"].pct_change(6) * 100
        f["funding_z"] = rolling_zscore(f["funding_rate"], 60)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(80, len(features) - 15):
            row = features.iloc[i]
            if pd.isna(row["funding_z"]) or pd.isna(row["oi_chg_pct"]):
                continue
            if row["funding_z"] > 1.5 and row["oi_chg_pct"] > 1.0:
                entries.append((i, "short"))
            elif row["funding_z"] < -1.5 and row["oi_chg_pct"] > 1.0:
                entries.append((i, "long"))
        return entries


class FundingLiquidationCombo(AlphaModule):
    meta = AlphaModuleMeta(
        "funding_liquidation_combo",
        "Funding + Liquidation Combo",
        "funding",
        "High funding followed by liquidation cluster — cascade fade",
        data_requirements=("ohlcv", "funding", "liquidations"),
    )

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["funding_rate"] = align_series_to_ohlcv(f, ctx.funding, "funding_rate")
        if ctx.liquidations is not None and not ctx.liquidations.empty:
            liq = ctx.liquidations.groupby("ts")["sz"].sum().reset_index()
            liq.columns = ["ts", "liq_sz"]
            f["liq_sz"] = align_series_to_ohlcv(f, liq, "liq_sz").fillna(0)
        else:
            f["liq_sz"] = 0.0
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        liq_thr_series = features["liq_sz"].expanding(min_periods=50).quantile(0.9).shift(1)
        for i in range(50, len(features) - 15):
            row = features.iloc[i]
            liq_thr = liq_thr_series.iloc[i]
            if pd.isna(liq_thr) or row["liq_sz"] < liq_thr:
                continue
            if row["funding_rate"] > 0.0002:
                entries.append((i, "long"))
            elif row["funding_rate"] < -0.0002:
                entries.append((i, "short"))
        return entries


FUNDING_MODULES = [
    ExtremeFundingFade(),
    FundingSettlementReversion(),
    FundingOICombo(),
    FundingLiquidationCombo(),
]

"""Session and time-of-day alpha research."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleMeta
from alpha.features import day_of_week, hour_of_day, pct_change, session_label


class SessionEdgeAsia(AlphaModule):
    meta = AlphaModuleMeta("session_asia_edge", "Asia Session Edge", "session", "Returns pattern in Asia session (UTC 0-8)", data_requirements=("ohlcv",))

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["session"] = session_label(f["ts"])
        f["ret_1"] = pct_change(f["close"], 1)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(20, len(features) - 8):
            if features.iloc[i]["session"] != "asia":
                continue
            if features.iloc[i - 3 : i]["ret_1"].sum() < -0.4:
                entries.append((i, "long"))
            elif features.iloc[i - 3 : i]["ret_1"].sum() > 0.4:
                entries.append((i, "short"))
        return entries


class SessionEdgeEurope(AlphaModule):
    meta = AlphaModuleMeta("session_europe_edge", "Europe Session Edge", "session", "Europe session momentum (UTC 8-13)", data_requirements=("ohlcv",))

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["session"] = session_label(f["ts"])
        f["mom"] = pct_change(f["close"], 6)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(30, len(features) - 8):
            if features.iloc[i]["session"] != "europe":
                continue
            m = features.iloc[i]["mom"]
            if m > 0.25:
                entries.append((i, "long"))
            elif m < -0.25:
                entries.append((i, "short"))
        return entries


class SessionEdgeUS(AlphaModule):
    meta = AlphaModuleMeta("session_us_edge", "US Session Edge", "session", "US session volatility capture (UTC 13-21)", data_requirements=("ohlcv",))

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["session"] = session_label(f["ts"])
        f["range"] = (f["high"] - f["low"]) / f["close"] * 100
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(30, len(features) - 8):
            if features.iloc[i]["session"] != "us":
                continue
            if features.iloc[i]["range"] > features["range"].rolling(48).mean().iloc[i] * 1.3:
                chg = pct_change(features["close"], 2).iloc[i]
                if chg > 0:
                    entries.append((i, "long"))
                elif chg < 0:
                    entries.append((i, "short"))
        return entries


class SessionOverlapEdge(AlphaModule):
    meta = AlphaModuleMeta("session_overlap_edge", "Session Overlap Edge", "session", "Europe/US overlap liquidity burst", data_requirements=("ohlcv",))

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["session"] = session_label(f["ts"])
        f["vol_chg"] = f["volume"].pct_change(3) * 100
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(30, len(features) - 8):
            sess = features.iloc[i]["session"]
            if sess not in ("europe_us_overlap", "asia_europe_overlap"):
                continue
            if features.iloc[i]["vol_chg"] > 50:
                chg = pct_change(features["close"], 1).iloc[i]
                entries.append((i, "long" if chg > 0 else "short"))
        return entries


class DayOfWeekEffect(AlphaModule):
    meta = AlphaModuleMeta("day_of_week_effect", "Day of Week Effect", "session", "Weekday seasonality in crypto futures", data_requirements=("ohlcv",))

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["dow"] = day_of_week(f["ts"])
        f["ret"] = pct_change(f["close"], 12)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(30, len(features) - 12):
            dow = int(features.iloc[i]["dow"])
            if dow == 0:
                entries.append((i, "long"))
            elif dow == 4:
                entries.append((i, "short"))
        return entries


class HourOfDayEffect(AlphaModule):
    meta = AlphaModuleMeta("hour_of_day_effect", "Hour of Day Effect", "session", "Funding-adjacent hour patterns", data_requirements=("ohlcv",))

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        f["hour"] = hour_of_day(f["ts"])
        f["ret"] = pct_change(f["close"], 6)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        funding_hours = {0, 8, 16}
        for i in range(20, len(features) - 10):
            h = int(features.iloc[i]["hour"])
            if h not in funding_hours:
                continue
            r = features.iloc[i]["ret"]
            if r > 0.2:
                entries.append((i, "short"))
            elif r < -0.2:
                entries.append((i, "long"))
        return entries


SESSION_MODULES = [
    SessionEdgeAsia(),
    SessionEdgeEurope(),
    SessionEdgeUS(),
    SessionOverlapEdge(),
    DayOfWeekEffect(),
    HourOfDayEffect(),
]

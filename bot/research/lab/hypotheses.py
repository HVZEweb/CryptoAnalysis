"""Independent trading hypotheses for Research Lab."""

from __future__ import annotations

import pandas as pd

from market import indicators as ind
from research.lab.base import Hypothesis, HypothesisMeta


class OpeningRangeBreakout(Hypothesis):
    meta = HypothesisMeta("opening_range_breakout", "Opening Range Breakout", "Breakout of first 12 bars range")

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        if idx < 15:
            return None
        window = df.iloc[idx - 12 : idx]
        high = float(window["high"].max())
        low = float(window["low"].min())
        price = float(df.iloc[idx]["close"])
        if price > high:
            return "long"
        if price < low:
            return "short"
        return None


class VwapReversion(Hypothesis):
    meta = HypothesisMeta("vwap_reversion", "VWAP Reversion", "Fade extended moves from session VWAP")

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        if idx < 30:
            return None
        tail = df.iloc[max(0, idx - 48) : idx + 1]
        vwap = float(ind.vwap(tail["close"], tail["volume"]).iloc[-1])
        price = float(df.iloc[idx]["close"])
        dev = (price - vwap) / vwap * 100
        if dev > 0.35:
            return "short"
        if dev < -0.35:
            return "long"
        return None


class FundingMeanReversion(Hypothesis):
    meta = HypothesisMeta(
        "funding_mean_reversion",
        "Funding Mean Reversion",
        "Proxy: fade sharp funding-like premium moves (OHLCV proxy)",
        data_requirements="OHLCV proxy — no funding history",
    )

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        if idx < 20:
            return None
        ret = (float(df.iloc[idx]["close"]) - float(df.iloc[idx - 12]["close"])) / float(df.iloc[idx - 12]["close"]) * 100
        if ret > 1.2:
            return "short"
        if ret < -1.2:
            return "long"
        return None


class LiquidationBounce(Hypothesis):
    meta = HypothesisMeta(
        "liquidation_bounce",
        "Liquidation Bounce",
        "Proxy: sharp drop + reversal candle",
        data_requirements="OHLCV proxy — no liquidation feed",
    )

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        if idx < 5:
            return None
        prev = df.iloc[idx - 3 : idx]
        drop = (float(prev["close"].iloc[-1]) - float(prev["close"].iloc[0])) / float(prev["close"].iloc[0]) * 100
        row = df.iloc[idx]
        bullish = float(row["close"]) > float(row["open"])
        if drop < -1.5 and bullish:
            return "long"
        rise = -drop
        bearish = float(row["close"]) < float(row["open"])
        if rise > 1.5 and bearish:
            return "short"
        return None


class TrendPullback(Hypothesis):
    meta = HypothesisMeta("trend_pullback", "Trend Pullback", "EMA trend with RSI pullback entry")

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        row = df.iloc[idx]
        if pd.isna(row.get("ema9")) or pd.isna(row.get("rsi")):
            return None
        bull = float(row["ema9"]) > float(row["ema21"])
        rsi = float(row["rsi"])
        if bull and 40 < rsi < 50:
            return "long"
        if not bull and 50 < rsi < 60:
            return "short"
        return None


class VolumeSpikeContinuation(Hypothesis):
    meta = HypothesisMeta("volume_spike_continuation", "Volume Spike Continuation", "High volume impulse in trend direction")

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        row = df.iloc[idx]
        vol_ma = row.get("vol_ma20")
        if pd.isna(vol_ma) or float(vol_ma) <= 0:
            return None
        if float(row["volume"]) < float(vol_ma) * 2.0:
            return None
        bull = float(row["ema9"]) > float(row["ema21"])
        green = float(row["close"]) > float(row["open"])
        if bull and green:
            return "long"
        if not bull and not green:
            return "short"
        return None


class AtrBreakout(Hypothesis):
    meta = HypothesisMeta("atr_breakout", "ATR Breakout", "Close breaks prior range by ATR multiple")

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        if idx < 20:
            return None
        row = df.iloc[idx]
        atr = float(row["atr"]) if pd.notna(row["atr"]) else 0
        if atr <= 0:
            return None
        prev_high = float(df.iloc[idx - 6 : idx]["high"].max())
        prev_low = float(df.iloc[idx - 6 : idx]["low"].min())
        price = float(row["close"])
        if price > prev_high + atr * 0.5:
            return "long"
        if price < prev_low - atr * 0.5:
            return "short"
        return None


class MomentumExhaustion(Hypothesis):
    meta = HypothesisMeta("momentum_exhaustion", "Momentum Exhaustion", "RSI extreme after extended move")

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        if idx < 15:
            return None
        rsi = float(df.iloc[idx]["rsi"]) if pd.notna(df.iloc[idx]["rsi"]) else 50
        move = (float(df.iloc[idx]["close"]) - float(df.iloc[idx - 10]["close"])) / float(df.iloc[idx - 10]["close"]) * 100
        if move > 1.5 and rsi > 72:
            return "short"
        if move < -1.5 and rsi < 28:
            return "long"
        return None


class OrderFlowImbalance(Hypothesis):
    meta = HypothesisMeta(
        "order_flow_imbalance",
        "Order Flow Imbalance",
        "Proxy: candle body/volume imbalance",
        data_requirements="OHLCV proxy — no L2 order flow",
    )

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        if idx < 5:
            return None
        window = df.iloc[idx - 5 : idx + 1]
        buy_vol = sum(float(r["volume"]) for _, r in window.iterrows() if float(r["close"]) >= float(r["open"]))
        sell_vol = sum(float(r["volume"]) for _, r in window.iterrows() if float(r["close"]) < float(r["open"]))
        total = buy_vol + sell_vol
        if total <= 0:
            return None
        imbalance = (buy_vol - sell_vol) / total
        if imbalance > 0.35:
            return "long"
        if imbalance < -0.35:
            return "short"
        return None


class VolatilityCompressionBreakout(Hypothesis):
    meta = HypothesisMeta("volatility_compression_breakout", "Volatility Compression Breakout", "Bollinger squeeze then expansion")

    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        if idx < 25:
            return None
        row = df.iloc[idx]
        prev = df.iloc[idx - 5 : idx]
        width_now = (float(row["bb_upper"]) - float(row["bb_lower"])) / float(row["close"]) * 100
        widths = [
            (float(r["bb_upper"]) - float(r["bb_lower"])) / float(r["close"]) * 100
            for _, r in prev.iterrows()
            if pd.notna(r["bb_upper"])
        ]
        if not widths:
            return None
        if float(min(widths)) > width_now * 0.95:
            return None
        price = float(row["close"])
        if price > float(row["bb_upper"]):
            return "long"
        if price < float(row["bb_lower"]):
            return "short"
        return None


ALL_HYPOTHESES: list[Hypothesis] = [
    OpeningRangeBreakout(),
    VwapReversion(),
    FundingMeanReversion(),
    LiquidationBounce(),
    TrendPullback(),
    VolumeSpikeContinuation(),
    AtrBreakout(),
    MomentumExhaustion(),
    OrderFlowImbalance(),
    VolatilityCompressionBreakout(),
]

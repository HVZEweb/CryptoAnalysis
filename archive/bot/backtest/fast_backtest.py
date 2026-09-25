"""Fast vectorized backtest — mirrors quant_scalping rules on simulated OHLCV."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backtest.market_simulator import MarketScenario
from backtest.metrics import PerformanceMetrics, build_metrics
from core.costs import round_trip_cost_pct
from market import indicators as ind


@dataclass(frozen=True)
class StrategyParams:
    tp_pct: float = 0.45
    sl_pct: float = 0.25
    trailing_pct: float = 0.15
    min_rr: float = 1.5
    min_profit_pct: float = 0.30
    rsi_low: float = 35.0
    rsi_high: float = 65.0
    max_hold_bars: int = 6
    min_bullish_score: int = 3
    atr_max_pct: float = 2.5
    taker_fee_pct: float = 0.05
    slippage_pct: float = 0.03
    safety_margin_pct: float = 0.10

    def to_dict(self) -> dict:
        return {
            "tp_pct": self.tp_pct,
            "sl_pct": self.sl_pct,
            "trailing_pct": self.trailing_pct,
            "min_rr": self.min_rr,
            "min_profit_pct": self.min_profit_pct,
            "rsi_low": self.rsi_low,
            "rsi_high": self.rsi_high,
            "max_hold_bars": self.max_hold_bars,
            "min_bullish_score": self.min_bullish_score,
            "atr_max_pct": self.atr_max_pct,
        }


def _precompute(df: pd.DataFrame) -> pd.DataFrame:
    w = df.copy()
    w["ema9"] = ind.ema(w["close"], 9)
    w["ema21"] = ind.ema(w["close"], 21)
    w["rsi"] = ind.rsi(w["close"], 14)
    w["atr"] = ind.atr(w["high"], w["low"], w["close"], 14)
    pv = w["close"] * w["volume"]
    w["vwap"] = pv.rolling(48, min_periods=1).sum() / w["volume"].rolling(48, min_periods=1).sum()
    w["vol_ma20"] = w["volume"].rolling(20).mean()
    upper, mid_bb, lower = ind.bollinger(w["close"])
    w["bb_upper"] = upper
    w["bb_lower"] = lower
    return w


def run_scenario_returns(scenario: MarketScenario, params: StrategyParams) -> list[float]:
    return _simulate_trades(scenario, params)


def _simulate_trades(scenario: MarketScenario, params: StrategyParams) -> list[float]:
    df = _precompute(scenario.df)
    slip = params.slippage_pct * scenario.slippage_mult
    costs_total_pct = round_trip_cost_pct(
        params.taker_fee_pct,
        slip,
        slip,
        params.safety_margin_pct,
    )
    costs_total_pct += scenario.spread_pct * 0.5
    costs_decimal = costs_total_pct / 100

    if scenario.spread_pct > 0.25:
        return []

    trades: list[float] = []
    position: dict | None = None

    for i in range(50, len(df)):
        row = df.iloc[i]
        price = float(row["close"])
        atr_pct = float(row["atr"] / price * 100) if price and pd.notna(row["atr"]) else 0

        if position:
            position["high"] = max(position["high"], price)
            position["low"] = min(position["low"], price)
            bars_held = i - position["bar"]

            hit_sl = price <= position["sl"] if position["side"] == "long" else price >= position["sl"]
            hit_tp = price >= position["tp"] if position["side"] == "long" else price <= position["tp"]
            timeout = bars_held >= params.max_hold_bars

            if hit_sl or hit_tp or timeout:
                if position["side"] == "long":
                    pnl = (price - position["entry"]) / position["entry"] - costs_decimal
                else:
                    pnl = (position["entry"] - price) / position["entry"] - costs_decimal
                trades.append(pnl)
                position = None
            continue

        if atr_pct > params.atr_max_pct:
            continue

        rsi = float(row["rsi"]) if pd.notna(row["rsi"]) else 50
        ema_bull = float(row["ema9"]) > float(row["ema21"])
        side: str | None = None

        if ema_bull and rsi < params.rsi_low:
            side = "long"
        elif not ema_bull and rsi > params.rsi_high:
            side = "short"
        elif price < float(row["bb_lower"]):
            side = "long"
        elif price > float(row["bb_upper"]):
            side = "short"

        if not side:
            continue

        sl = price * (1 - params.sl_pct / 100) if side == "long" else price * (1 + params.sl_pct / 100)
        tp = price * (1 + params.tp_pct / 100) if side == "long" else price * (1 - params.tp_pct / 100)
        rr = params.tp_pct / params.sl_pct
        if rr < params.min_rr:
            continue

        position = {"side": side, "entry": price, "sl": sl, "tp": tp, "high": price, "low": price, "bar": i}

    return trades


def run_scenario(scenario: MarketScenario, params: StrategyParams) -> PerformanceMetrics:
    returns = _simulate_trades(scenario, params)
    return build_metrics(returns)

"""Research Lab — independent hypothesis base."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import pandas as pd

from market import indicators as ind


@dataclass
class HypothesisMeta:
    id: str
    name: str
    description: str
    data_requirements: str = "OHLCV"


class Hypothesis(ABC):
    meta: HypothesisMeta
    tp_pct: float = 0.40
    sl_pct: float = 0.20
    max_hold_bars: int = 8

    @abstractmethod
    def entry_signal(self, df: pd.DataFrame, idx: int) -> str | None:
        """Return 'long', 'short', or None."""

    def precompute(self, df: pd.DataFrame) -> pd.DataFrame:
        w = df.copy()
        w["ema9"] = ind.ema(w["close"], 9)
        w["ema21"] = ind.ema(w["close"], 21)
        w["rsi"] = ind.rsi(w["close"], 14)
        w["atr"] = ind.atr(w["high"], w["low"], w["close"], 14)
        upper, _, lower = ind.bollinger(w["close"])
        w["bb_upper"] = upper
        w["bb_lower"] = lower
        w["vol_ma20"] = w["volume"].rolling(20).mean()
        return w

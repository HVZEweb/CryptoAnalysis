"""Historical market simulator — bootstrap scenarios from OKX futures OHLCV."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

from exchange.okx_rest import OKXRestClient, to_swap_symbol

log = logging.getLogger("backtest.simulator")

DEFAULT_SYMBOLS = [
    "BTC/USDT:USDT",
    "ETH/USDT:USDT",
    "SOL/USDT:USDT",
    "XRP/USDT:USDT",
    "DOGE/USDT:USDT",
]


@dataclass(frozen=True)
class MarketScenario:
    scenario_id: int
    symbol: str
    df: pd.DataFrame
    spread_pct: float
    slippage_mult: float
    scenario_type: str


async def fetch_history(
    symbols: list[str] | None = None,
    timeframe: str = "5m",
    target_bars: int = 2000,
) -> dict[str, pd.DataFrame]:
    symbols = [to_swap_symbol(s) for s in (symbols or DEFAULT_SYMBOLS)]
    rest = OKXRestClient()
    await rest.connect()
    pools: dict[str, pd.DataFrame] = {}

    try:
        for symbol in symbols:
            ohlcv = await rest.fetch_ohlcv(symbol, timeframe, limit=min(target_bars, 1000))
            if not ohlcv:
                continue
            df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
            df = df.drop_duplicates(subset=["ts"]).sort_values("ts").reset_index(drop=True)
            pools[symbol] = df
            log.info("Fetched %d bars for %s", len(pools[symbol]), symbol)
    finally:
        await rest.close()

    return pools


def generate_scenarios(
    pools: dict[str, pd.DataFrame],
    n_scenarios: int = 100,
    window_bars: int = 500,
    rng_seed: int = 42,
) -> list[MarketScenario]:
    rng = np.random.default_rng(rng_seed)
    scenarios: list[MarketScenario] = []
    symbols = list(pools.keys())
    if not symbols:
        return scenarios

    for i in range(n_scenarios):
        sym = symbols[i % len(symbols)]
        df = pools[sym]
        if len(df) < window_bars + 50:
            continue

        if i % 3 == 0:
            start = int(rng.integers(50, max(51, len(df) - window_bars)))
            window = df.iloc[start : start + window_bars].copy().reset_index(drop=True)
            stype = "window"
        else:
            idx = rng.integers(0, len(df), size=window_bars)
            idx.sort()
            window = df.iloc[idx].copy().reset_index(drop=True)
            stype = "bootstrap"

        spread = float(rng.uniform(0.02, 0.12))
        slip_mult = float(rng.uniform(0.8, 1.5))
        scenarios.append(MarketScenario(i, sym, window, spread, slip_mult, stype))

    return scenarios

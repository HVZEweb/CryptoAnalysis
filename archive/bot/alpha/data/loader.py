"""Load alpha research datasets."""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from alpha.data.okx_alpha import DATA_ROOT, load_dataset
from exchange.okx_rest import to_swap_symbol
from research.data_loader import load_local_dataset

log = logging.getLogger("alpha.loader")


def _safe_name(symbol: str) -> str:
    return to_swap_symbol(symbol).replace("/", "_").replace(":", "_")


def load_ohlcv(symbol: str, timeframe: str = "5m", bars: int = 0) -> pd.DataFrame | None:
    df = load_local_dataset(symbol, timeframe)
    if df is None or len(df) < 100:
        return None
    if bars > 0:
        return df.iloc[-bars:].reset_index(drop=True)
    return df.reset_index(drop=True)


def load_funding(symbol: str) -> pd.DataFrame | None:
    return load_dataset(f"{_safe_name(symbol)}_funding")


def load_open_interest(symbol: str, period: str = "5m") -> pd.DataFrame | None:
    return load_dataset(f"{_safe_name(symbol)}_oi_{period}")


def load_liquidations(symbol: str) -> pd.DataFrame | None:
    return load_dataset(f"{_safe_name(symbol)}_liquidations")


def load_orderbook_snapshots(symbol: str) -> pd.DataFrame | None:
    return load_dataset(f"{_safe_name(symbol)}_orderbook")


def load_trades_tape(symbol: str) -> pd.DataFrame | None:
    return load_dataset(f"{_safe_name(symbol)}_trades")


def build_context(
    symbol: str,
    *,
    timeframe: str = "5m",
    bars: int = 0,
    cross_symbols: list[str] | None = None,
) -> dict:
    swap = to_swap_symbol(symbol)
    ctx = {
        "symbol": swap,
        "timeframe": timeframe,
        "ohlcv": load_ohlcv(symbol, timeframe, bars),
        "funding": load_funding(symbol),
        "open_interest": load_open_interest(symbol, "5m"),
        "liquidations": load_liquidations(symbol),
        "orderbook_snapshots": load_orderbook_snapshots(symbol),
        "trades_tape": load_trades_tape(symbol),
        "cross_assets": {},
    }
    for cs in cross_symbols or []:
        cdf = load_ohlcv(cs, timeframe, bars)
        if cdf is not None:
            ctx["cross_assets"][to_swap_symbol(cs)] = cdf
    return ctx


def data_inventory() -> dict[str, list[str]]:
    if not DATA_ROOT.exists():
        return {}
    files = sorted(DATA_ROOT.glob("*.csv"))
    inv: dict[str, list[str]] = {}
    for f in files:
        inv.setdefault(f.stem.rsplit("_", 1)[0], []).append(f.name)
    return inv

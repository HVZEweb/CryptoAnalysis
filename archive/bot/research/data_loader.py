"""Data loading with optional offline/synthetic fallback."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from backtest.market_simulator import fetch_history

from exchange.okx_rest import to_swap_symbol

log = logging.getLogger("research.data_loader")

CACHE_DIR = Path(__file__).resolve().parent / "cache"
DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "ohlcv"


def _dataset_path(symbol: str, timeframe: str, base_dir: Path) -> tuple[Path, Path]:
    safe = to_swap_symbol(symbol).replace("/", "_").replace(":", "_")
    stem = base_dir / f"{safe}_{timeframe}"
    return stem.with_suffix(".parquet"), stem.with_suffix(".csv")


def load_local_dataset(symbol: str, timeframe: str) -> pd.DataFrame | None:
    for base in (DATA_DIR, CACHE_DIR):
        parquet_path, csv_path = _dataset_path(symbol, timeframe, base)
        if parquet_path.exists():
            try:
                return pd.read_parquet(parquet_path)
            except Exception:
                pass
        if csv_path.exists():
            try:
                return pd.read_csv(csv_path)
            except Exception:
                pass
    return None


def load_local_pools(symbols: list[str], timeframe: str = "5m") -> dict[str, pd.DataFrame]:
    pools: dict[str, pd.DataFrame] = {}
    for symbol in symbols:
        df = load_local_dataset(symbol, timeframe)
        if df is not None and len(df) >= 200:
            pools[to_swap_symbol(symbol)] = df.reset_index(drop=True)
    return pools


def generate_synthetic_ohlcv(
    symbol: str,
    bars: int = 2000,
    *,
    seed: int = 42,
    bar_minutes: int = 5,
) -> pd.DataFrame:
    """Synthetic OHLCV with alternating trend/flat/high-vol phases."""
    rng = np.random.default_rng(seed)
    ts0 = 1_700_000_000_000
    step_ms = bar_minutes * 60 * 1000

    price = 3000.0
    rows = []
    phase = 0
    phase_len = 0

    for i in range(bars):
        if phase_len <= 0:
            phase = rng.integers(0, 3)
            phase_len = int(rng.integers(80, 250))

        if phase == 0:
            drift = 0.0003
            vol = 0.004
        elif phase == 1:
            drift = 0.0
            vol = 0.002
        else:
            drift = rng.choice([-0.0002, 0.0002])
            vol = 0.008

        ret = drift + rng.normal(0, vol)
        open_p = price
        close_p = price * (1 + ret)
        high_p = max(open_p, close_p) * (1 + abs(rng.normal(0, vol * 0.5)))
        low_p = min(open_p, close_p) * (1 - abs(rng.normal(0, vol * 0.5)))
        volume = float(rng.uniform(100, 5000))
        rows.append([ts0 + i * step_ms, open_p, high_p, low_p, close_p, volume])
        price = close_p
        phase_len -= 1

    return pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])


def _cache_path(symbol: str, timeframe: str) -> Path:
    safe = to_swap_symbol(symbol).replace("/", "_").replace(":", "_")
    return CACHE_DIR / f"{safe}_{timeframe}.parquet"


def save_cache(symbol: str, timeframe: str, df: pd.DataFrame) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(symbol, timeframe)
    try:
        df.to_parquet(path, index=False)
    except Exception:
        df.to_csv(path.with_suffix(".csv"), index=False)


def load_cache(symbol: str, timeframe: str) -> pd.DataFrame | None:
    path = _cache_path(symbol, timeframe)
    csv_path = path.with_suffix(".csv")
    if path.exists():
        try:
            return pd.read_parquet(path)
        except Exception:
            pass
    if csv_path.exists():
        return pd.read_csv(csv_path)
    return None


async def load_research_data(
    symbols: list[str],
    timeframe: str,
    target_bars: int,
    *,
    offline: bool = False,
    use_cache: bool = True,
) -> dict[str, pd.DataFrame]:
    pools: dict[str, pd.DataFrame] = {}

    for symbol in symbols:
        local = load_local_dataset(symbol, timeframe) if use_cache else None
        if local is not None and len(local) >= 200:
            log.info("Using local dataset %s %s (%d bars)", symbol, timeframe, len(local))
            if target_bars <= 0:
                pools[to_swap_symbol(symbol)] = local.reset_index(drop=True)
            else:
                pools[to_swap_symbol(symbol)] = local.iloc[-target_bars:].reset_index(drop=True)

    missing = [s for s in symbols if to_swap_symbol(s) not in pools]
    if not missing:
        return pools

    if not offline:
        try:
            fetched = await fetch_history(symbols=missing, timeframe=timeframe, target_bars=target_bars)
            for sym, df in fetched.items():
                pools[sym] = df
                if use_cache and len(df) > 100:
                    save_cache(sym, timeframe, df)
            if all(to_swap_symbol(s) in pools for s in symbols):
                return pools
        except Exception as e:
            log.warning("Live fetch failed (%s), trying cache/synthetic", e)

    for i, symbol in enumerate(symbols):
        swap = to_swap_symbol(symbol)
        if swap in pools:
            continue
        cached = load_local_dataset(symbol, timeframe) if use_cache else None
        if cached is not None and len(cached) >= 200:
            log.info("Using cache for %s (%d bars)", symbol, len(cached))
            if target_bars <= 0:
                pools[swap] = cached.reset_index(drop=True)
            else:
                pools[swap] = cached.iloc[-target_bars:].reset_index(drop=True)
        else:
            log.info("Using synthetic data for %s", symbol)
            bar_minutes = {"1m": 1, "3m": 3, "5m": 5}.get(timeframe, 5)
            pools[swap] = generate_synthetic_ohlcv(symbol, target_bars, seed=42 + i, bar_minutes=bar_minutes)

    return pools

"""OKX public history candles — sync requests, no ccxt/aiohttp (Windows DNS safe)."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
import requests

from core.config import get_settings
from exchange.okx_rest import TIMEFRAME_MS, to_swap_symbol

log = logging.getLogger("research.okx_history")

BAR_MAP = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1H",
    "4h": "4H",
    "1d": "1D",
}


def to_okx_inst_id(symbol: str) -> str:
    raw = symbol.upper().strip()
    if raw.endswith("-SWAP"):
        return raw
    swap = to_swap_symbol(symbol)
    base = swap.split("/")[0]
    return f"{base}-USDT-SWAP"


def _rest_base() -> str:
    base = get_settings().okx_rest_base.rstrip("/")
    return base or "https://www.okx.com"


def fetch_history_candles(
    symbol: str,
    timeframe: str,
    *,
    months: int = 12,
    batch_size: int = 300,
    pause_sec: float = 0.12,
) -> pd.DataFrame:
    """
    Download OHLCV via GET /api/v5/market/history-candles (public, no API key).
    Paginates with `after` = oldest ts in batch.
    """
    inst_id = to_okx_inst_id(symbol)
    bar = BAR_MAP.get(timeframe)
    if not bar:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    tf_ms = TIMEFRAME_MS.get(timeframe, 300_000)
    months = max(1, min(months, 24))
    since_ms = int((datetime.now(timezone.utc) - timedelta(days=months * 30)).timestamp() * 1000)
    base_url = _rest_base()

    all_rows: list[list[Any]] = []
    seen: set[int] = set()
    after: str | None = None
    empty_streak = 0

    while empty_streak < 3:
        params: dict[str, str] = {"instId": inst_id, "bar": bar, "limit": str(batch_size)}
        if after:
            params["after"] = after

        try:
            resp = requests.get(
                f"{base_url}/api/v5/market/history-candles",
                params=params,
                timeout=45,
            )
            resp.raise_for_status()
            payload = resp.json()
        except requests.RequestException as e:
            log.warning("Request failed %s %s: %s", inst_id, bar, e)
            empty_streak += 1
            time.sleep(1.0)
            continue

        if payload.get("code") != "0":
            raise RuntimeError(f"OKX API error: {payload.get('msg', payload)}")

        batch = payload.get("data") or []
        if not batch:
            empty_streak += 1
            time.sleep(0.5)
            continue

        empty_streak = 0
        new_count = 0
        for row in batch:
            ts = int(row[0])
            if ts in seen:
                continue
            seen.add(ts)
            all_rows.append(row)
            new_count += 1

        oldest = int(batch[-1][0])
        if oldest <= since_ms or new_count == 0:
            break

        after = str(oldest)
        if pause_sec > 0:
            time.sleep(pause_sec)

    if not all_rows:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"])

    # OKX: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    df = pd.DataFrame(all_rows, columns=["ts", "open", "high", "low", "close", "vol", "volCcy", "volCcyQuote", "confirm"])
    for col in ("ts", "open", "high", "low", "close", "vol"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.rename(columns={"vol": "volume"})
    df = df[["ts", "open", "high", "low", "close", "volume"]]
    df = df[df["ts"] >= since_ms]
    df = df.drop_duplicates(subset=["ts"]).sort_values("ts").reset_index(drop=True)
    df["datetime_utc"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df

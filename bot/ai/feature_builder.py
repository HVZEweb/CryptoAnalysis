"""Feature builder for AI predictor."""

from __future__ import annotations

from typing import Any

import pandas as pd

from exchange.okx_rest import OKXRestClient, to_swap_symbol
from market import indicators as ind
from market.orderbook import BookSnapshot, parse_levels
from market.volatility import atr_pct, realized_volatility
from market.volume import volume_delta_proxy, volume_spike


class FeatureBuilder:
    async def build(self, symbol: str, rest: OKXRestClient) -> dict[str, Any]:
        swap = to_swap_symbol(symbol)
        ticker = await rest.fetch_ticker(swap)
        book_raw = await rest.fetch_order_book(swap, 50)
        book = BookSnapshot(
            symbol=swap,
            bids=parse_levels(book_raw.bids),
            asks=parse_levels(book_raw.asks),
        )
        ohlcv = await rest.fetch_ohlcv(swap, "5m", 80)
        df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
        for col in ("close", "high", "low", "volume", "open"):
            df[col] = df[col].astype(float)

        df["rsi"] = ind.rsi(df["close"])
        df["ema9"] = ind.ema(df["close"], 9)
        df["ema21"] = ind.ema(df["close"], 21)
        df["adx"] = ind.adx(df["high"], df["low"], df["close"])

        last = df.iloc[-1]
        funding = ticker.funding_rate
        oi = await rest.fetch_open_interest(swap)

        return {
            "symbol": swap,
            "price": ticker.last,
            "rsi": float(last["rsi"]) if pd.notna(last["rsi"]) else 50.0,
            "adx": float(last["adx"]) if pd.notna(last["adx"]) else 20.0,
            "atr_pct": atr_pct(df["high"], df["low"], df["close"]),
            "realized_vol": realized_volatility(df["close"]),
            "funding_rate": funding,
            "open_interest": oi or 0.0,
            "spread_pct": book.spread_pct,
            "imbalance": book.imbalance(),
            "microprice": book.microprice,
            "volume_spike": volume_spike(df["volume"]),
            "volume_delta": volume_delta_proxy(df["close"], df["volume"]),
            "momentum": float((df["close"].iloc[-1] - df["close"].iloc[-5]) / df["close"].iloc[-5] * 100)
            if len(df) >= 5
            else 0.0,
            "ema_trend": "bull" if float(last["ema9"]) > float(last["ema21"]) else "bear",
        }

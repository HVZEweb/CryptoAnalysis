"""Market context captured at trade entry/exit."""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from exchange.okx_rest import OKXRestClient, to_swap_symbol
from market.volatility import atr_pct

log = logging.getLogger("trading_bot.trade_context")


async def build_market_context(
    symbol: str,
    rest: OKXRestClient,
    *,
    book_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    swap = to_swap_symbol(symbol)
    ctx: dict[str, Any] = {"symbol": swap}

    try:
        ticker = await rest.fetch_ticker(swap)
        ctx.update(
            {
                "last": ticker.last,
                "mark_price": ticker.mark_price,
                "spread_pct": ticker.spread_pct,
                "funding_rate": ticker.funding_rate,
                "open_interest": ticker.open_interest,
                "volume_24h": ticker.volume_24h,
            }
        )
    except Exception as e:
        log.debug("ticker context %s: %s", swap, e)

    try:
        ohlcv = await rest.fetch_ohlcv(swap, "5m", 40)
        if len(ohlcv) >= 20:
            df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
            for col in ("close", "high", "low"):
                df[col] = df[col].astype(float)
            ctx["volatility_pct"] = atr_pct(df["high"], df["low"], df["close"])
            ctx["momentum_pct"] = float((df["close"].iloc[-1] - df["close"].iloc[-5]) / df["close"].iloc[-5] * 100)
    except Exception as e:
        log.debug("ohlcv context %s: %s", swap, e)

    if book_snapshot:
        ctx["book_snapshot"] = book_snapshot

    return ctx


def estimate_slippage_pct(expected: float, actual: float) -> float:
    if expected <= 0:
        return 0.0
    return abs(actual - expected) / expected * 100

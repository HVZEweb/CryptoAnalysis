"""Async retry with exponential backoff."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TypeVar

import ccxt

log = logging.getLogger("trading_bot.retry")

T = TypeVar("T")

RETRYABLE = (
    ccxt.NetworkError,
    ccxt.RequestTimeout,
    ccxt.ExchangeNotAvailable,
    ccxt.RateLimitExceeded,
    ConnectionError,
    TimeoutError,
    OSError,
)


def is_rate_limit_error(exc: BaseException) -> bool:
    if isinstance(exc, ccxt.RateLimitExceeded):
        return True
    msg = str(exc).lower()
    return "rate limit" in msg or "too many requests" in msg or "429" in msg


async def with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    max_attempts: int = 3,
    base_delay: float = 0.5,
    max_delay: float = 8.0,
    label: str = "operation",
) -> T:
    last_exc: BaseException | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return await fn()
        except RETRYABLE as e:
            last_exc = e
            if attempt >= max_attempts:
                break
            delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
            if is_rate_limit_error(e):
                delay = max(delay, 2.0)
            log.warning("%s failed (attempt %d/%d): %s — retry in %.1fs", label, attempt, max_attempts, e, delay)
            await asyncio.sleep(delay)
    assert last_exc is not None
    raise last_exc

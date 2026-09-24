"""Rate limit tracking and throttling."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger("trading_bot.rate_limit")


@dataclass
class RateLimitState:
    hits: int = 0
    last_hit_ms: int = 0
    cooldown_until_ms: int = 0
    total_calls: int = 0


class RateLimitGuard:
    def __init__(self, min_interval_ms: float = 50.0) -> None:
        self.min_interval_ms = min_interval_ms
        self.state = RateLimitState()
        self._last_call_ms = 0
        self._lock = asyncio.Lock()

    @property
    def in_cooldown(self) -> bool:
        return int(time.time() * 1000) < self.state.cooldown_until_ms

    def record_hit(self, cooldown_sec: float = 2.0) -> None:
        now = int(time.time() * 1000)
        self.state.hits += 1
        self.state.last_hit_ms = now
        self.state.cooldown_until_ms = now + int(cooldown_sec * 1000)
        log.warning("Rate limit hit #%d — cooldown %.1fs", self.state.hits, cooldown_sec)

    async def throttle(self) -> None:
        async with self._lock:
            now_ms = int(time.time() * 1000)
            if self.in_cooldown:
                wait_ms = self.state.cooldown_until_ms - now_ms
                if wait_ms > 0:
                    await asyncio.sleep(wait_ms / 1000)
            elapsed = now_ms - self._last_call_ms
            if elapsed < self.min_interval_ms:
                await asyncio.sleep((self.min_interval_ms - elapsed) / 1000)
            self._last_call_ms = int(time.time() * 1000)
            self.state.total_calls += 1

    def snapshot(self) -> dict[str, int | bool]:
        return {
            "hits": self.state.hits,
            "in_cooldown": self.in_cooldown,
            "total_calls": self.state.total_calls,
            "last_hit_ms": self.state.last_hit_ms,
        }

"""Async task scheduler for bot loops."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

log = logging.getLogger("trading_bot.scheduler")


class Scheduler:
    def __init__(self) -> None:
        self._tasks: list[asyncio.Task[Any]] = []
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    def add_interval(
        self,
        name: str,
        interval_sec: float,
        coro_factory: Callable[[], Awaitable[None]],
    ) -> None:
        async def _loop() -> None:
            while self._running:
                try:
                    await coro_factory()
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    log.exception("Task %s error: %s", name, e)
                await asyncio.sleep(interval_sec)

        self._tasks.append(asyncio.create_task(_loop(), name=name))

    async def start(self) -> None:
        self._running = True

    async def stop(self) -> None:
        self._running = False
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

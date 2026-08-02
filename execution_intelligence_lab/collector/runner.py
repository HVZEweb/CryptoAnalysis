"""Collector orchestration — L2, trades, ticker, funding, OI."""

from __future__ import annotations

import asyncio
import logging

from collector.funding import poll_funding
from collector.okx_ws import OKXWebSocket, build_subscriptions
from collector.open_interest import poll_open_interest
from collector.orderbook import OrderBookRecorder
from collector.storage import ParquetStore
from collector.ticker import TickerRecorder
from collector.trades import TradesRecorder
from config import Config

log = logging.getLogger("eil.collector")


async def run_collector(config: Config, *, duration_sec: int | None = None) -> None:
    store = ParquetStore(config.data_dir)
    ob = OrderBookRecorder(store, levels=config.book_depth)
    tr = TradesRecorder(store)
    tk = TickerRecorder(store)

    async def dispatch(msg: dict) -> None:
        await ob.on_message(msg)
        await tr.on_message(msg)
        await tk.on_message(msg)

    subs = build_subscriptions(config.symbols, book_channel=config.book_channel)
    ws = OKXWebSocket(
        config.ws_public_url,
        subscriptions=subs,
        on_message=dispatch,
        reconnect_delay=config.reconnect_delay_sec,
    )

    flush_task = asyncio.create_task(_flush_loop(store, config))
    meta_task = asyncio.create_task(_meta_loop(store, config))

    log.info("EIL collector started | symbols=%s", config.symbols)
    try:
        if duration_sec:
            await asyncio.wait_for(ws.run(), timeout=duration_sec)
            ws.stop()
        else:
            await ws.run()
    except asyncio.TimeoutError:
        ws.stop()
    finally:
        flush_task.cancel()
        meta_task.cancel()
        for task in (flush_task, meta_task):
            try:
                await task
            except asyncio.CancelledError:
                pass
        flushed = store.flush_all()
        log.info("Final flush: %d rows", flushed)


async def _flush_loop(store: ParquetStore, config: Config) -> None:
    while True:
        await asyncio.sleep(config.flush_interval_sec)
        n = store.flush_all()
        if n:
            log.info("Flush: %d rows", n)


async def _meta_loop(store: ParquetStore, config: Config) -> None:
    funding_elapsed = config.funding_poll_sec
    oi_elapsed = config.oi_poll_sec
    while True:
        await asyncio.sleep(10)
        funding_elapsed += 10
        oi_elapsed += 10
        if funding_elapsed >= config.funding_poll_sec:
            funding_elapsed = 0
            await poll_funding(store, config)
        if oi_elapsed >= config.oi_poll_sec:
            oi_elapsed = 0
            await poll_open_interest(store, config)

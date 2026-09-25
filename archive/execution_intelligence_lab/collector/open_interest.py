"""Open interest REST poller."""

from __future__ import annotations

import logging

import aiohttp

from collector.storage import ParquetStore
from config import Config

log = logging.getLogger("eil.oi")


async def poll_open_interest(store: ParquetStore, config: Config) -> int:
    url = f"{config.rest_base}/api/v5/public/open-interest"
    n = 0
    async with aiohttp.ClientSession() as session:
        for sym in config.symbols:
            try:
                async with session.get(url, params={"instId": sym}) as resp:
                    data = await resp.json()
                for row in data.get("data") or []:
                    store.buffer(
                        "open_interest",
                        {
                            "ts": int(row.get("ts") or 0),
                            "inst_id": sym,
                            "oi": float(row.get("oi") or 0),
                            "oi_ccy": float(row.get("oiCcy") or 0),
                        },
                    )
                    n += 1
            except Exception as e:
                log.warning("OI %s: %s", sym, e)
    return n

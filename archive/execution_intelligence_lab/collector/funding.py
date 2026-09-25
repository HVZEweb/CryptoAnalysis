"""Funding rate REST poller."""

from __future__ import annotations

import logging

import aiohttp

from collector.storage import ParquetStore
from config import Config

log = logging.getLogger("eil.funding")


async def poll_funding(store: ParquetStore, config: Config) -> int:
    url = f"{config.rest_base}/api/v5/public/funding-rate"
    n = 0
    async with aiohttp.ClientSession() as session:
        for sym in config.symbols:
            try:
                async with session.get(url, params={"instId": sym}) as resp:
                    data = await resp.json()
                for row in data.get("data") or []:
                    store.buffer(
                        "funding",
                        {
                            "ts": int(row.get("ts") or 0),
                            "inst_id": sym,
                            "funding_rate": float(row.get("fundingRate") or 0),
                            "next_funding_rate": float(row.get("nextFundingRate") or 0),
                        },
                    )
                    n += 1
            except Exception as e:
                log.warning("Funding %s: %s", sym, e)
    return n

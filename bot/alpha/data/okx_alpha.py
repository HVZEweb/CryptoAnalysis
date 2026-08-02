"""OKX alpha data downloaders — funding, OI, liquidations, trades, ticker (sync requests)."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from alpha.data.archive import DATA_ROOT, append_dataset, last_timestamp, load_archive
from core.config import get_settings
from research.okx_history import to_okx_inst_id

log = logging.getLogger("alpha.okx_data")


def _rest_base() -> str:
    return get_settings().okx_rest_base.rstrip("/") or "https://www.okx.com"


def _get(path: str, params: dict[str, Any], *, pause: float = 0.15) -> list[dict]:
    url = f"{_rest_base()}{path}"
    try:
        resp = requests.get(url, params=params, timeout=45)
        resp.raise_for_status()
        payload = resp.json()
    except requests.RequestException as e:
        log.warning("OKX request failed %s: %s", path, e)
        return []
    if payload.get("code") != "0":
        log.warning("OKX API %s: %s", path, payload.get("msg"))
        return []
    time.sleep(pause)
    return payload.get("data") or []


def fetch_funding_history(symbol: str, *, months: int = 12) -> pd.DataFrame:
    """GET /api/v5/public/funding-rate-history — paginate backwards with `before`."""
    inst_id = to_okx_inst_id(symbol)
    since_ms = int((datetime.now(timezone.utc) - timedelta(days=months * 30)).timestamp() * 1000)
    rows: list[dict] = []
    seen_ts: set[int] = set()
    before: str | None = None
    max_pages = max(10, months * 15)

    for _ in range(max_pages):
        params: dict[str, Any] = {"instId": inst_id, "limit": "100"}
        if before:
            params["before"] = before
        batch = _get("/api/v5/public/funding-rate-history", params)
        if not batch:
            break

        oldest: int | None = None
        added = 0
        for row in batch:
            ts = int(row["fundingTime"])
            oldest = ts if oldest is None else min(oldest, ts)
            if ts in seen_ts or ts < since_ms:
                continue
            seen_ts.add(ts)
            rows.append(
                {
                    "ts": ts,
                    "funding_rate": float(row.get("fundingRate", 0)),
                    "realized_rate": float(row.get("realizedRate", 0)),
                }
            )
            added += 1

        if oldest is None or oldest <= since_ms or added == 0 or len(batch) < 100:
            break
        before = str(oldest - 1)

    if not rows:
        return pd.DataFrame(columns=["ts", "funding_rate", "realized_rate"])
    df = pd.DataFrame(rows).drop_duplicates("ts").sort_values("ts").reset_index(drop=True)
    df["datetime_utc"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df


def fetch_oi_history(symbol: str, *, period: str = "5m", months: int = 12) -> pd.DataFrame:
    """GET /api/v5/rubik/stat/contracts/open-interest-volume — OI + volume by currency."""
    swap = symbol.upper()
    base = swap.split("/")[0] if "/" in swap else swap.replace("-USDT-SWAP", "").split("-")[0]
    ccy = base
    since_ms = int((datetime.now(timezone.utc) - timedelta(days=months * 30)).timestamp() * 1000)
    end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    period_map = {"5m": "5m", "1h": "1H", "1d": "1D"}
    p = period_map.get(period, "5m")

    rows: list[dict] = []
    begin = since_ms
    empty = 0
    while begin < end_ms and empty < 5:
        params = {"ccy": ccy, "period": p, "begin": str(begin), "end": str(end_ms)}
        batch = _get("/api/v5/rubik/stat/contracts/open-interest-volume", params, pause=0.2)
        if not batch:
            empty += 1
            begin += 7 * 24 * 3600 * 1000
            continue
        empty = 0
        max_ts = begin
        for row in batch:
            # [ts, oi, vol]
            parts = row if isinstance(row, list) else row.get("data", row)
            if isinstance(parts, list) and len(parts) >= 2:
                ts = int(parts[0])
                oi = float(parts[1])
                vol = float(parts[2]) if len(parts) > 2 else 0.0
                rows.append({"ts": ts, "open_interest": oi, "oi_volume": vol})
                max_ts = max(max_ts, ts)
        begin = max_ts + 1
        if max_ts <= since_ms:
            break

    if not rows:
        return pd.DataFrame(columns=["ts", "open_interest", "oi_volume"])
    df = pd.DataFrame(rows).drop_duplicates("ts").sort_values("ts").reset_index(drop=True)
    df["datetime_utc"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df


def fetch_liquidation_orders(symbol: str, *, max_pages: int = 50) -> pd.DataFrame:
    """GET /api/v5/public/liquidation-orders — recent liquidation snapshots."""
    inst_id = to_okx_inst_id(symbol)
    rows: list[dict] = []
    after: str | None = None

    for _ in range(max_pages):
        params: dict[str, Any] = {
            "instType": "SWAP",
            "instId": inst_id,
            "state": "filled",
            "limit": "100",
        }
        if after:
            params["after"] = after
        batch = _get("/api/v5/public/liquidation-orders", params, pause=0.2)
        if not batch:
            break
        for item in batch:
            details = item.get("details") or []
            ts = int(item.get("ts", 0))
            for d in details:
                rows.append(
                    {
                        "ts": ts,
                        "side": d.get("side", ""),
                        "sz": float(d.get("sz", 0)),
                        "bk_px": float(d.get("bkPx", 0)),
                        "pos_side": d.get("posSide", ""),
                    }
                )
        if len(batch) < 1:
            break
        after = str(batch[-1].get("ts", ""))
        if not after or after == "0":
            break

    if not rows:
        return pd.DataFrame(columns=["ts", "side", "sz", "bk_px", "pos_side"])
    df = pd.DataFrame(rows).drop_duplicates(subset=["ts", "side", "sz"]).sort_values("ts").reset_index(drop=True)
    df["datetime_utc"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df


def fetch_trades_history(symbol: str, *, limit: int = 100) -> pd.DataFrame:
    """GET /api/v5/market/history-trades — recent trades tape."""
    inst_id = to_okx_inst_id(symbol)
    batch = _get("/api/v5/market/history-trades", {"instId": inst_id, "limit": str(limit)})
    rows: list[dict] = []
    for row in batch:
        rows.append(
            {
                "tradeId": row.get("tradeId", ""),
                "ts": int(row.get("ts", 0)),
                "px": float(row.get("px", 0)),
                "sz": float(row.get("sz", 0)),
                "side": row.get("side", ""),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["tradeId", "ts", "px", "sz", "side"])
    df = pd.DataFrame(rows).drop_duplicates("tradeId").sort_values("ts").reset_index(drop=True)
    df["datetime_utc"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df


def fetch_ticker_bbo(symbol: str) -> pd.DataFrame:
    """GET /api/v5/market/ticker — best bid/ask, spread snapshot."""
    inst_id = to_okx_inst_id(symbol)
    batch = _get("/api/v5/market/ticker", {"instId": inst_id})
    if not batch:
        return pd.DataFrame(columns=["ts", "bid", "ask", "spread", "spread_pct", "last"])
    row = batch[0]
    bid = float(row.get("bidPx", 0))
    ask = float(row.get("askPx", 0))
    mid = (bid + ask) / 2 if bid and ask else 0.0
    spread = ask - bid if bid and ask else 0.0
    spread_pct = (spread / mid * 100) if mid > 0 else 0.0
    ts = int(row.get("ts", time.time() * 1000))
    df = pd.DataFrame(
        [
            {
                "ts": ts,
                "bid": bid,
                "ask": ask,
                "spread": spread,
                "spread_pct": spread_pct,
                "last": float(row.get("last", 0)),
            }
        ]
    )
    df["datetime_utc"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df


def _parse_book_side(raw: list) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for row in raw or []:
        if isinstance(row, (list, tuple)) and len(row) >= 2:
            out.append((float(row[0]), float(row[1])))
    return out


def fetch_orderbook_snapshot(symbol: str, *, depth: int = 20) -> dict[str, Any] | None:
    """GET /api/v5/market/books — public L2 snapshot, no exchange connection required."""
    inst_id = to_okx_inst_id(symbol)
    batch = _get("/api/v5/market/books", {"instId": inst_id, "sz": str(depth)})
    if not batch:
        return None
    item = batch[0]
    bids = _parse_book_side(item.get("bids"))
    asks = _parse_book_side(item.get("asks"))
    if not bids or not asks:
        return None
    ts = int(item.get("ts") or time.time() * 1000)
    return {"ts": ts, "bids": bids, "asks": asks}


def format_orderbook_archive_row(snap: dict[str, Any], *, levels: int = 10) -> dict[str, Any]:
    """Build one append-only orderbook archive row from a public snapshot."""
    import json as _json

    bids = snap["bids"][:levels]
    asks = snap["asks"][:levels]
    bid_usd = sum(p * s for p, s in bids)
    ask_usd = sum(p * s for p, s in asks)
    imb = (bid_usd - ask_usd) / (bid_usd + ask_usd) if (bid_usd + ask_usd) > 0 else 0.0
    best_bid = bids[0][0]
    best_ask = asks[0][0]
    mid = (best_bid + best_ask) / 2
    spread_pct = ((best_ask - best_bid) / mid * 100) if mid > 0 else 0.0
    microprice = (
        (asks[0][0] * bids[0][1] + bids[0][0] * asks[0][1]) / (bids[0][1] + asks[0][1])
        if (bids[0][1] + asks[0][1]) > 0
        else mid
    )
    return {
        "ts": int(snap.get("ts") or time.time() * 1000),
        "best_bid": best_bid,
        "best_ask": best_ask,
        "mid": mid,
        "spread_pct": spread_pct,
        "bid_usd": bid_usd,
        "ask_usd": ask_usd,
        "imbalance": imb,
        "microprice": microprice,
        "bids_json": _json.dumps(bids),
        "asks_json": _json.dumps(asks),
    }


def save_dataset(df: pd.DataFrame, name: str) -> Path:
    return append_dataset(name, df)


def load_dataset(name: str) -> pd.DataFrame | None:
    return load_archive(name)

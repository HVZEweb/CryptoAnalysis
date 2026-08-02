"""Hourly microstructure statistics — append-only statistics store."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from collector.storage import ParquetStore
from features.absorption import detect_absorption
from research.causal import past_price_change_bps
from features.imbalance import imbalance
from features.liquidity_vacuum import detect_liquidity_vacuum
from features.replenishment import detect_replenishment

log = logging.getLogger("msb.hourly_stats")


def _hour_ts(ts_ms: int) -> int:
    dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
    return int(dt.timestamp() * 1000)


def enrich_orderbook(ob: pd.DataFrame) -> pd.DataFrame:
    df = ob.copy()
    if "mid" not in df.columns:
        df["mid"] = (df["best_bid"] + df["best_ask"]) / 2
    for lvl in (5, 10, 25):
        b, a = f"bid_vol_{lvl}", f"ask_vol_{lvl}"
        if b in df.columns and a in df.columns:
            df[f"imb_{lvl}"] = df.apply(lambda r: imbalance(r[b], r[a]), axis=1)
    if "bid_vol_25" in df.columns:
        df["total_depth"] = df["bid_vol_25"] + df["ask_vol_25"]
        df["depth_chg_pct"] = df["total_depth"].pct_change() * 100
    if "spread_bps" not in df.columns and "best_bid" in df.columns:
        df["spread_bps"] = (df["best_ask"] - df["best_bid"]) / df["mid"].replace(0, np.nan) * 10000
    df["hour_ts"] = df["ts"].apply(_hour_ts)
    return df


def _count_sweeps(trades: pd.DataFrame, *, size_q: float = 0.9) -> int:
    if trades.empty:
        return 0
    thr = trades["size"].quantile(size_q)
    return int((trades["size"] >= thr).sum())


def _count_absorption(ob_hour: pd.DataFrame, trades_hour: pd.DataFrame) -> int:
    if ob_hour.empty or trades_hour.empty:
        return 0
    count = 0
    ob = ob_hour.sort_values("ts")
    for _, row in ob.iloc[:: max(1, len(ob) // 50)].iterrows():
        ts = int(row["ts"])
        w = trades_hour[(trades_hour["ts"] >= ts - 2000) & (trades_hour["ts"] <= ts)]
        if w.empty:
            continue
        mid = row.get("mid", 0)
        if not mid:
            continue
        ch = past_price_change_bps(ob, ts, lookback_ms=1000)
        if detect_absorption(float(w["size"].sum()), ch):
            count += 1
    return count


def _count_iceberg_like(trades: pd.DataFrame) -> int:
    if trades.empty:
        return 0
    g = trades.groupby(trades["price"].round(6))
    return int(sum(1 for _, grp in g if len(grp) >= 3))


def compute_hourly_row(
    hour_ts: int,
    inst_id: str,
    ob_hour: pd.DataFrame,
    trades_hour: pd.DataFrame,
) -> dict:
    row: dict = {
        "ts": hour_ts,
        "inst_id": inst_id,
        "hour_utc": datetime.fromtimestamp(hour_ts / 1000, tz=timezone.utc).isoformat(),
        "ob_samples": len(ob_hour),
        "trade_count": len(trades_hour),
    }
    if not ob_hour.empty:
        row["avg_imbalance_10"] = float(ob_hour["imb_10"].mean()) if "imb_10" in ob_hour else 0.0
        sp = ob_hour["spread_bps"].dropna() if "spread_bps" in ob_hour else pd.Series(dtype=float)
        row["spread_mean"] = float(sp.mean()) if len(sp) else 0.0
        row["spread_p50"] = float(sp.quantile(0.5)) if len(sp) else 0.0
        row["spread_p90"] = float(sp.quantile(0.9)) if len(sp) else 0.0
        dc = ob_hour["depth_chg_pct"].dropna() if "depth_chg_pct" in ob_hour else pd.Series(dtype=float)
        row["depth_change_rate"] = float(dc.mean()) if len(dc) else 0.0
    if not trades_hour.empty:
        row["trade_size_mean"] = float(trades_hour["size"].mean())
        row["trade_size_p50"] = float(trades_hour["size"].quantile(0.5))
        row["trade_size_p90"] = float(trades_hour["size"].quantile(0.9))
        buy = trades_hour.loc[trades_hour["side"] == "buy", "size"].sum()
        sell = trades_hour.loc[trades_hour["side"] == "sell", "size"].sum()
        total = buy + sell
        row["aggressive_buy_pct"] = float(buy / total * 100) if total else 0.0
        row["aggressive_sell_pct"] = float(sell / total * 100) if total else 0.0
        row["cumulative_delta"] = float(buy - sell)
        row["sweep_count"] = _count_sweeps(trades_hour)
        row["iceberg_like_count"] = _count_iceberg_like(trades_hour)
    else:
        row.update(
            {
                "trade_size_mean": 0.0,
                "trade_size_p50": 0.0,
                "trade_size_p90": 0.0,
                "aggressive_buy_pct": 0.0,
                "aggressive_sell_pct": 0.0,
                "cumulative_delta": 0.0,
                "sweep_count": 0,
                "iceberg_like_count": 0,
            }
        )
    row["absorption_count"] = _count_absorption(ob_hour, trades_hour)
    if not ob_hour.empty and "total_depth" in ob_hour.columns:
        depths = ob_hour["total_depth"].values
        vac = sum(
            1
            for i in range(1, len(depths))
            if detect_liquidity_vacuum(depths[i], depths[i - 1], threshold_pct=-20)
        )
        repl = sum(
            1
            for i in range(2, len(depths))
            if detect_replenishment(depths[i - 1], depths[i], depths[i - 2], min_recovery_pct=30)
        )
        row["liquidity_vacuum_count"] = vac
        row["replenishment_count"] = repl
    else:
        row["liquidity_vacuum_count"] = 0
        row["replenishment_count"] = 0
    return row


def sync_hourly_statistics(store: ParquetStore, symbol: str) -> int:
    """Compute and append missing hourly stats rows for symbol."""
    ob = store.load("orderbook", symbol)
    trades = store.load("trades", symbol)
    if ob.empty:
        return 0

    ob = enrich_orderbook(ob)
    existing = store.load("statistics", symbol)
    done_hours: set[int] = set()
    if not existing.empty and "ts" in existing.columns:
        done_hours = set(existing["ts"].astype(int).tolist())

    hours = sorted(ob["hour_ts"].unique())
    new_rows: list[dict] = []
    for h in hours:
        hi = int(h)
        if hi in done_hours:
            continue
        ob_h = ob[ob["hour_ts"] == h]
        tr_h = trades[(trades["ts"] >= hi) & (trades["ts"] < hi + 3_600_000)] if not trades.empty else pd.DataFrame()
        if len(ob_h) < 10:
            continue
        new_rows.append(compute_hourly_row(hi, symbol, ob_h, tr_h))

    if not new_rows:
        return 0
    for row in new_rows:
        store.buffer("statistics", row)
    return store.flush_key(f"statistics:{symbol}")

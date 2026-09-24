"""Execution-relevant feature engineering from L2 + trades."""

from __future__ import annotations

import numpy as np
import pandas as pd


def _safe_pct_change(s: pd.Series, periods: int = 1) -> pd.Series:
    return s.pct_change(periods=periods).replace([np.inf, -np.inf], np.nan).fillna(0.0)


def build_feature_frame(orderbook: pd.DataFrame, trades: pd.DataFrame) -> pd.DataFrame:
    """Merge book snapshots with rolling trade-flow metrics."""
    if orderbook.empty:
        return pd.DataFrame()

    ob = orderbook.sort_values("ts").reset_index(drop=True).copy()
    ob["imbalance"] = (ob["bid_depth"] - ob["ask_depth"]) / (ob["bid_depth"] + ob["ask_depth"] + 1e-12)
    ob["depth_total"] = ob["bid_depth"] + ob["ask_depth"]
    ob["depth_chg_pct"] = _safe_pct_change(ob["depth_total"], 1) * 100
    ob["spread_chg_bps"] = ob["spread_bps"].diff().fillna(0.0)
    ob["mid_ret_bps"] = _safe_pct_change(ob["mid"], 1) * 10_000

    if trades.empty:
        for col in (
            "trade_count",
            "buy_notional",
            "sell_notional",
            "aggressive_buy",
            "aggressive_sell",
            "large_trade_ratio",
            "vwap_dev_bps",
            "twap_uniformity",
            "iceberg_score",
            "queue_pressure",
            "footprint_z",
        ):
            ob[col] = 0.0
        return ob

    tr = trades.sort_values("ts").reset_index(drop=True).copy()
    tr["is_buy"] = (tr["side"] == "buy").astype(int)
    tr["buy_n"] = tr["notional"] * tr["is_buy"]
    tr["sell_n"] = tr["notional"] * (1 - tr["is_buy"])

    roll_windows_ms = (5_000, 30_000, 60_000)
    metrics: dict[str, list] = {c: [] for c in ob.columns}
    trade_idx = 0
    tr_ts = tr["ts"].values
    tr_n = len(tr)
    tr["exp_q90"] = tr["notional"].expanding(min_periods=10).quantile(0.90).shift(1)

    for _, row in ob.iterrows():
        ts = int(row["ts"])
        while trade_idx < tr_n and tr_ts[trade_idx] < ts - 60_000:
            trade_idx += 1
        j = trade_idx
        window = tr.iloc[j:] if j < tr_n else tr.iloc[0:0]
        window = window[window["ts"] <= ts]
        w5 = window[window["ts"] >= ts - 5_000]
        w30 = window[window["ts"] >= ts - 30_000]

        buy_n = float(w30["buy_n"].sum()) if not w30.empty else 0.0
        sell_n = float(w30["sell_n"].sum()) if not w30.empty else 0.0
        total_n = buy_n + sell_n
        past_tr = window
        if not past_tr.empty:
            qrow = past_tr[past_tr["ts"] <= ts]
            size_thr = float(qrow["exp_q90"].iloc[-1]) if not qrow.empty and pd.notna(qrow["exp_q90"].iloc[-1]) else 0.0
        else:
            size_thr = 0.0
        large_ratio = (
            float((w30["notional"] >= size_thr).mean()) if not w30.empty and size_thr > 0 else 0.0
        )

        vwap = float((w30["price"] * w30["size"]).sum() / (w30["size"].sum() + 1e-12)) if not w30.empty else row["mid"]
        vwap_dev = (row["mid"] - vwap) / (vwap + 1e-12) * 10_000

        if len(w5) >= 3:
            buckets = pd.cut(w5["ts"], bins=5, labels=False)
            bucket_vol = w5.groupby(buckets, observed=True)["notional"].sum()
            twap_uniformity = float(1.0 - bucket_vol.std() / (bucket_vol.mean() + 1e-12))
        else:
            twap_uniformity = 0.0

        refill = float(row["depth_chg_pct"]) if row["depth_chg_pct"] > 0 else 0.0
        vanish = abs(float(row["depth_chg_pct"])) if row["depth_chg_pct"] < 0 else 0.0
        absorption = total_n / (abs(float(row["mid_ret_bps"])) + 1.0)
        iceberg_score = refill * large_ratio
        queue_pressure = float(row["imbalance"]) * total_n
        footprint_z = total_n / (float(row["depth_total"]) + 1e-12)

        extra = {
            "trade_count": len(w30),
            "buy_notional": buy_n,
            "sell_notional": sell_n,
            "aggressive_buy": buy_n,
            "aggressive_sell": sell_n,
            "large_trade_ratio": large_ratio,
            "vwap_dev_bps": vwap_dev,
            "twap_uniformity": twap_uniformity,
            "iceberg_score": iceberg_score,
            "queue_pressure": queue_pressure,
            "footprint_z": footprint_z,
            "liquidity_refill_pct": refill,
            "liquidity_vanish_pct": vanish,
            "absorption_ratio": absorption,
            "passive_dominance": sell_n / (total_n + 1e-12) if row["mid_ret_bps"] > 0 else buy_n / (total_n + 1e-12),
            "aggressive_dominance": buy_n / (total_n + 1e-12) if row["mid_ret_bps"] > 0 else sell_n / (total_n + 1e-12),
            "spread_hold_score": -float(row["spread_chg_bps"]) if abs(row["mid_ret_bps"]) > 0 else 0.0,
            "post_impulse_shift": float(row["mid_ret_bps"]) * float(row["spread_chg_bps"]),
            "inventory_unwind_score": abs(buy_n - sell_n) / (total_n + 1e-12),
            "mm_spread_mgmt": float(row["spread_bps"]) * float(row["depth_chg_pct"]),
        }
        for k, v in extra.items():
            ob.at[row.name, k] = v

    return ob

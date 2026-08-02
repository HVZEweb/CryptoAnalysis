"""Build unified feature matrix from all available data sources."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from alpha.data.loader import load_funding, load_liquidations, load_ohlcv, load_open_interest
from alpha.features import (
    align_series_to_ohlcv,
    cross_asset_lead_signal,
    day_of_week,
    funding_window_proximity,
    hour_of_day,
    pct_change,
    realised_volatility,
    rolling_zscore,
    session_label,
    true_range_pct,
)
from exchange.okx_rest import to_swap_symbol

log = logging.getLogger("alpha.discovery.features")

FORWARD_HORIZONS = (1, 3, 6, 12, 24)


def build_feature_matrix(
    symbol: str,
    *,
    timeframe: str = "5m",
    bars: int = 0,
    cross_symbols: list[str] | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Returns (features_df, metadata about coverage)."""
    ohlcv = load_ohlcv(symbol, timeframe, bars)
    if ohlcv is None or len(ohlcv) < 200:
        return pd.DataFrame(), {"error": "no_ohlcv"}

    f = ohlcv.copy()
    meta: dict = {"symbol": to_swap_symbol(symbol), "bars": len(f), "sources": ["ohlcv"]}

    for h in FORWARD_HORIZONS:
        f[f"fwd_ret_{h}"] = f["close"].pct_change(h).shift(-h) * 100

    f["ret_1"] = pct_change(f["close"], 1)
    f["ret_3"] = pct_change(f["close"], 3)
    f["ret_6"] = pct_change(f["close"], 6)
    f["ret_12"] = pct_change(f["close"], 12)
    f["rvol_24"] = realised_volatility(f["close"], 24)
    f["rvol_48"] = realised_volatility(f["close"], 48)
    f["tr_pct"] = true_range_pct(f["high"], f["low"], f["close"])
    f["vol_ma20"] = f["volume"].rolling(20).mean()
    f["vol_ratio"] = f["volume"] / f["vol_ma20"].replace(0, np.nan)
    f["range_pct"] = (f["high"] - f["low"]) / f["close"] * 100
    f["session"] = session_label(f["ts"])
    f["hour"] = hour_of_day(f["ts"])
    f["dow"] = day_of_week(f["ts"])
    f["funding_dist_min"] = funding_window_proximity(f["ts"])

    funding = load_funding(symbol)
    if funding is not None and len(funding) > 5:
        f["funding_rate"] = align_series_to_ohlcv(f, funding, "funding_rate")
        f["funding_z"] = rolling_zscore(f["funding_rate"], 48)
        f["funding_chg"] = f["funding_rate"].diff()
        meta["sources"].append("funding")
        meta["funding_rows"] = len(funding)

    oi = load_open_interest(symbol)
    if oi is not None and len(oi) > 5:
        f["open_interest"] = align_series_to_ohlcv(f, oi, "open_interest")
        f["oi_chg_6"] = pct_change(f["open_interest"], 6)
        f["oi_chg_12"] = pct_change(f["open_interest"], 12)
        f["oi_z"] = rolling_zscore(f["open_interest"], 48)
        f["price_oi_div"] = f["ret_6"] - f["oi_chg_6"]
        meta["sources"].append("open_interest")
        meta["oi_rows"] = len(oi)

    liq = load_liquidations(symbol)
    if liq is not None and len(liq) > 0:
        agg = liq.groupby("ts")["sz"].sum().reset_index()
        agg.columns = ["ts", "liq_sz"]
        f["liq_sz"] = align_series_to_ohlcv(f, agg, "liq_sz").fillna(0)
        f["liq_z"] = rolling_zscore(f["liq_sz"].replace(0, np.nan), 24)
        meta["sources"].append("liquidations")

    for cs in cross_symbols or []:
        cdf = load_ohlcv(cs, timeframe, bars)
        if cdf is None or len(cdf) < 100:
            continue
        key = to_swap_symbol(cs).split("/")[0].lower()
        min_len = min(len(f), len(cdf))
        leader = cdf.iloc[-min_len:].reset_index(drop=True)
        follower = f.iloc[-min_len:].reset_index(drop=True)
        f = follower
        f[f"{key}_ret_3"] = pct_change(leader["close"], 3)
        f[f"{key}_lead"] = cross_asset_lead_signal(leader["close"], f["close"], lag_bars=3)
        meta["sources"].append(f"cross_{key}")

    meta["overlap_bars"] = int(f[["funding_rate", "open_interest"]].notna().all(axis=1).sum()) if "funding_rate" in f.columns and "open_interest" in f.columns else 0

    return f, meta


def feature_columns(df: pd.DataFrame) -> list[str]:
    exclude = {"ts", "open", "high", "low", "close", "volume", "datetime_utc", "session"}
    exclude.update({c for c in df.columns if c.startswith("fwd_ret_")})
    return [c for c in df.columns if c not in exclude and df[c].dtype in ("float64", "int64", "float32", "int32")]

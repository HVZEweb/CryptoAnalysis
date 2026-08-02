"""Horizon statistics and Information Coefficient."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class HorizonStats:
    horizon_sec: int
    n: int
    mean_ret_pct: float
    median_ret_pct: float
    prob_up_pct: float
    prob_down_pct: float
    win_rate: float
    expectancy_pct: float
    profit_factor: float
    mae_pct: float
    mfe_pct: float
    information_coefficient: float

    def to_dict(self) -> dict:
        return {
            "horizon_sec": self.horizon_sec,
            "n": self.n,
            "mean_ret_pct": round(self.mean_ret_pct, 6),
            "median_ret_pct": round(self.median_ret_pct, 6),
            "prob_up_pct": round(self.prob_up_pct, 2),
            "prob_down_pct": round(self.prob_down_pct, 2),
            "win_rate": round(self.win_rate, 2),
            "expectancy_pct": round(self.expectancy_pct, 6),
            "profit_factor": round(self.profit_factor, 4),
            "mae_pct": round(self.mae_pct, 6),
            "mfe_pct": round(self.mfe_pct, 6),
            "information_coefficient": round(self.information_coefficient, 6),
        }


def compute_horizon_stats(
    returns: pd.Series,
    horizon_sec: int,
    *,
    signal: pd.Series | None = None,
) -> HorizonStats:
    r = returns.dropna().astype(float)
    n = len(r)
    if n == 0:
        return HorizonStats(horizon_sec, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

    wins = r[r > 0]
    losses = r[r <= 0]
    pf = float(wins.sum() / abs(losses.sum())) if losses.sum() != 0 else (999.0 if wins.sum() > 0 else 0.0)

    ic = 0.0
    if signal is not None and len(signal) == n and n > 5:
        sig = signal.iloc[:n].astype(float)
        if sig.std() > 0 and r.std() > 0:
            ic = float(np.corrcoef(sig, r)[0, 1])

    cum = r.cumsum()
    mae = float((cum - cum.cummax()).min()) if n else 0.0
    mfe = float((cum - cum.cummin()).max()) if n else 0.0

    return HorizonStats(
        horizon_sec=horizon_sec,
        n=n,
        mean_ret_pct=float(r.mean()),
        median_ret_pct=float(r.median()),
        prob_up_pct=float((r > 0).mean() * 100),
        prob_down_pct=float((r < 0).mean() * 100),
        win_rate=float((r > 0).mean() * 100),
        expectancy_pct=float(r.mean()),
        profit_factor=pf,
        mae_pct=mae,
        mfe_pct=mfe,
        information_coefficient=ic,
    )


def explore_event_horizons(
    labeled: pd.DataFrame,
    horizons: tuple[int, ...],
    *,
    use_net: bool = True,
    signal_col: str = "feature_value",
    holdout_pct: float = 0.25,
) -> dict:
    from research.causal import split_by_time

    if labeled.empty:
        return {"count": 0, "horizons": [], "best_horizon_sec": None, "best_expectancy": 0.0}

    labeled = labeled.sort_values("ts").reset_index(drop=True)
    train, _ = split_by_time(labeled, holdout_pct)

    stats_list = []
    best_h = horizons[0]
    best_ev = -1e9

    for h in horizons:
        col = f"net_fwd_ret_{h}s" if use_net and f"net_fwd_ret_{h}s" in labeled.columns else f"fwd_ret_{h}s"
        if col not in labeled.columns:
            continue
        sig = labeled[signal_col] if signal_col in labeled.columns else None
        st = compute_horizon_stats(labeled[col], h, signal=sig)
        stats_list.append(st.to_dict())

        if col in train.columns and not train.empty:
            st_train = compute_horizon_stats(train[col], h, signal=train[signal_col] if signal_col in train.columns else None)
            if st_train.expectancy_pct > best_ev and st_train.n > 0:
                best_ev = st_train.expectancy_pct
                best_h = h

    return {
        "count": len(labeled),
        "horizons": stats_list,
        "best_horizon_sec": best_h,
        "best_expectancy": best_ev,
    }

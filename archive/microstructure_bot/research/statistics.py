"""Event study metrics — mean, median, WR, EV, PF, MAE/MFE."""

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

    def to_dict(self) -> dict:
        return {
            "horizon_sec": self.horizon_sec,
            "n": self.n,
            "mean_ret_pct": round(self.mean_ret_pct, 4),
            "median_ret_pct": round(self.median_ret_pct, 4),
            "prob_up_pct": round(self.prob_up_pct, 2),
            "prob_down_pct": round(self.prob_down_pct, 2),
            "win_rate": round(self.win_rate, 2),
            "expectancy_pct": round(self.expectancy_pct, 4),
            "profit_factor": round(self.profit_factor, 3),
            "mae_pct": round(self.mae_pct, 4),
            "mfe_pct": round(self.mfe_pct, 4),
        }


def compute_horizon_stats(returns: pd.Series, horizon_sec: int) -> HorizonStats:
    r = returns.dropna()
    if r.empty:
        return HorizonStats(horizon_sec, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

    wins = r[r > 0]
    losses = r[r <= 0]
    gross_win = wins.sum()
    gross_loss = abs(losses.sum())
    pf = gross_win / gross_loss if gross_loss > 0 else (999.0 if gross_win > 0 else 0.0)

    return HorizonStats(
        horizon_sec=horizon_sec,
        n=len(r),
        mean_ret_pct=float(r.mean()),
        median_ret_pct=float(r.median()),
        prob_up_pct=float((r > 0).mean() * 100),
        prob_down_pct=float((r < 0).mean() * 100),
        win_rate=float((r > 0).mean() * 100),
        expectancy_pct=float(r.mean()),
        profit_factor=float(pf),
        mae_pct=float(r.min()),
        mfe_pct=float(r.max()),
    )


def event_study_table(labeled: pd.DataFrame, horizons_sec: tuple[int, ...]) -> list[dict]:
    rows = []
    for h in horizons_sec:
        col = f"fwd_ret_{h}s"
        if col not in labeled.columns:
            continue
        stats = compute_horizon_stats(labeled[col], h)
        rows.append(stats.to_dict())
    return rows

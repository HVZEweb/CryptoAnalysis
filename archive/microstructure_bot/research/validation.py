"""Full validation — train/test, walk-forward, bootstrap, independent days, cross-symbol."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from research.backtest import bootstrap_mean_pvalue, split_holdout, walk_forward_ev
from research.causal import split_by_time


@dataclass
class FullValidation:
    event_key: str
    symbol: str
    horizon_sec: int
    n_events: int
    train_ev: float = 0.0
    test_ev: float = 0.0
    oos_pass: bool = False
    walk_forward_stable: bool = False
    bootstrap_p: float = 1.0
    independent_days_pass: bool = False
    accepted: bool = False
    verdict: str = ""
    daily_ev: list[float] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "event_key": self.event_key,
            "symbol": self.symbol,
            "horizon_sec": self.horizon_sec,
            "n_events": self.n_events,
            "train_ev": round(self.train_ev, 4),
            "test_ev": round(self.test_ev, 4),
            "oos_pass": self.oos_pass,
            "walk_forward_stable": self.walk_forward_stable,
            "bootstrap_p": round(self.bootstrap_p, 4),
            "independent_days_pass": self.independent_days_pass,
            "accepted": self.accepted,
            "verdict": self.verdict,
            "daily_ev": [round(x, 4) for x in self.daily_ev[:10]],
        }


def independent_days_test(labeled: pd.DataFrame, ret_col: str) -> tuple[bool, list[float]]:
    """Each UTC day should show non-random edge — majority of days positive mean."""
    if labeled.empty or ret_col not in labeled.columns or "ts" not in labeled.columns:
        return False, []
    df = labeled.copy()
    df["day"] = pd.to_datetime(df["ts"], unit="ms", utc=True).dt.date
    daily = df.groupby("day")[ret_col].mean()
    daily_ev = [float(x) for x in daily.values]
    if len(daily) < 2:
        return False, daily_ev
    positive_days = sum(1 for x in daily_ev if x > 0)
    return positive_days / len(daily_ev) >= 0.5, daily_ev


def validate_labeled_events(
    labeled: pd.DataFrame,
    *,
    event_key: str,
    symbol: str,
    horizon_sec: int,
    ret_col: str,
    holdout_pct: float = 0.25,
    n_boot: int = 2000,
    min_n: int = 20,
) -> FullValidation:
    r = labeled[ret_col].dropna() if ret_col in labeled.columns else pd.Series(dtype=float)
    result = FullValidation(event_key=event_key, symbol=symbol, horizon_sec=horizon_sec, n_events=len(r))

    if len(r) < min_n:
        result.verdict = f"insufficient events ({len(r)} < {min_n})"
        return result

    train, test = split_holdout(pd.DataFrame({"r": r}), holdout_pct)
    result.train_ev = float(train["r"].mean())
    result.test_ev = float(test["r"].mean())
    result.oos_pass = result.test_ev > 0 and len(test) >= max(5, min_n // 4)

    wf = walk_forward_ev(r, train=max(min_n, 30), test=max(10, min_n // 4), step=max(10, min_n // 4))
    result.walk_forward_stable = len(wf) >= 1 and (sum(1 for x in wf if x > 0) / len(wf) >= 0.5 if wf else False)

    result.bootstrap_p = bootstrap_mean_pvalue(test["r"], n_boot=n_boot)
    sig = result.bootstrap_p < 0.05

    _, test_labeled = split_by_time(labeled, holdout_pct)
    ind_pass, daily = independent_days_test(test_labeled, ret_col)
    result.independent_days_pass = ind_pass
    result.daily_ev = daily

    parts = []
    if result.train_ev <= 0:
        parts.append("negative train EV")
    if not result.oos_pass:
        parts.append("OOS fail")
    if not result.walk_forward_stable:
        parts.append("walk-forward unstable")
    if not sig:
        parts.append(f"bootstrap p={result.bootstrap_p:.3f}")
    if not ind_pass:
        parts.append("independent days fail")

    result.accepted = not parts
    result.verdict = "; ".join(parts) if parts else "passes all gates"
    return result


def cross_symbol_gate(
    validations: list[FullValidation],
    required_symbols: tuple[str, ...],
) -> tuple[bool, list[str]]:
    """Reject if pattern fails on any required symbol."""
    by_sym: dict[str, bool] = {}
    for v in validations:
        if v.accepted:
            by_sym[v.symbol] = True
    missing = [s for s in required_symbols if not by_sym.get(s)]
    return len(missing) == 0, missing

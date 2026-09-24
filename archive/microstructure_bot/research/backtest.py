"""Train/test, walk-forward, OOS, bootstrap validation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from research.statistics import compute_horizon_stats


@dataclass
class ValidationResult:
    horizon_sec: int
    train_ev: float
    test_ev: float
    oos_pass: bool
    walk_forward_stable: bool
    bootstrap_p: float
    accepted: bool
    verdict: str


def split_holdout(df: pd.DataFrame, holdout_pct: float = 0.25) -> tuple[pd.DataFrame, pd.DataFrame]:
    if "ts" in df.columns:
        from research.causal import split_by_time
        return split_by_time(df, holdout_pct)
    n = len(df)
    cut = int(n * (1 - holdout_pct))
    return df.iloc[:cut].reset_index(drop=True), df.iloc[cut:].reset_index(drop=True)


def walk_forward_ev(returns: pd.Series, *, train: int = 200, test: int = 50, step: int = 50) -> list[float]:
    evs: list[float] = []
    r = returns.dropna().values
    start = 0
    while start + train + test <= len(r):
        fold = r[start + train : start + train + test]
        evs.append(float(np.mean(fold)))
        start += step
    return evs


def bootstrap_mean_pvalue(returns: pd.Series, *, n_boot: int = 2000, seed: int = 42) -> float:
    r = returns.dropna().values
    if len(r) < 10:
        return 1.0
    rng = np.random.default_rng(seed)
    observed = float(np.mean(r))
    count = 0
    for _ in range(n_boot):
        sample = rng.choice(r, size=len(r), replace=True)
        if float(np.mean(sample)) >= observed:
            count += 1
    return count / n_boot


def validate_event_returns(
    returns: pd.Series,
    horizon_sec: int,
    *,
    holdout_pct: float = 0.25,
    n_boot: int = 2000,
    min_test_n: int = 30,
) -> ValidationResult:
    r = returns.dropna()
    if len(r) < min_test_n * 2:
        return ValidationResult(
            horizon_sec, 0, 0, False, False, 1.0, False, f"insufficient samples ({len(r)})"
        )

    train, test = split_holdout(pd.DataFrame({"r": r}), holdout_pct)
    train_ev = float(train["r"].mean())
    test_ev = float(test["r"].mean())
    oos_pass = test_ev > 0 and len(test) >= min_test_n

    wf = walk_forward_ev(r)
    wf_stable = len(wf) >= 2 and sum(1 for x in wf if x > 0) / len(wf) >= 0.5

    p = bootstrap_mean_pvalue(test["r"], n_boot=n_boot)
    sig = p < 0.05

    accepted = oos_pass and wf_stable and sig and train_ev > 0
    parts = []
    if train_ev <= 0:
        parts.append("negative train EV")
    if not oos_pass:
        parts.append("OOS fail")
    if not wf_stable:
        parts.append("walk-forward unstable")
    if not sig:
        parts.append(f"bootstrap p={p:.3f}")
    verdict = "; ".join(parts) if parts else "passes validation gates"

    return ValidationResult(
        horizon_sec=horizon_sec,
        train_ev=train_ev,
        test_ev=test_ev,
        oos_pass=oos_pass,
        walk_forward_stable=wf_stable,
        bootstrap_p=p,
        accepted=accepted,
        verdict=verdict,
    )

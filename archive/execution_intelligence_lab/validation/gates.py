"""Cross-symbol, cross-session, cross-day validation gates."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from config import Config
from features.sessions import add_session_column
from research.causal import split_by_time
from validation.bootstrap import bootstrap_mean_pvalue
from validation.walk_forward import chronological_split, walk_forward_stable


@dataclass
class ValidationResult:
    pattern_id: str
    symbol: str
    horizon_sec: int
    n_events: int
    train_ev: float
    test_ev: float
    oos_pass: bool
    walk_forward_stable: bool
    bootstrap_p: float
    cross_session_pass: bool
    cross_day_pass: bool
    accepted: bool
    verdict: str
    daily_ev: list[float] = field(default_factory=list)
    session_ev: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pattern_id": self.pattern_id,
            "symbol": self.symbol,
            "horizon_sec": self.horizon_sec,
            "n_events": self.n_events,
            "train_ev": round(self.train_ev, 6),
            "test_ev": round(self.test_ev, 6),
            "oos_pass": self.oos_pass,
            "walk_forward_stable": self.walk_forward_stable,
            "bootstrap_p": round(self.bootstrap_p, 4),
            "cross_session_pass": self.cross_session_pass,
            "cross_day_pass": self.cross_day_pass,
            "accepted": self.accepted,
            "verdict": self.verdict,
            "daily_ev": [round(x, 6) for x in self.daily_ev],
            "session_ev": {k: round(v, 6) for k, v in self.session_ev.items()},
        }


def validate_events(
    labeled: pd.DataFrame,
    *,
    pattern_id: str,
    symbol: str,
    horizon_sec: int,
    ret_col: str,
    config: Config,
    min_n: int,
) -> ValidationResult:
    if labeled.empty or ret_col not in labeled.columns:
        return ValidationResult(
            pattern_id, symbol, horizon_sec, 0, 0, 0, False, False, 1.0, False, False, False,
            "no labeled events",
        )

    labeled = labeled.sort_values("ts").reset_index(drop=True)
    n = len(labeled)
    if n < min_n:
        return ValidationResult(
            pattern_id, symbol, horizon_sec, n, 0, 0, False, False, 1.0, False, False, False,
            f"insufficient events ({n} < {min_n})",
        )

    train, test = chronological_split(labeled, config.oos_holdout_pct)
    train_ev = float(train[ret_col].mean()) if not train.empty else 0.0
    test_ev = float(test[ret_col].mean()) if not test.empty else 0.0
    oos_pass = test_ev > 0 and len(test) >= max(3, min_n // 4)
    wf_stable = walk_forward_stable(train_ev, test_ev)
    boot_p = bootstrap_mean_pvalue(test[ret_col], n_samples=config.bootstrap_samples)

    enriched_test = add_session_column(test, config)
    daily_ev: list[float] = []
    cross_day_pass = True
    if "utc_day" in enriched_test.columns and not enriched_test.empty:
        for _, grp in enriched_test.groupby("utc_day"):
            if len(grp) >= 2:
                daily_ev.append(float(grp[ret_col].mean()))
        if len(daily_ev) >= 2:
            cross_day_pass = sum(1 for x in daily_ev if x > 0) >= len(daily_ev) * 0.5

    session_ev: dict[str, float] = {}
    cross_session_pass = True
    if "session" in enriched_test.columns and not enriched_test.empty:
        for sess, grp in enriched_test.groupby("session"):
            if len(grp) >= 2:
                session_ev[sess] = float(grp[ret_col].mean())
        if len(session_ev) >= 2:
            cross_session_pass = sum(1 for x in session_ev.values() if x > 0) >= len(session_ev) * 0.5

    accepted = (
        train_ev > 0
        and oos_pass
        and wf_stable
        and boot_p < 0.05
        and cross_day_pass
        and cross_session_pass
    )
    verdict_parts = []
    if train_ev <= 0:
        verdict_parts.append("train EV ≤ 0")
    if not oos_pass:
        verdict_parts.append("OOS fail")
    if not wf_stable:
        verdict_parts.append("walk-forward unstable")
    if boot_p >= 0.05:
        verdict_parts.append(f"bootstrap p={boot_p:.3f}")
    if not cross_day_pass:
        verdict_parts.append("cross-day fail")
    if not cross_session_pass:
        verdict_parts.append("cross-session fail")
    verdict = "; ".join(verdict_parts) if verdict_parts else "passed"

    return ValidationResult(
        pattern_id=pattern_id,
        symbol=symbol,
        horizon_sec=horizon_sec,
        n_events=n,
        train_ev=train_ev,
        test_ev=test_ev,
        oos_pass=oos_pass,
        walk_forward_stable=wf_stable,
        bootstrap_p=boot_p,
        cross_session_pass=cross_session_pass,
        cross_day_pass=cross_day_pass,
        accepted=accepted,
        verdict=verdict,
        daily_ev=daily_ev,
        session_ev=session_ev,
    )


def cross_symbol_gate(results: list[ValidationResult], required: tuple[str, ...]) -> tuple[bool, list[str]]:
    by_sym = {r.symbol: r for r in results}
    missing = [s for s in required if s not in by_sym]
    if missing:
        return False, missing
    passed = [r for r in results if r.accepted]
    return len(passed) >= 2 and all(r.accepted for r in results if r.symbol in required), missing

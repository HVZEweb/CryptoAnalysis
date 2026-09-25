"""Validate discovered patterns through full research pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from alpha.backtest import simulate_entries
from alpha.discovery.combinations import CombinationCandidate
from alpha.significance import bootstrap_significance
from research.config import ExecutionModel
from research.metrics import ResearchMetrics, aggregate_fold_metrics, build_research_metrics, overfitting_score
from research.oos import split_holdout


@dataclass
class PatternResult:
    candidate: CombinationCandidate
    description: str
    status: str
    verdict: str
    full_sample: ResearchMetrics | None = None
    in_sample: ResearchMetrics | None = None
    out_of_sample: ResearchMetrics | None = None
    walk_forward: ResearchMetrics | None = None
    rolling: ResearchMetrics | None = None
    significance: dict = field(default_factory=dict)
    overfitting_score: float = 1.0
    stability_score: float = 0.0
    strategy_ready: bool = False

    def to_dict(self) -> dict:
        return {
            "description": self.description,
            "status": self.status,
            "verdict": self.verdict,
            "candidate": self.candidate.to_dict(),
            "full_sample": self.full_sample.to_dict() if self.full_sample else None,
            "out_of_sample": self.out_of_sample.to_dict() if self.out_of_sample else None,
            "walk_forward": self.walk_forward.to_dict() if self.walk_forward else None,
            "rolling": self.rolling.to_dict() if self.rolling else None,
            "significance": self.significance,
            "overfitting_score": round(self.overfitting_score, 3),
            "stability_score": round(self.stability_score, 3),
            "strategy_ready": self.strategy_ready,
        }


def _parse_rule_mask(
    df: pd.DataFrame, rule: str, fa: str, fb: str | None, *, ref: pd.DataFrame
) -> pd.Series:
    """Apply thresholds fitted on ref to df rows (causal IS→OOS)."""
    if ">=" in rule and "&" in rule and fb:
        q80a = ref[fa].quantile(0.8)
        q80b = ref[fb].quantile(0.8)
        return (df[fa] >= q80a) & (df[fb] >= q80b)
    if "<=" in rule and "&" in rule and fb:
        q20a = ref[fa].quantile(0.2)
        q20b = ref[fb].quantile(0.2)
        return (df[fa] <= q20a) & (df[fb] <= q20b)
    if f"{fa} >= Q80" in rule:
        return df[fa] >= ref[fa].quantile(0.8)
    if f"{fa} <= Q20" in rule:
        return df[fa] <= ref[fa].quantile(0.2)
    return pd.Series(True, index=df.index)


def _entries_from_pattern(
    df: pd.DataFrame, cand: CombinationCandidate, *, thresholds_from: pd.DataFrame
) -> list[tuple[int, str]]:
    work = df.reset_index(drop=True)
    mask = _parse_rule_mask(work, cand.rule, cand.feature_a, cand.feature_b, ref=thresholds_from).reset_index(drop=True)
    entries: list[tuple[int, str]] = []
    side = "long" if cand.is_mean_ret > 0 else "short"
    for i in range(50, len(work) - 30):
        if i >= len(mask) or not bool(mask.iloc[i]):
            continue
        entries.append((i, side))
    return entries


def validate_pattern(
    df: pd.DataFrame,
    cand: CombinationCandidate,
    *,
    symbol: str,
    execution: ExecutionModel | None = None,
    holdout_pct: float = 0.25,
) -> PatternResult:
    is_df, oos_df = split_holdout(df, holdout_pct)
    desc = f"{cand.rule} -> {cand.target} ({symbol})"

    is_entries = _entries_from_pattern(is_df, cand, thresholds_from=is_df)
    oos_entries = _entries_from_pattern(oos_df, cand, thresholds_from=is_df)
    full_entries = _entries_from_pattern(df, cand, thresholds_from=is_df)

    ex = execution or ExecutionModel()
    is_trades = simulate_entries(is_df, is_entries, strategy="discovery", symbol=symbol, execution=ex)
    oos_trades = simulate_entries(oos_df, oos_entries, strategy="discovery", symbol=symbol, execution=ex)
    full_trades = simulate_entries(df, full_entries, strategy="discovery", symbol=symbol, execution=ex)

    is_m = build_research_metrics(is_trades)
    oos_m = build_research_metrics(oos_trades)
    full_m = build_research_metrics(full_trades)

    wf_folds: list[ResearchMetrics] = []
    start = 0
    train, test, step = 3000, 1000, 1000
    while start + train + test <= len(df):
        chunk = df.iloc[start + train : start + train + test]
        ent = _entries_from_pattern(chunk, cand, thresholds_from=is_df)
        wf_folds.append(build_research_metrics(simulate_entries(chunk, ent, strategy="discovery", symbol=symbol, execution=ex)))
        start += step
    wf_m = aggregate_fold_metrics(wf_folds)
    stability = wf_m.stability_score

    roll_folds: list[ResearchMetrics] = []
    start = 0
    while start + 5000 <= len(df):
        chunk = df.iloc[start : start + 5000]
        ent = _entries_from_pattern(chunk, cand, thresholds_from=is_df)
        roll_folds.append(build_research_metrics(simulate_entries(chunk, ent, strategy="discovery", symbol=symbol, execution=ex)))
        start += 1000
    roll_m = aggregate_fold_metrics(roll_folds)

    overfit = overfitting_score(is_m, oos_m)
    sig = bootstrap_significance([t.net_return_pct for t in oos_trades])
    sig_d = sig.to_dict()

    status = "rejected"
    verdict_parts = []
    strategy_ready = False

    if oos_m.trades < 5:
        verdict_parts.append(f"insufficient OOS trades ({oos_m.trades})")
    elif full_m.expectancy_pct <= 0:
        verdict_parts.append(f"negative full-sample EV ({full_m.expectancy_pct:.4f}%)")
    elif full_m.profit_factor <= 1:
        verdict_parts.append(f"full-sample PF {full_m.profit_factor:.3f} <= 1")
    elif oos_m.expectancy_pct <= 0:
        verdict_parts.append(f"negative OOS EV ({oos_m.expectancy_pct:.4f}%)")
    elif oos_m.profit_factor <= 1:
        verdict_parts.append(f"OOS PF {oos_m.profit_factor:.3f} <= 1")
    elif wf_m.trades > 0 and wf_m.expectancy_pct <= 0:
        verdict_parts.append(f"negative walk-forward EV ({wf_m.expectancy_pct:.4f}%)")
    elif overfit >= 0.8:
        verdict_parts.append(f"overfit {overfit:.2f}")
    elif stability < 40:
        verdict_parts.append(f"WF stability {stability:.1f}%")
    elif not sig.significant:
        verdict_parts.append(f"bootstrap p={sig.p_value:.3f}")
    else:
        status = "symbol_pass"
        strategy_ready = False
        verdict_parts.append("passes per-symbol gates; awaits cross-instrument check")

    return PatternResult(
        candidate=cand,
        description=desc,
        status=status,
        verdict="; ".join(verdict_parts),
        full_sample=full_m,
        in_sample=is_m,
        out_of_sample=oos_m,
        walk_forward=wf_m,
        rolling=roll_m,
        significance=sig_d,
        overfitting_score=overfit,
        stability_score=stability,
        strategy_ready=strategy_ready,
    )

"""Statistically filtered feature combination search."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from alpha.discovery.metrics import FeatureScore, _spearman_ic


@dataclass
class CombinationCandidate:
    feature_a: str
    feature_b: str | None
    rule: str
    symbol: str
    target: str
    is_ic: float
    oos_ic: float
    is_samples: int
    oos_samples: int
    is_mean_ret: float
    oos_mean_ret: float

    def to_dict(self) -> dict:
        return {
            "feature_a": self.feature_a,
            "feature_b": self.feature_b,
            "rule": self.rule,
            "symbol": self.symbol,
            "target": self.target,
            "is_ic": round(self.is_ic, 4),
            "oos_ic": round(self.oos_ic, 4),
            "is_samples": self.is_samples,
            "oos_samples": self.oos_samples,
            "is_mean_ret": round(self.is_mean_ret, 4),
            "oos_mean_ret": round(self.oos_mean_ret, 4),
        }


def _quintile_masks(series: pd.Series, q_low: float, q_high: float) -> tuple[pd.Series, pd.Series]:
    valid = series.dropna()
    if len(valid) < 50:
        empty = pd.Series(False, index=series.index)
        return empty, empty
    lo = valid.quantile(q_low)
    hi = valid.quantile(q_high)
    return series <= lo, series >= hi


def _quintile_masks_from_ref(target: pd.Series, ref: pd.Series, q_low: float, q_high: float) -> tuple[pd.Series, pd.Series]:
    """Fit quantile cutoffs on ref; apply to target (no OOS-adaptive thresholds)."""
    valid = ref.dropna()
    if len(valid) < 50:
        empty = pd.Series(False, index=target.index)
        return empty, empty
    lo = valid.quantile(q_low)
    hi = valid.quantile(q_high)
    return target <= lo, target >= hi


def search_combinations(
    is_df: pd.DataFrame,
    oos_df: pd.DataFrame,
    ranked: list[FeatureScore],
    target: str,
    *,
    symbol: str,
    top_k: int = 12,
    min_individual_ic: float = 0.012,
) -> list[CombinationCandidate]:
    """Pairwise + single-feature extremes — not full brute force."""
    candidates: list[CombinationCandidate] = []
    pool = [s for s in ranked[:top_k] if abs(s.ic) >= min_individual_ic]
    if not pool:
        return candidates

    def eval_mask(is_mask: pd.Series, oos_mask: pd.Series, rule: str, fa: str, fb: str | None) -> None:
        is_sub = is_df[is_mask]
        oos_sub = oos_df[oos_mask]
        if len(is_sub) < 30 or len(oos_sub) < 15:
            return
        is_ret = is_sub[target].mean()
        oos_ret = oos_sub[target].mean()
        is_ic, _ = _spearman_ic(is_sub[fa], is_sub[target]) if fa in is_sub.columns else (0.0, 1.0)
        oos_ic, _ = _spearman_ic(oos_sub[fa], oos_sub[target]) if fa in oos_sub.columns else (0.0, 1.0)
        if oos_ret <= 0 and is_ret <= 0:
            return
        candidates.append(
            CombinationCandidate(
                feature_a=fa,
                feature_b=fb,
                rule=rule,
                symbol=symbol,
                target=target,
                is_ic=is_ic,
                oos_ic=oos_ic,
                is_samples=len(is_sub),
                oos_samples=len(oos_sub),
                is_mean_ret=float(is_ret),
                oos_mean_ret=float(oos_ret),
            )
        )

    for s in pool:
        fa = s.name
        if fa not in is_df.columns:
            continue
        lo_is, hi_is = _quintile_masks(is_df[fa], 0.2, 0.8)
        lo_oos, hi_oos = _quintile_masks_from_ref(oos_df[fa], is_df[fa], 0.2, 0.8)
        eval_mask(lo_is, lo_oos, f"{fa} <= Q20", fa, None)
        eval_mask(hi_is, hi_oos, f"{fa} >= Q80", fa, None)

    for i, sa in enumerate(pool):
        for sb in pool[i + 1 :]:
            fa, fb = sa.name, sb.name
            if fa not in is_df.columns or fb not in is_df.columns:
                continue
            hi_a_is, _ = _quintile_masks(is_df[fa], 0.8, 0.8)
            hi_b_is, _ = _quintile_masks(is_df[fb], 0.8, 0.8)
            hi_a_oos, _ = _quintile_masks_from_ref(oos_df[fa], is_df[fa], 0.8, 0.8)
            hi_b_oos, _ = _quintile_masks_from_ref(oos_df[fb], is_df[fb], 0.8, 0.8)
            eval_mask(hi_a_is & hi_b_is, hi_a_oos & hi_b_oos, f"{fa}>=Q80 & {fb}>=Q80", fa, fb)
            lo_a_is, _ = _quintile_masks(is_df[fa], 0.2, 0.2)
            lo_b_is, _ = _quintile_masks(is_df[fb], 0.2, 0.2)
            lo_a_oos, _ = _quintile_masks_from_ref(oos_df[fa], is_df[fa], 0.2, 0.2)
            lo_b_oos, _ = _quintile_masks_from_ref(oos_df[fb], is_df[fb], 0.2, 0.2)
            eval_mask(lo_a_is & lo_b_is, lo_a_oos & lo_b_oos, f"{fa}<=Q20 & {fb}<=Q20", fa, fb)

    return sorted(candidates, key=lambda c: c.oos_mean_ret, reverse=True)

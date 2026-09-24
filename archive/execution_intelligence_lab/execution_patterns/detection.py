"""Statistical event detection — causal expanding quantiles."""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

from research.causal import EXPANDING_MIN_PERIODS, expanding_quantile

QUANTILE_LABELS = {
    0.99: "q99",
    0.95: "q95",
    0.90: "q90",
    0.10: "q10",
    0.05: "q05",
    0.01: "q01",
}


def _quantile_label(q: float) -> str:
    return QUANTILE_LABELS.get(q, f"q{int(q * 100)}")


def detect_statistical_events(
    features: pd.DataFrame,
    feature_col: str,
    event_name: str,
    *,
    quantiles: Iterable[float] = (0.99, 0.95, 0.90, 0.01, 0.05, 0.10),
    flag_condition: str | None = None,
    min_periods: int = EXPANDING_MIN_PERIODS,
) -> pd.DataFrame:
    """Mark rows where feature exceeds expanding quantile thresholds (causal at t)."""
    if features.empty or feature_col not in features.columns:
        return pd.DataFrame()

    s = features[feature_col].astype(float)
    base_cols = ["ts", "inst_id"] if "inst_id" in features.columns else ["ts"]
    rows: list[dict] = []

    if flag_condition:
        mask = _eval_flag(features, flag_condition)
        flagged = features[mask]
        for _, r in flagged.iterrows():
            rows.append(
                {
                    **{c: r[c] for c in base_cols if c in r},
                    "event": event_name,
                    "quantile": "flag",
                    "feature": feature_col,
                    "feature_value": float(r[feature_col]),
                    "threshold": None,
                    "mid": float(r.get("mid", 0)),
                }
            )

    for q in quantiles:
        if q >= 0.5:
            thr_series = expanding_quantile(s, q, min_periods=min_periods).shift(1)
            mask = (s >= thr_series).fillna(False)
            label = _quantile_label(q)
        else:
            thr_series = expanding_quantile(s, q, min_periods=min_periods).shift(1)
            mask = (s <= thr_series).fillna(False)
            label = _quantile_label(q)

        hit = features[mask]
        for idx, r in hit.iterrows():
            thr_val = float(thr_series.loc[idx]) if pd.notna(thr_series.loc[idx]) else None
            rows.append(
                {
                    **{c: r[c] for c in base_cols if c in r},
                    "event": event_name,
                    "quantile": label,
                    "feature": feature_col,
                    "feature_value": float(r[feature_col]),
                    "threshold": thr_val,
                    "mid": float(r.get("mid", 0)),
                }
            )

    if not rows:
        return pd.DataFrame()
    ev = pd.DataFrame(rows).drop_duplicates(subset=[c for c in ("ts", "event", "quantile") if c in rows[0]])
    return ev.sort_values("ts").reset_index(drop=True)


def _eval_flag(df: pd.DataFrame, expr: str) -> pd.Series:
    """Simple flag expressions via pandas eval."""
    try:
        return df.eval(expr).fillna(False).astype(bool)
    except Exception:
        return pd.Series(False, index=df.index)

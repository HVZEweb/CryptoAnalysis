"""Statistical metrics for feature discovery."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class FeatureScore:
    name: str
    symbol: str
    target: str
    ic: float
    ic_pvalue: float
    mi: float
    corr_pearson: float
    n_samples: int
    rolling_ic_mean: float
    rolling_ic_std: float
    rolling_ic_positive_pct: float
    cross_asset_ic_mean: float = 0.0
    regime_ic_std: float = 0.0

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "symbol": self.symbol,
            "target": self.target,
            "ic": round(self.ic, 4),
            "ic_pvalue": round(self.ic_pvalue, 4),
            "mi": round(self.mi, 4),
            "corr_pearson": round(self.corr_pearson, 4),
            "n_samples": self.n_samples,
            "rolling_ic_mean": round(self.rolling_ic_mean, 4),
            "rolling_ic_std": round(self.rolling_ic_std, 4),
            "rolling_ic_positive_pct": round(self.rolling_ic_positive_pct, 2),
            "cross_asset_ic_mean": round(self.cross_asset_ic_mean, 4),
            "regime_ic_std": round(self.regime_ic_std, 4),
            "score": round(abs(self.ic) * (1 - min(self.rolling_ic_std, 1)) * (self.rolling_ic_positive_pct / 100), 4),
        }


def _rankdata(a: np.ndarray) -> np.ndarray:
    order = a.argsort()
    ranks = np.empty_like(order, dtype=float)
    ranks[order] = np.arange(1, len(a) + 1, dtype=float)
    return ranks


def _spearman_ic(x: pd.Series, y: pd.Series) -> tuple[float, float]:
    mask = x.notna() & y.notna()
    if mask.sum() < 30:
        return 0.0, 1.0
    xv = x[mask].astype(float).values
    yv = y[mask].astype(float).values
    if np.std(xv) < 1e-12 or np.std(yv) < 1e-12:
        return 0.0, 1.0
    rx = _rankdata(xv)
    ry = _rankdata(yv)
    r = float(np.corrcoef(rx, ry)[0, 1])
    if not np.isfinite(r):
        return 0.0, 1.0
    n = len(xv)
    t = r * np.sqrt((n - 2) / max(1e-12, 1 - r * r))
    from math import erf, sqrt

    p = 2 * (1 - 0.5 * (1 + erf(abs(t) / sqrt(2))))
    return r, float(min(1.0, max(0.0, p)))


def mutual_information(x: pd.Series, y: pd.Series, *, bins: int = 10) -> float:
    mask = x.notna() & y.notna()
    if mask.sum() < 50:
        return 0.0
    xv = x[mask].astype(float).values
    yv = y[mask].astype(float).values
    try:
        xb = pd.qcut(xv, q=bins, labels=False, duplicates="drop")
        yb = pd.qcut(yv, q=bins, labels=False, duplicates="drop")
    except ValueError:
        return 0.0
    valid = ~(np.isnan(xb) | np.isnan(yb))
    xb, yb = xb[valid], yb[valid]
    if len(xb) < 30:
        return 0.0
    n = len(xb)
    px = np.bincount(xb.astype(int), minlength=bins) / n
    py = np.bincount(yb.astype(int), minlength=bins) / n
    pxy = np.histogram2d(xb, yb, bins=[bins, bins])[0] / n
    mi = 0.0
    for i in range(bins):
        for j in range(bins):
            if pxy[i, j] > 0 and px[i] > 0 and py[j] > 0:
                mi += pxy[i, j] * np.log(pxy[i, j] / (px[i] * py[j]))
    return float(max(0.0, mi))


def rolling_ic(x: pd.Series, y: pd.Series, *, window: int = 500, step: int = 200) -> tuple[float, float, float]:
    ics: list[float] = []
    n = len(x)
    if n < window + 50:
        ic, _ = _spearman_ic(x, y)
        return ic, 0.0, 100.0 if ic > 0 else 0.0
    for start in range(0, n - window, step):
        ic, _ = _spearman_ic(x.iloc[start : start + window], y.iloc[start : start + window])
        if np.isfinite(ic):
            ics.append(ic)
    if not ics:
        return 0.0, 0.0, 0.0
    arr = np.array(ics)
    return float(np.mean(arr)), float(np.std(arr)), float((arr > 0).mean() * 100)


def score_feature(
    df: pd.DataFrame,
    feature: str,
    target: str,
    *,
    symbol: str,
    regime_col: str | None = "session",
) -> FeatureScore | None:
    if feature not in df.columns or target not in df.columns:
        return None
    x = df[feature]
    y = df[target]
    ic, pval = _spearman_ic(x, y)
    mi = mutual_information(x, y)
    mask = x.notna() & y.notna()
    corr = float(x[mask].corr(y[mask])) if mask.sum() > 10 else 0.0
    ric_mean, ric_std, ric_pos = rolling_ic(x, y)

    regime_std = 0.0
    if regime_col and regime_col in df.columns:
        regime_ics = []
        for label in df[regime_col].dropna().unique():
            sub = df[df[regime_col] == label]
            if len(sub) < 50:
                continue
            ric, _ = _spearman_ic(sub[feature], sub[target])
            regime_ics.append(ric)
        if regime_ics:
            regime_std = float(np.std(regime_ics))

    return FeatureScore(
        name=feature,
        symbol=symbol,
        target=target,
        ic=ic,
        ic_pvalue=pval,
        mi=mi,
        corr_pearson=corr,
        n_samples=int(mask.sum()),
        rolling_ic_mean=ric_mean,
        rolling_ic_std=ric_std,
        rolling_ic_positive_pct=ric_pos,
        regime_ic_std=regime_std,
    )


def rank_features(df: pd.DataFrame, features: list[str], target: str, *, symbol: str) -> list[FeatureScore]:
    scores = []
    for feat in features:
        s = score_feature(df, feat, target, symbol=symbol)
        if s and s.n_samples >= 100:
            scores.append(s)
    return sorted(scores, key=lambda s: abs(s.ic) * (s.rolling_ic_positive_pct / 100), reverse=True)

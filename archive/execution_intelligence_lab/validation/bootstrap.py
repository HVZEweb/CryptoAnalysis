"""Bootstrap significance testing."""

from __future__ import annotations

import numpy as np
import pandas as pd


def bootstrap_mean_pvalue(
    returns: pd.Series,
    *,
    n_samples: int = 2000,
    seed: int = 42,
) -> float:
    r = returns.dropna().astype(float).values
    if len(r) < 5:
        return 1.0
    obs = float(np.mean(r))
    rng = np.random.default_rng(seed)
    boots = [float(np.mean(rng.choice(r, size=len(r), replace=True))) for _ in range(n_samples)]
    if obs >= 0:
        return float((np.array(boots) <= 0).mean())
    return float((np.array(boots) >= 0).mean())

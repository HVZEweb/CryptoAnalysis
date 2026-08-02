"""Statistical significance testing for alpha trade returns."""

from __future__ import annotations

import numpy as np

from alpha.base import SignificanceResult


def bootstrap_significance(
    returns_pct: list[float],
    *,
    n_bootstrap: int = 1000,
    alpha: float = 0.05,
    seed: int = 42,
) -> SignificanceResult:
    if len(returns_pct) < 5:
        return SignificanceResult(bootstrap_samples=n_bootstrap)

    arr = np.array(returns_pct, dtype=float)
    mean = float(np.mean(arr))
    rng = np.random.default_rng(seed)
    boot_means = np.empty(n_bootstrap)
    for i in range(n_bootstrap):
        sample = rng.choice(arr, size=len(arr), replace=True)
        boot_means[i] = float(np.mean(sample))

    ci_low = float(np.percentile(boot_means, 100 * alpha / 2))
    ci_high = float(np.percentile(boot_means, 100 * (1 - alpha / 2)))
    p_value = float(np.mean(boot_means <= 0)) if mean > 0 else float(np.mean(boot_means >= 0))
    significant = (ci_low > 0) if mean > 0 else (ci_high < 0)

    return SignificanceResult(
        mean_return_pct=mean,
        ci_low_pct=ci_low,
        ci_high_pct=ci_high,
        p_value=p_value,
        significant=significant,
        bootstrap_samples=n_bootstrap,
    )

"""Post-load data quality checks."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from alpha.data.archive import DATA_ROOT, dataset_path, load_archive


@dataclass
class QualityResult:
    dataset: str
    path: str
    rows: int
    ok: bool
    gaps: int = 0
    max_gap_ms: float = 0.0
    duplicates: int = 0
    non_monotonic: int = 0
    null_pct: float = 0.0
    issues: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "dataset": self.dataset,
            "path": self.path,
            "rows": self.rows,
            "ok": self.ok,
            "gaps": self.gaps,
            "max_gap_ms": round(self.max_gap_ms, 0),
            "duplicates": self.duplicates,
            "non_monotonic": self.non_monotonic,
            "null_pct": round(self.null_pct, 2),
            "issues": self.issues,
        }


INTERVAL_MS: dict[str, int] = {
    "_oi_5m": 5 * 60 * 1000,
    "_funding": 8 * 3600 * 1000,
    "_orderbook": 2000,
    "_ticker": 1000,
    "_trades": 0,
    "_liquidations": 0,
    "_5m": 5 * 60 * 1000,
    "_3m": 3 * 60 * 1000,
}


def _expected_interval(name: str) -> int | None:
    for suffix, ms in INTERVAL_MS.items():
        if suffix in name:
            return ms if ms > 0 else None
    return None


def _dedup_key_cols(name: str) -> list[str]:
    if "_liquidations" in name:
        return ["ts", "side", "sz"]
    if "_trades" in name and "tradeId" in name:
        return ["tradeId"]
    return ["ts"]


def check_dataframe(df: pd.DataFrame, name: str, *, path: str = "") -> QualityResult:
    result = QualityResult(dataset=name, path=path, rows=len(df), ok=True)

    if df is None or df.empty:
        result.ok = False
        result.issues.append("empty dataset")
        return result

    ts_col = "ts" if "ts" in df.columns else ("timestamp" if "timestamp" in df.columns else None)
    if ts_col:
        ts = pd.to_numeric(df[ts_col], errors="coerce")
        null_ts = int(ts.isna().sum())
        if null_ts:
            result.issues.append(f"{null_ts} invalid timestamps")
            result.ok = False

        ts_valid = ts.dropna().astype(np.int64)
        if len(ts_valid) > 1:
            diffs = ts_valid.diff().dropna()
            non_mono = int((diffs < 0).sum())
            if non_mono:
                result.non_monotonic = non_mono
                result.issues.append(f"{non_mono} non-monotonic timestamps")
                result.ok = False

            interval = _expected_interval(name)
            if interval:
                big_gaps = diffs[diffs > interval * 2]
                result.gaps = len(big_gaps)
                if len(big_gaps):
                    result.max_gap_ms = float(big_gaps.max())
                    if result.gaps > 5:
                        result.issues.append(f"{result.gaps} gaps > 2× expected interval")
                        result.ok = False

        keys = [k for k in _dedup_key_cols(name) if k in df.columns]
        if keys:
            dupes = int(df.duplicated(subset=keys).sum())
            result.duplicates = dupes
            if dupes:
                result.issues.append(f"{dupes} duplicate keys")
                result.ok = False

    numeric = df.select_dtypes(include=[np.number])
    if not numeric.empty:
        null_pct = float(numeric.isna().mean().mean() * 100)
        result.null_pct = null_pct
        if null_pct > 5:
            result.issues.append(f"{null_pct:.1f}% null numeric values")
            result.ok = False

    return result


def check_dataset(name: str) -> QualityResult:
    path = str(dataset_path(name))
    df = load_archive(name)
    if df is None:
        return QualityResult(dataset=name, path=path, rows=0, ok=False, issues=["file missing"])
    return check_dataframe(df, name, path=path)


def check_ohlcv_file(path: Path) -> QualityResult:
    import pandas as pd

    name = path.stem
    if not path.exists():
        return QualityResult(dataset=name, path=str(path), rows=0, ok=False, issues=["file missing"])
    try:
        df = pd.read_csv(path)
    except Exception as e:
        return QualityResult(dataset=name, path=str(path), rows=0, ok=False, issues=[str(e)])
    return check_dataframe(df, name, path=str(path))


def run_all_quality_checks() -> list[QualityResult]:
    from pathlib import Path

    from research.data_loader import DATA_DIR

    results: list[QualityResult] = []

    if DATA_ROOT.exists():
        for f in sorted(DATA_ROOT.glob("*.csv")):
            results.append(check_dataset(f.stem))

    if DATA_DIR.exists():
        for f in sorted(DATA_DIR.glob("*.csv")):
            results.append(check_ohlcv_file(f))

    return results


def quality_summary(results: list[QualityResult]) -> dict[str, Any]:
    failed = [r for r in results if not r.ok]
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "total": len(results),
        "passed": len(results) - len(failed),
        "failed": len(failed),
        "results": [r.to_dict() for r in results],
    }

"""Append-only local archive — never delete historical rows."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

log = logging.getLogger("alpha.archive")

DATA_ROOT = Path(__file__).resolve().parents[2] / "data" / "alpha"
MANIFEST_PATH = DATA_ROOT / "manifest.json"

# Dedup keys per dataset suffix pattern
DEDUP_KEYS: dict[str, list[str]] = {
    "_funding": ["ts"],
    "_oi_5m": ["ts"],
    "_liquidations": ["ts", "side", "sz"],
    "_orderbook": ["ts"],
    "_trades": ["tradeId"],
    "_ticker": ["ts"],
}


def dataset_path(name: str) -> Path:
    return DATA_ROOT / f"{name}.csv"


def _dedup_keys(name: str) -> list[str]:
    for suffix, keys in DEDUP_KEYS.items():
        if name.endswith(suffix):
            return keys
    return ["ts"]


def load_archive(name: str) -> pd.DataFrame | None:
    path = dataset_path(name)
    if not path.exists():
        return None
    try:
        return pd.read_csv(path)
    except Exception as e:
        log.warning("Failed to read archive %s: %s", name, e)
        return None


def last_timestamp(name: str, *, col: str = "ts") -> int | None:
    df = load_archive(name)
    if df is None or df.empty or col not in df.columns:
        return None
    return int(df[col].max())


def append_dataset(name: str, new_df: pd.DataFrame, *, sort_col: str = "ts") -> Path:
    """Merge new rows into archive; deduplicate; never remove existing rows."""
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    path = dataset_path(name)
    keys = _dedup_keys(name)

    if new_df is None or new_df.empty:
        if path.exists():
            _update_manifest(name, pd.read_csv(path))
            return path
        return path

    existing = load_archive(name)
    if existing is not None and not existing.empty:
        combined = pd.concat([existing, new_df], ignore_index=True)
    else:
        combined = new_df.copy()

    avail_keys = [k for k in keys if k in combined.columns]
    if avail_keys:
        combined = combined.drop_duplicates(subset=avail_keys, keep="last")
    if sort_col in combined.columns:
        combined = combined.sort_values(sort_col).reset_index(drop=True)

    combined.to_csv(path, index=False)
    _update_manifest(name, combined)
    log.info("Archive %s: %d rows (+%d new)", name, len(combined), len(new_df))
    return path


def save_dataset(df: pd.DataFrame, name: str) -> Path:
    """Backward-compatible alias — always appends, never overwrites history."""
    return append_dataset(name, df)


def _update_manifest(name: str, df: pd.DataFrame) -> None:
    manifest: dict[str, Any] = {}
    if MANIFEST_PATH.exists():
        try:
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}

    datasets: dict[str, Any] = manifest.setdefault("datasets", {})
    ts_col = "ts" if "ts" in df.columns else None
    entry: dict[str, Any] = {
        "rows": len(df),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "path": str(dataset_path(name)),
    }
    if ts_col and not df.empty:
        entry["from"] = pd.to_datetime(df[ts_col].min(), unit="ms", utc=True).isoformat()
        entry["to"] = pd.to_datetime(df[ts_col].max(), unit="ms", utc=True).isoformat()
        span_ms = int(df[ts_col].max()) - int(df[ts_col].min())
        entry["span_days"] = round(span_ms / (86400 * 1000), 2)

    datasets[name] = entry
    manifest["last_archive_run"] = datetime.now(timezone.utc).isoformat()
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

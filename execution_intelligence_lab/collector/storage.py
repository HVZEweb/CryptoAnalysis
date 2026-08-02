"""Append-only Parquet storage for Execution Intelligence Lab."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

log = logging.getLogger("eil.storage")


class ParquetStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._buffers: dict[str, list[dict[str, Any]]] = {}

    def _path(self, kind: str, symbol: str, ts_ms: int) -> Path:
        day = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        safe = symbol.replace("-", "_")
        folder = self.root / kind / safe
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f"{day}.parquet"

    def buffer(self, kind: str, row: dict[str, Any]) -> None:
        sym = row.get("inst_id") or row.get("symbol") or "unknown"
        key = f"{kind}:{sym}"
        self._buffers.setdefault(key, []).append(row)

    def flush_key(self, key: str) -> int:
        rows = self._buffers.pop(key, [])
        if not rows:
            return 0
        kind, symbol = key.split(":", 1)
        return self._append_rows(kind, symbol, rows)

    def flush_all(self) -> int:
        keys = list(self._buffers.keys())
        return sum(self.flush_key(k) for k in keys)

    def _append_rows(self, kind: str, symbol: str, rows: list[dict[str, Any]]) -> int:
        df_new = pd.DataFrame(rows)
        ts_col = "ts" if "ts" in df_new.columns else "timestamp"
        if ts_col not in df_new.columns:
            return 0
        df_new = df_new.sort_values(ts_col).reset_index(drop=True)
        df_new["_utc_day"] = pd.to_datetime(df_new[ts_col], unit="ms", utc=True).dt.strftime("%Y-%m-%d")
        total = 0
        for day, group in df_new.groupby("_utc_day", sort=True):
            chunk = group.drop(columns=["_utc_day"])
            total += self._append_rows_for_day(kind, symbol, str(day), chunk, ts_col)
        return total

    def _append_rows_for_day(
        self, kind: str, symbol: str, day: str, df_new: pd.DataFrame, ts_col: str
    ) -> int:
        if df_new.empty:
            return 0
        safe = symbol.replace("-", "_")
        folder = self.root / kind / safe
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{day}.parquet"
        if path.exists():
            df_old = pd.read_parquet(path)
            df = pd.concat([df_old, df_new], ignore_index=True)
            dedup = [c for c in ("ts", "trade_id", "seq_id") if c in df.columns]
            if dedup:
                df = df.drop_duplicates(subset=dedup, keep="last")
            else:
                df = df.drop_duplicates(subset=[ts_col], keep="last")
        else:
            df = df_new
        df = df.sort_values(ts_col).reset_index(drop=True)
        df.to_parquet(path, index=False, engine="pyarrow")
        return len(df_new)

    def list_files(self, kind: str, symbol: str | None = None) -> list[Path]:
        base = self.root / kind
        if not base.exists():
            return []
        if symbol:
            folder = base / symbol.replace("-", "_")
            return sorted(folder.glob("*.parquet")) if folder.exists() else []
        return sorted(base.rglob("*.parquet"))

    def load(self, kind: str, symbol: str, *, start_day: str | None = None) -> pd.DataFrame:
        files = self.list_files(kind, symbol)
        if start_day:
            files = [f for f in files if f.stem >= start_day]
        if not files:
            return pd.DataFrame()
        parts = [pd.read_parquet(f) for f in files]
        out = pd.concat(parts, ignore_index=True)
        if "ts" in out.columns:
            out = out.sort_values("ts").reset_index(drop=True)
        return out

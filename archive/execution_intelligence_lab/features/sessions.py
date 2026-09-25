"""UTC session labeling for cross-session validation."""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from config import Config


def session_from_ts(ts_ms: int, config: Config) -> str:
    hour = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).hour
    for name, (start, end) in config.sessions_utc.items():
        if start <= hour < end:
            return name
    return "other"


def add_session_column(df: pd.DataFrame, config: Config) -> pd.DataFrame:
    if df.empty or "ts" not in df.columns:
        return df
    out = df.copy()
    out["session"] = [session_from_ts(int(t), config) for t in out["ts"]]
    out["utc_day"] = [
        datetime.fromtimestamp(int(t) / 1000, tz=timezone.utc).strftime("%Y-%m-%d") for t in out["ts"]
    ]
    return out

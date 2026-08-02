"""OHLCV candle utilities."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Candle:
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float


def parse_ohlcv(raw: list[list[float]]) -> list[Candle]:
    out: list[Candle] = []
    for row in raw:
        if len(row) < 6:
            continue
        out.append(
            Candle(
                ts=int(row[0]),
                open=float(row[1]),
                high=float(row[2]),
                low=float(row[3]),
                close=float(row[4]),
                volume=float(row[5]),
            )
        )
    return out

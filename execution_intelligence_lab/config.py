"""Execution Intelligence Lab — standalone configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent
load_dotenv(_ROOT.parent / ".env")
load_dotenv(_ROOT / ".env")


@dataclass
class Config:
    ws_public_url: str = "wss://ws.okx.com:8443/ws/v5/public"
    rest_base: str = "https://www.okx.com"
    data_dir: Path = field(default_factory=lambda: _ROOT / "data")
    results_dir: Path = field(default_factory=lambda: _ROOT / "results")
    symbols: list[str] = field(
        default_factory=lambda: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    )
    book_channel: str = "books"
    book_depth: int = 25
    flush_interval_sec: float = 30.0
    funding_poll_sec: float = 300.0
    oi_poll_sec: float = 60.0
    reconnect_delay_sec: float = 5.0
    taker_fee_bps: float = 5.0
    slippage_bps: float = 1.0
    event_horizons_sec: tuple[int, ...] = (5, 10, 30, 60, 120, 300)
    quantile_tails: tuple[float, ...] = (0.99, 0.95, 0.90, 0.01, 0.05, 0.10)
    oos_holdout_pct: float = 0.25
    bootstrap_samples: int = 2000
    min_events_per_symbol: int = 15
    required_symbols: tuple[str, ...] = ("BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP")
    sessions_utc: dict[str, tuple[int, int]] = field(
        default_factory=lambda: {
            "asia": (0, 8),
            "europe": (8, 16),
            "us": (16, 24),
        }
    )

    @classmethod
    def from_env(cls) -> Config:
        symbols_raw = os.getenv("EIL_SYMBOLS", "BTC-USDT-SWAP,ETH-USDT-SWAP,SOL-USDT-SWAP")
        symbols = [s.strip() for s in symbols_raw.split(",") if s.strip()]
        return cls(
            ws_public_url=os.getenv("EIL_WS_URL", "wss://ws.okx.com:8443/ws/v5/public"),
            rest_base=os.getenv("EIL_REST_BASE", "https://www.okx.com").rstrip("/"),
            data_dir=Path(os.getenv("EIL_DATA_DIR", str(_ROOT / "data"))),
            results_dir=Path(os.getenv("EIL_RESULTS_DIR", str(_ROOT / "results"))),
            symbols=symbols,
            book_channel=os.getenv("EIL_BOOK_CHANNEL", "books"),
            flush_interval_sec=float(os.getenv("EIL_FLUSH_SEC", "30")),
            taker_fee_bps=float(os.getenv("EIL_TAKER_FEE_BPS", "5")),
            slippage_bps=float(os.getenv("EIL_SLIPPAGE_BPS", "1")),
        )


def get_config() -> Config:
    return Config.from_env()

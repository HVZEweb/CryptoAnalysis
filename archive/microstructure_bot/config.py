"""Configuration — standalone, no dependency on Unified Trading Bot."""

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
    """OKX USDT-M Futures microstructure platform settings."""

    ws_public_url: str = "wss://ws.okx.com:8443/ws/v5/public"
    rest_base: str = "https://www.okx.com"
    data_dir: Path = field(default_factory=lambda: _ROOT / "data")
    symbols: list[str] = field(default_factory=lambda: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"])
    book_channel: str = "books"  # books | books5
    book_depth: int = 25
    flush_interval_sec: float = 30.0
    flush_rows: int = 500
    reconnect_delay_sec: float = 5.0
    # Paper / execution
    taker_fee_bps: float = 5.0
    maker_fee_bps: float = 2.0
    slippage_bps: float = 1.0
    latency_ms: int = 50
    # Research — Phase 2 horizons
    event_horizons_sec: tuple[int, ...] = (1, 3, 5, 10, 30, 60, 300)
    quantile_tails: tuple[float, ...] = (0.99, 0.95, 0.90)
    oos_holdout_pct: float = 0.25
    bootstrap_samples: int = 2000
    min_events_per_type: int = 20
    required_symbols: tuple[str, ...] = ("BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP")

    @classmethod
    def from_env(cls) -> Config:
        symbols_raw = os.getenv("MSB_SYMBOLS", "BTC-USDT-SWAP,ETH-USDT-SWAP,SOL-USDT-SWAP")
        symbols = [s.strip() for s in symbols_raw.split(",") if s.strip()]
        data_dir = Path(os.getenv("MSB_DATA_DIR", str(_ROOT / "data")))
        return cls(
            ws_public_url=os.getenv("MSB_WS_URL", "wss://ws.okx.com:8443/ws/v5/public"),
            rest_base=os.getenv("MSB_REST_BASE", "https://www.okx.com").rstrip("/"),
            data_dir=data_dir,
            symbols=symbols,
            book_channel=os.getenv("MSB_BOOK_CHANNEL", "books"),
            flush_interval_sec=float(os.getenv("MSB_FLUSH_SEC", "30")),
            taker_fee_bps=float(os.getenv("MSB_TAKER_FEE_BPS", "5")),
            slippage_bps=float(os.getenv("MSB_SLIPPAGE_BPS", "1")),
            latency_ms=int(os.getenv("MSB_LATENCY_MS", "50")),
        )


def get_config() -> Config:
    return Config.from_env()

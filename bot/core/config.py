"""Unified bot configuration — OKX USDT-M futures, paper/live modes."""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT = Path(__file__).resolve().parents[2]


class TradingMode(str, Enum):
    PAPER = "paper"
    LIVE = "live"


class StrategyName(str, Enum):
    HFT_ORDERBOOK = "hft_orderbook"
    QUANT_SCALPING = "quant_scalping"
    AI_PREDICTOR = "ai_predictor"
    META = "meta"


class MarketRegime(str, Enum):
    HIGH_VOLATILITY = "high_volatility"
    FLAT = "flat"
    TRENDING = "trending"
    UNKNOWN = "unknown"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # OKX
    okx_api_key: str = Field(default="", validation_alias="OKX_API_KEY")
    okx_secret_key: str = Field(default="", validation_alias="OKX_SECRET_KEY")
    okx_passphrase: str = Field(default="", validation_alias="OKX_PASSPHRASE")
    okx_demo: bool = Field(default=False, validation_alias="OKX_DEMO")
    okx_rest_base: str = Field(default="https://www.okx.com", validation_alias="OKX_REST_BASE")
    okx_ws_url: str = Field(default="wss://ws.okx.com:8443/ws/v5/public", validation_alias="OKX_WS_URL")
    okx_ws_demo_url: str = Field(
        default="wss://wspap.okx.com:8443/ws/v5/public", validation_alias="OKX_WS_DEMO_URL"
    )

    # Runtime
    trading_mode: TradingMode = Field(default=TradingMode.PAPER, validation_alias="TRADING_MODE")
    trading_active_strategy: StrategyName = Field(
        default=StrategyName.META, validation_alias="TRADING_ACTIVE_STRATEGY"
    )
    trading_enabled_strategies: str = Field(
        default="hft_orderbook,quant_scalping,ai_predictor", validation_alias="TRADING_ENABLED_STRATEGIES"
    )
    trading_http_host: str = Field(default="127.0.0.1", validation_alias="TRADING_HTTP_HOST")
    trading_http_port: int = Field(default=8765, validation_alias="TRADING_HTTP_PORT")
    trading_paper_balance: float = Field(default=1000.0, validation_alias="TRADING_PAPER_BALANCE")
    trading_leverage: int = Field(default=5, validation_alias="TRADING_LEVERAGE")

    # Scanner
    trading_scan_interval_sec: int = Field(default=30, validation_alias="TRADING_SCAN_INTERVAL_SEC")
    trading_top_pairs: int = Field(default=5, validation_alias="TRADING_TOP_PAIRS")
    trading_universe_size: int = Field(default=100, validation_alias="TRADING_UNIVERSE_SIZE")
    trading_min_volume_usd: float = Field(default=200_000, validation_alias="TRADING_MIN_VOLUME_USD")
    trading_max_volume_usd: float = Field(default=20_000_000, validation_alias="TRADING_MAX_VOLUME_USD")

    # Orderbook / HFT
    trading_min_density_usd: float = Field(default=15_000, validation_alias="TRADING_MIN_DENSITY_USD")
    trading_anomaly_multiplier: float = Field(default=3.0, validation_alias="TRADING_ANOMALY_MULTIPLIER")
    trading_min_spread_pct: float = Field(default=0.02, validation_alias="TRADING_MIN_SPREAD_PCT")
    trading_max_spread_pct: float = Field(default=0.8, validation_alias="TRADING_MAX_SPREAD_PCT")
    trading_min_score: float = Field(default=75.0, validation_alias="TRADING_MIN_SCORE")
    trading_min_ev_usd: float = Field(default=0.05, validation_alias="TRADING_MIN_EV_USD")
    trading_notional_usd: float = Field(default=25.0, validation_alias="TRADING_NOTIONAL_USD")
    trading_reposition_tolerance_pct: float = Field(
        default=0.03, validation_alias="TRADING_REPOSITION_TOLERANCE_PCT"
    )

    # Quant scalping
    trading_tp_pct: float = Field(default=0.45, validation_alias="TRADING_TP_PCT")
    trading_sl_pct: float = Field(default=0.25, validation_alias="TRADING_SL_PCT")
    trading_trailing_pct: float = Field(default=0.20, validation_alias="TRADING_TRAILING_PCT")
    trading_rsi_low: float = Field(default=35.0, validation_alias="TRADING_RSI_LOW")
    trading_rsi_high: float = Field(default=65.0, validation_alias="TRADING_RSI_HIGH")

    # AI filter
    trading_ai_min_confidence: float = Field(default=60.0, validation_alias="TRADING_AI_MIN_CONFIDENCE")
    openrouter_api_key: str = Field(default="", validation_alias="OPENROUTER_API_KEY")
    openrouter_model: str = Field(default="kr/claude-sonnet-4.5", validation_alias="OPENROUTER_MODEL")
    openrouter_fallback_models: str = Field(default="", validation_alias="OPENROUTER_FALLBACK_MODELS")

    # Fees
    trading_maker_fee_pct: float = Field(default=0.02, validation_alias="TRADING_MAKER_FEE_PCT")
    trading_taker_fee_pct: float = Field(default=0.05, validation_alias="TRADING_TAKER_FEE_PCT")
    trading_slippage_pct: float = Field(default=0.03, validation_alias="TRADING_SLIPPAGE_PCT")
    trading_funding_pct: float = Field(default=0.01, validation_alias="TRADING_FUNDING_PCT")

    # Risk
    trading_max_risk_per_trade_pct: float = Field(
        default=1.0, validation_alias="TRADING_MAX_RISK_PER_TRADE_PCT"
    )
    trading_max_daily_loss_pct: float = Field(default=5.0, validation_alias="TRADING_MAX_DAILY_LOSS_PCT")
    trading_max_drawdown_pct: float = Field(default=10.0, validation_alias="TRADING_MAX_DRAWDOWN_PCT")
    trading_max_positions: int = Field(default=3, validation_alias="TRADING_MAX_POSITIONS")
    trading_max_correlated_positions: int = Field(default=2, validation_alias="TRADING_MAX_CORRELATED_POSITIONS")
    trading_flash_move_pct: float = Field(default=2.0, validation_alias="TRADING_FLASH_MOVE_PCT")
    trading_emergency_stop: bool = Field(default=False, validation_alias="TRADING_EMERGENCY_STOP")
    trading_liquidation_buffer_pct: float = Field(
        default=15.0, validation_alias="TRADING_LIQUIDATION_BUFFER_PCT"
    )

    # DB
    db_host: str = Field(default="localhost", validation_alias="DB_HOST")
    db_port: int = Field(default=3306, validation_alias="DB_PORT")
    db_user: str = Field(default="root", validation_alias="DB_USER")
    db_password: str = Field(default="", validation_alias="DB_PASSWORD")
    db_name: str = Field(default="crypto_predictor", validation_alias="DB_NAME")

    # Loops
    trading_hunt_interval_sec: float = Field(default=1.0, validation_alias="TRADING_HUNT_INTERVAL_SEC")
    trading_position_interval_sec: float = Field(default=0.25, validation_alias="TRADING_POSITION_INTERVAL_SEC")
    trading_sync_interval_sec: float = Field(default=5.0, validation_alias="TRADING_SYNC_INTERVAL_SEC")

    # Exchange / production
    trading_api_max_retries: int = Field(default=3, validation_alias="TRADING_API_MAX_RETRIES")
    trading_api_min_interval_ms: float = Field(default=50.0, validation_alias="TRADING_API_MIN_INTERVAL_MS")
    trading_rate_limit_cooldown_sec: float = Field(default=2.0, validation_alias="TRADING_RATE_LIMIT_COOLDOWN_SEC")
    trading_desync_threshold_pct: float = Field(default=0.15, validation_alias="TRADING_DESYNC_THRESHOLD_PCT")
    trading_ws_stale_ms: int = Field(default=5000, validation_alias="TRADING_WS_STALE_MS")

    @property
    def enabled_strategies(self) -> list[StrategyName]:
        names: list[StrategyName] = []
        for raw in self.trading_enabled_strategies.split(","):
            raw = raw.strip()
            if not raw:
                continue
            try:
                names.append(StrategyName(raw))
            except ValueError:
                continue
        return names or [StrategyName.HFT_ORDERBOOK]

    @property
    def database_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def ws_url(self) -> str:
        return self.okx_ws_demo_url if self.okx_demo else self.okx_ws_url

    def is_live(self) -> bool:
        return self.trading_mode == TradingMode.LIVE


@lru_cache
def get_settings() -> Settings:
    return Settings()

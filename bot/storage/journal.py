"""Decision journal — structured logging for every trade lifecycle event."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from core.models import ManagedPosition, TradeIntent

log = logging.getLogger("trading_bot.journal")


class TradeJournal:
    async def log_rejected(self, intent: TradeIntent, reason: str) -> None:
        payload = {
            "event": "rejected",
            "ts": datetime.utcnow().isoformat(),
            "strategy": intent.strategy,
            "symbol": intent.symbol,
            "side": intent.side,
            "confidence": intent.confidence,
            "expected_value": intent.expected_value,
            "reason": reason,
            "signals": intent.signals,
        }
        log.info("REJECTED %s", json.dumps(payload, default=str)[:500])

    async def log_entry(
        self,
        intent: TradeIntent,
        pos: ManagedPosition,
        market_ctx: dict[str, Any] | None = None,
        slippage_pct: float = 0.0,
    ) -> None:
        payload = {
            "event": "entry",
            "ts": datetime.utcnow().isoformat(),
            "trade_id": pos.trade_id,
            "strategy": intent.strategy,
            "symbol": intent.symbol,
            "side": intent.side,
            "entry_price": pos.entry_price,
            "leverage": pos.leverage,
            "confidence": intent.confidence,
            "expected_value": intent.expected_value,
            "ai_probability": intent.ai_probability,
            "slippage_pct": slippage_pct,
            "signals": intent.signals,
            "book_snapshot": intent.book_snapshot,
            "funding_rate": (market_ctx or {}).get("funding_rate"),
            "open_interest": (market_ctx or {}).get("open_interest"),
            "spread_pct": (market_ctx or {}).get("spread_pct"),
            "volatility_pct": (market_ctx or {}).get("volatility_pct"),
        }
        log.info("ENTRY %s", json.dumps(payload, default=str)[:800])

    async def log_exit(
        self,
        pos: ManagedPosition,
        exit_price: float,
        pnl: float,
        reason: str,
        partial_pct: float = 100.0,
    ) -> None:
        hold_ms = int(datetime.utcnow().timestamp() * 1000) - pos.opened_at_ms
        payload = {
            "event": "exit",
            "ts": datetime.utcnow().isoformat(),
            "trade_id": pos.trade_id,
            "strategy": pos.strategy,
            "symbol": pos.symbol,
            "side": pos.side,
            "exit_price": exit_price,
            "pnl_usd": pnl,
            "exit_reason": reason,
            "partial_pct": partial_pct,
            "hold_ms": hold_ms,
            "hold_min": round(hold_ms / 60_000, 2),
            "leverage": pos.leverage,
            "metadata": pos.metadata,
        }
        log.info("EXIT %s", json.dumps(payload, default=str)[:600])

    def snapshot(self) -> dict[str, Any]:
        return {"ts": datetime.utcnow().isoformat()}

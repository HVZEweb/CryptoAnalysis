"""Unified trades persistence with full analytics fields."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, DateTime, Float, Integer, String, Text, inspect, text
from sqlalchemy.orm import Session

from storage.database import Base, get_engine, get_session_factory

log = logging.getLogger("trading_bot.trades")

# Columns added in Stage 2 — migrated onto existing MySQL tables.
_EXTRA_COLUMNS: dict[str, str] = {
    "leverage": "FLOAT DEFAULT 1",
    "pnl_pct": "FLOAT DEFAULT 0",
    "slippage_pct": "FLOAT DEFAULT 0",
    "slippage_usd": "FLOAT DEFAULT 0",
    "funding_rate": "FLOAT DEFAULT 0",
    "open_interest": "FLOAT DEFAULT 0",
    "spread_pct": "FLOAT DEFAULT 0",
    "volatility_pct": "FLOAT DEFAULT 0",
    "pnl_pct": "FLOAT DEFAULT 0",
    "market_context_json": "JSON",
    "exit_context_json": "JSON",
}


class TradeRecord(Base):
    __tablename__ = "trading_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trade_uuid = Column(String(64), unique=True, nullable=False, index=True)
    symbol = Column(String(32), nullable=False, index=True)
    side = Column(String(8), nullable=False)
    strategy = Column(String(32), nullable=False, index=True)
    status = Column(String(16), default="open")
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float, nullable=True)
    size = Column(Float, nullable=False)
    notional_usd = Column(Float, default=0)
    pnl_usd = Column(Float, default=0)
    pnl_pct = Column(Float, default=0)
    fees_usd = Column(Float, default=0)
    slippage_pct = Column(Float, default=0)
    slippage_usd = Column(Float, default=0)
    leverage = Column(Float, default=1)
    confidence = Column(Float, default=0)
    expected_value = Column(Float, default=0)
    risk_decision = Column(String(128), default="")
    entry_reason = Column(Text, default="")
    exit_reason = Column(Text, default="")
    signals_json = Column(JSON, nullable=True)
    book_snapshot_json = Column(JSON, nullable=True)
    market_context_json = Column(JSON, nullable=True)
    exit_context_json = Column(JSON, nullable=True)
    ai_probability = Column(Float, nullable=True)
    funding_rate = Column(Float, default=0)
    open_interest = Column(Float, default=0)
    spread_pct = Column(Float, default=0)
    volatility_pct = Column(Float, default=0)
    hold_ms = Column(Integer, default=0)
    opened_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)


class AnalyticsSnapshot(Base):
    """Periodic aggregate metrics snapshot."""

    __tablename__ = "trading_analytics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    computed_at = Column(DateTime, default=datetime.utcnow, index=True)
    strategy = Column(String(32), default="all", index=True)
    trades = Column(Integer, default=0)
    win_rate = Column(Float, default=0)
    profit_factor = Column(Float, default=0)
    expectancy_usd = Column(Float, default=0)
    sharpe_ratio = Column(Float, default=0)
    sortino_ratio = Column(Float, default=0)
    calmar_ratio = Column(Float, default=0)
    max_drawdown_pct = Column(Float, default=0)
    recovery_factor = Column(Float, default=0)
    avg_win_usd = Column(Float, default=0)
    avg_loss_usd = Column(Float, default=0)
    avg_hold_min = Column(Float, default=0)
    total_pnl_usd = Column(Float, default=0)
    metrics_json = Column(JSON, nullable=True)


class TradeRepository:
    def __init__(self) -> None:
        self._factory = get_session_factory()
        self._ensure_tables()

    def _ensure_tables(self) -> None:
        engine = get_engine()
        Base.metadata.create_all(engine)
        self._migrate_columns(engine)

    def _migrate_columns(self, engine: Any) -> None:
        try:
            insp = inspect(engine)
            if not insp.has_table("trading_trades"):
                return
            existing = {c["name"] for c in insp.get_columns("trading_trades")}
            with engine.connect() as conn:
                for col, typedef in _EXTRA_COLUMNS.items():
                    if col not in existing:
                        conn.execute(text(f"ALTER TABLE trading_trades ADD COLUMN {col} {typedef}"))
                        log.info("Migrated column trading_trades.%s", col)
                conn.commit()
        except Exception as e:
            log.warning("Schema migration skipped: %s", e)

    def _session(self) -> Session:
        return self._factory()

    async def save_open(
        self,
        *,
        trade_id: str,
        symbol: str,
        side: str,
        strategy: str,
        entry_price: float,
        size: float,
        notional_usd: float,
        confidence: float,
        expected_value: float,
        signals: dict[str, Any] | None,
        book_snapshot: dict[str, Any] | None,
        ai_probability: float | None,
        risk_decision: str,
        leverage: float = 1.0,
        market_context: dict[str, Any] | None = None,
        fees_usd: float = 0.0,
    ) -> None:
        ctx = market_context or {}
        with self._session() as s:
            rec = TradeRecord(
                trade_uuid=trade_id,
                symbol=symbol,
                side=side,
                strategy=strategy,
                status="open",
                entry_price=entry_price,
                size=size,
                notional_usd=notional_usd,
                leverage=leverage,
                confidence=confidence,
                expected_value=expected_value,
                risk_decision=risk_decision,
                entry_reason=json.dumps(signals or {}, default=str)[:2000],
                signals_json=signals,
                book_snapshot_json=book_snapshot,
                market_context_json=ctx,
                ai_probability=ai_probability,
                funding_rate=float(ctx.get("funding_rate") or 0),
                open_interest=float(ctx.get("open_interest") or 0),
                spread_pct=float(ctx.get("spread_pct") or 0),
                volatility_pct=float(ctx.get("volatility_pct") or 0),
                fees_usd=fees_usd,
            )
            s.add(rec)
            s.commit()

    async def save_close(
        self,
        *,
        trade_id: str,
        exit_price: float,
        pnl_usd: float,
        exit_reason: str,
        hold_ms: int,
        fees_usd: float = 0.0,
        slippage_pct: float = 0.0,
        slippage_usd: float = 0.0,
        pnl_pct: float = 0.0,
        exit_context: dict[str, Any] | None = None,
    ) -> None:
        with self._session() as s:
            rec = s.query(TradeRecord).filter_by(trade_uuid=trade_id).first()
            if not rec:
                return
            rec.exit_price = exit_price
            rec.pnl_usd = pnl_usd
            rec.pnl_pct = pnl_pct
            rec.fees_usd = (rec.fees_usd or 0) + fees_usd
            rec.slippage_pct = slippage_pct
            rec.slippage_usd = slippage_usd
            rec.exit_reason = exit_reason
            rec.exit_context_json = exit_context
            rec.hold_ms = hold_ms
            rec.status = "closed"
            rec.closed_at = datetime.utcnow()
            s.commit()

    def save_analytics_snapshot(self, strategy: str, metrics: dict[str, Any]) -> None:
        with self._session() as s:
            snap = AnalyticsSnapshot(
                strategy=strategy,
                trades=int(metrics.get("trades") or 0),
                win_rate=float(metrics.get("win_rate") or 0),
                profit_factor=float(metrics.get("profit_factor") or 0),
                expectancy_usd=float(metrics.get("expectancy_usd") or 0),
                sharpe_ratio=float(metrics.get("sharpe_ratio") or 0),
                sortino_ratio=float(metrics.get("sortino_ratio") or 0),
                calmar_ratio=float(metrics.get("calmar_ratio") or 0),
                max_drawdown_pct=float(metrics.get("max_drawdown_pct") or 0),
                recovery_factor=float(metrics.get("recovery_factor") or 0),
                avg_win_usd=float(metrics.get("avg_win_usd") or 0),
                avg_loss_usd=float(metrics.get("avg_loss_usd") or 0),
                avg_hold_min=float(metrics.get("avg_hold_min") or 0),
                total_pnl_usd=float(metrics.get("total_pnl_usd") or 0),
                metrics_json=metrics,
            )
            s.add(snap)
            s.commit()

    def list_trades(self, limit: int = 50, strategy: str | None = None) -> list[dict[str, Any]]:
        with self._session() as s:
            q = s.query(TradeRecord).order_by(TradeRecord.opened_at.desc())
            if strategy and strategy != "all":
                q = q.filter(TradeRecord.strategy == strategy)
            rows = q.limit(limit).all()
            return [self._to_dict(r) for r in rows]

    def list_open(self) -> list[dict[str, Any]]:
        with self._session() as s:
            rows = s.query(TradeRecord).filter_by(status="open").all()
            return [self._to_dict(r) for r in rows]

    def get_trade(self, trade_uuid: str) -> dict[str, Any] | None:
        with self._session() as s:
            rec = s.query(TradeRecord).filter_by(trade_uuid=trade_uuid).first()
            return self._to_dict(rec) if rec else None

    def list_analytics_snapshots(self, limit: int = 30) -> list[dict[str, Any]]:
        with self._session() as s:
            rows = s.query(AnalyticsSnapshot).order_by(AnalyticsSnapshot.computed_at.desc()).limit(limit).all()
            return [
                {
                    "computed_at": r.computed_at.isoformat() if r.computed_at else None,
                    "strategy": r.strategy,
                    "trades": r.trades,
                    "win_rate": r.win_rate,
                    "profit_factor": r.profit_factor,
                    "expectancy_usd": r.expectancy_usd,
                    "sharpe_ratio": r.sharpe_ratio,
                    "total_pnl_usd": r.total_pnl_usd,
                    "metrics": r.metrics_json,
                }
                for r in rows
            ]

    @staticmethod
    def _to_dict(r: TradeRecord) -> dict[str, Any]:
        return {
            "trade_uuid": r.trade_uuid,
            "symbol": r.symbol,
            "side": r.side,
            "strategy": r.strategy,
            "status": r.status,
            "entry_price": r.entry_price,
            "exit_price": r.exit_price,
            "size": r.size,
            "notional_usd": r.notional_usd,
            "leverage": r.leverage,
            "pnl_usd": r.pnl_usd,
            "pnl_pct": r.pnl_pct,
            "fees_usd": r.fees_usd,
            "slippage_pct": r.slippage_pct,
            "slippage_usd": r.slippage_usd,
            "confidence": r.confidence,
            "expected_value": r.expected_value,
            "risk_decision": r.risk_decision,
            "entry_reason": r.entry_reason,
            "exit_reason": r.exit_reason,
            "signals": r.signals_json,
            "book_snapshot": r.book_snapshot_json,
            "market_context": r.market_context_json,
            "exit_context": r.exit_context_json,
            "ai_probability": r.ai_probability,
            "funding_rate": r.funding_rate,
            "open_interest": r.open_interest,
            "spread_pct": r.spread_pct,
            "volatility_pct": r.volatility_pct,
            "hold_ms": r.hold_ms,
            "hold_min": round((r.hold_ms or 0) / 60_000, 2),
            "opened_at": r.opened_at.isoformat() if r.opened_at else None,
            "closed_at": r.closed_at.isoformat() if r.closed_at else None,
        }

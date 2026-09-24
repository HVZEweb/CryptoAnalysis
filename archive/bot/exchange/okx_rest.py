"""OKX REST client — USDT-M perpetual futures with retry and rate limits."""

from __future__ import annotations

import logging
import ssl
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import aiohttp
import ccxt.async_support as ccxt

from core.config import Settings, TradingMode, get_settings
from core.retry import is_rate_limit_error, with_retry
from exchange.rate_limit import RateLimitGuard

log = logging.getLogger("trading_bot.exchange.rest")


@dataclass
class FuturesPosition:
    symbol: str
    side: str
    size: float
    entry_price: float
    mark_price: float
    liquidation_price: float | None
    unrealized_pnl: float
    leverage: float
    margin_mode: str


@dataclass
class TickerSnapshot:
    symbol: str
    last: float
    bid: float
    ask: float
    volume_24h: float
    change_pct_24h: float
    spread_pct: float
    mark_price: float = 0.0
    funding_rate: float = 0.0
    open_interest: float = 0.0


@dataclass
class OrderBookSnapshot:
    symbol: str
    bids: list[tuple[float, float]]
    asks: list[tuple[float, float]]
    timestamp: int

    @property
    def best_bid(self) -> float:
        return self.bids[0][0] if self.bids else 0.0

    @property
    def best_ask(self) -> float:
        return self.asks[0][0] if self.asks else 0.0

    @property
    def mid(self) -> float:
        if not self.bids or not self.asks:
            return 0.0
        return (self.best_bid + self.best_ask) / 2

    @property
    def spread_pct(self) -> float:
        mid = self.mid
        if not mid:
            return 0.0
        return ((self.best_ask - self.best_bid) / mid) * 100

    def depth_usd(self, levels: int = 10) -> tuple[float, float]:
        bid_usd = sum(p * s for p, s in self.bids[:levels])
        ask_usd = sum(p * s for p, s in self.asks[:levels])
        return bid_usd, ask_usd

    def imbalance(self, levels: int = 10) -> float:
        bid_usd, ask_usd = self.depth_usd(levels)
        total = bid_usd + ask_usd
        if total <= 0:
            return 0.0
        return (bid_usd - ask_usd) / total


def _parse_book_levels(raw_levels: list) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for row in raw_levels or []:
        if len(row) >= 2:
            out.append((float(row[0]), float(row[1])))
    return out


def _okx_hostname(rest_base: str) -> str:
    host = urlparse(rest_base).hostname
    return host or "www.okx.com"


def _build_aiohttp_session() -> aiohttp.ClientSession:
    """Windows fix: aiodns often fails — use system DNS via ThreadedResolver."""
    connector = aiohttp.TCPConnector(
        resolver=aiohttp.ThreadedResolver(),
        ssl=ssl.create_default_context(),
        limit=100,
    )
    return aiohttp.ClientSession(connector=connector, trust_env=True)


def to_swap_symbol(symbol: str) -> str:
    if ":USDT" in symbol:
        return symbol
    raw = symbol.upper().strip()
    if "-SWAP" in raw:
        base = raw.replace("-USDT-SWAP", "").replace("-SWAP", "").split("-")[0]
        return f"{base}/USDT:USDT"
    if "/" in symbol:
        base = symbol.split("/")[0]
        return f"{base}/USDT:USDT"
    if raw.endswith("-USDT"):
        base = raw.replace("-USDT", "")
        return f"{base}/USDT:USDT"
    return f"{raw}/USDT:USDT"


TIMEFRAME_MS: dict[str, int] = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}


class OKXRestClient:
    """Single REST gateway — strategies must not call OKX directly."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.mode = self.settings.trading_mode
        self._exchange: ccxt.okx | None = None
        self._http_session: aiohttp.ClientSession | None = None
        self._api_errors = 0
        self.rate_limit = RateLimitGuard(min_interval_ms=self.settings.trading_api_min_interval_ms)

    async def connect(self) -> None:
        hostname = _okx_hostname(self.settings.okx_rest_base)
        opts: dict[str, Any] = {
            "apiKey": self.settings.okx_api_key,
            "secret": self.settings.okx_secret_key,
            "password": self.settings.okx_passphrase,
            "enableRateLimit": True,
            "hostname": hostname,
            "options": {
                "defaultType": "swap",
                "fetchCurrencies": False,
            },
        }
        if self.settings.okx_demo:
            opts["sandbox"] = True

        self._exchange = ccxt.okx(opts)
        self._exchange.has["fetchCurrencies"] = False
        self._http_session = _build_aiohttp_session()
        self._exchange.session = self._http_session
        self._exchange.own_session = False

        await self._exchange.load_markets()
        log.info(
            "OKX futures REST connected | host=%s | mode=%s | markets=%d",
            hostname,
            self.mode.value,
            len(self._exchange.markets),
        )

    async def close(self) -> None:
        if self._exchange:
            await self._exchange.close()
            self._exchange = None
        if self._http_session:
            await self._http_session.close()
            self._http_session = None

    def _require_exchange(self) -> ccxt.okx:
        if not self._exchange:
            raise RuntimeError("Exchange not connected")
        return self._exchange

    async def _safe_call(self, fn_name: str, *args: Any, **kwargs: Any) -> Any:
        await self.rate_limit.throttle()

        async def _call() -> Any:
            ex = self._require_exchange()
            return await getattr(ex, fn_name)(*args, **kwargs)

        try:
            result = await with_retry(_call, max_attempts=self.settings.trading_api_max_retries, label=fn_name)
            self._api_errors = 0
            return result
        except Exception as e:
            self._api_errors += 1
            if is_rate_limit_error(e):
                self.rate_limit.record_hit(cooldown_sec=self.settings.trading_rate_limit_cooldown_sec)
            log.error("OKX API error [%s]: %s (streak=%d)", fn_name, e, self._api_errors)
            raise

    @property
    def api_error_streak(self) -> int:
        return self._api_errors

    def list_usdt_swap_symbols(self) -> list[str]:
        if not self._exchange:
            return []
        return sorted(
            s
            for s, m in self._exchange.markets.items()
            if m.get("swap") and m.get("quote") == "USDT" and m.get("active")
        )

    def has_symbol(self, symbol: str) -> bool:
        swap = to_swap_symbol(symbol)
        return bool(self._exchange and swap in self._exchange.markets)

    async def fetch_ticker(self, symbol: str) -> TickerSnapshot:
        swap = to_swap_symbol(symbol)
        raw = await self._safe_call("fetch_ticker", swap)
        bid = float(raw.get("bid") or raw.get("last") or 0)
        ask = float(raw.get("ask") or raw.get("last") or 0)
        last = float(raw.get("last") or (bid + ask) / 2)
        mid = (bid + ask) / 2 if bid and ask else last
        spread = ((ask - bid) / mid * 100) if mid else 0
        funding = await self.fetch_funding_rate(swap)
        oi = await self.fetch_open_interest(swap)
        return TickerSnapshot(
            symbol=swap,
            last=last,
            bid=bid,
            ask=ask,
            volume_24h=float(raw.get("quoteVolume") or 0),
            change_pct_24h=float(raw.get("percentage") or 0),
            spread_pct=spread,
            mark_price=float(raw.get("info", {}).get("markPx") or last),
            funding_rate=funding or 0.0,
            open_interest=oi or 0.0,
        )

    async def fetch_order_book(self, symbol: str, limit: int = 50) -> OrderBookSnapshot:
        swap = to_swap_symbol(symbol)
        raw = await self._safe_call("fetch_order_book", swap, limit)
        return OrderBookSnapshot(
            symbol=swap,
            bids=_parse_book_levels(raw.get("bids", [])),
            asks=_parse_book_levels(raw.get("asks", [])),
            timestamp=int(raw.get("timestamp") or 0),
        )

    async def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str = "1m",
        limit: int = 100,
        since: int | None = None,
    ) -> list[list[float]]:
        swap = to_swap_symbol(symbol)
        kwargs: dict[str, Any] = {"limit": limit}
        if since is not None:
            kwargs["since"] = since
        return await self._safe_call("fetch_ohlcv", swap, timeframe, **kwargs)

    async def fetch_ohlcv_history(
        self,
        symbol: str,
        timeframe: str = "5m",
        *,
        months: int = 6,
        max_bars: int | None = None,
        batch_size: int = 300,
        pause_sec: float = 0.15,
    ) -> list[list[float]]:
        """Paginated OHLCV download for months of history (OKX max ~300 candles/request)."""
        import asyncio
        from datetime import datetime, timedelta, timezone

        swap = to_swap_symbol(symbol)
        tf_ms = TIMEFRAME_MS.get(timeframe)
        if not tf_ms:
            raise ValueError(f"Unsupported timeframe: {timeframe}")

        months = max(1, min(months, 24))
        start_ms = int((datetime.now(timezone.utc) - timedelta(days=months * 30)).timestamp() * 1000)
        if max_bars is None:
            max_bars = int(months * 30 * 24 * 60 * 60_000 / tf_ms) + 100

        all_rows: list[list[float]] = []
        since = start_ms
        seen_ts: set[int] = set()

        while len(all_rows) < max_bars:
            batch = await self.fetch_ohlcv(swap, timeframe, limit=batch_size, since=since)
            if not batch:
                break

            new_rows = 0
            for row in batch:
                ts = int(row[0])
                if ts in seen_ts:
                    continue
                seen_ts.add(ts)
                all_rows.append(row)
                new_rows += 1

            if new_rows == 0:
                break

            since = int(batch[-1][0]) + tf_ms
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            if since >= now_ms or len(batch) < batch_size:
                break

            if pause_sec > 0:
                await asyncio.sleep(pause_sec)

        all_rows.sort(key=lambda r: r[0])
        return all_rows[:max_bars]

    async def fetch_funding_rate(self, symbol: str) -> float | None:
        swap = to_swap_symbol(symbol)
        if not self._exchange or swap not in self._exchange.markets:
            return None
        try:
            fr = await self._safe_call("fetch_funding_rate", swap)
            return float(fr.get("fundingRate", 0)) * 100
        except Exception:
            return None

    async def fetch_open_interest(self, symbol: str) -> float | None:
        swap = to_swap_symbol(symbol)
        try:
            oi = await self._safe_call("fetch_open_interest", swap)
            return float(oi.get("openInterestAmount") or oi.get("openInterest") or 0)
        except Exception:
            return None

    async def set_leverage(self, symbol: str, leverage: int) -> None:
        if self.mode != TradingMode.LIVE:
            return
        swap = to_swap_symbol(symbol)
        try:
            await self._safe_call("set_leverage", leverage, swap)
        except Exception as e:
            log.warning("set_leverage failed %s: %s", swap, e)

    async def create_order(
        self,
        symbol: str,
        side: str,
        amount: float,
        order_type: str = "market",
        price: float | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        swap = to_swap_symbol(symbol)
        order_params = {"tdMode": "cross", **(params or {})}
        if order_type == "limit" and price is not None:
            return await self._safe_call("create_order", swap, "limit", side, amount, price, order_params)
        return await self._safe_call("create_order", swap, "market", side, amount, None, order_params)

    async def create_order_with_brackets(
        self,
        symbol: str,
        side: str,
        amount: float,
        order_type: str,
        price: float | None,
        stop_loss: float,
        take_profit: float,
    ) -> dict[str, Any]:
        """Entry with attached OCO SL/TP (OKX attachAlgoOrds)."""
        swap = to_swap_symbol(symbol)
        params: dict[str, Any] = {
            "tdMode": "cross",
            "attachAlgoOrds": [
                {
                    "slTriggerPx": str(stop_loss),
                    "slOrdPx": "-1",
                    "tpTriggerPx": str(take_profit),
                    "tpOrdPx": "-1",
                }
            ],
        }
        if order_type == "limit" and price is not None:
            result = await self._safe_call("create_order", swap, "limit", side, amount, price, params)
        else:
            result = await self._safe_call("create_order", swap, "market", side, amount, None, params)

        info = result.get("info") or {}
        algo_ids = info.get("algoId") or info.get("algoClOrdId")
        result["sl_algo_id"] = algo_ids if isinstance(algo_ids, str) else None
        result["tp_algo_id"] = None
        attach = info.get("attachAlgoOrds") or []
        if attach:
            result["sl_algo_id"] = attach[0].get("attachAlgoId") or attach[0].get("algoId")
            if len(attach) > 1:
                result["tp_algo_id"] = attach[1].get("attachAlgoId") or attach[1].get("algoId")
        return result

    async def place_algo_stop(self, symbol: str, side: str, size: float, trigger_price: float) -> str:
        swap = to_swap_symbol(symbol)
        params = {
            "tdMode": "cross",
            "reduceOnly": True,
            "stopLossPrice": trigger_price,
        }
        order = await self._safe_call("create_order", swap, "market", side, size, None, params)
        return str(order.get("id", ""))

    async def amend_algo_order(
        self,
        symbol: str,
        algo_id: str,
        *,
        new_trigger_px: float | None = None,
        new_size: float | None = None,
    ) -> dict[str, Any]:
        swap = to_swap_symbol(symbol)
        ex = self._require_exchange()
        inst_id = self._inst_id(swap)
        body: dict[str, Any] = {"algoId": algo_id, "instId": inst_id}
        if new_trigger_px is not None:
            body["newSlTriggerPx"] = str(new_trigger_px)
        if new_size is not None:
            body["newSz"] = str(new_size)
        return await self._safe_call("privatePostTradeAmendAlgos", body)

    async def cancel_algo_orders(self, symbol: str, algo_ids: list[str]) -> None:
        if not algo_ids:
            return
        swap = to_swap_symbol(symbol)
        inst_id = self._inst_id(swap)
        for aid in algo_ids:
            try:
                await self._safe_call(
                    "privatePostTradeCancelAlgos",
                    [{"algoId": aid, "instId": inst_id}],
                )
            except Exception as e:
                log.warning("Cancel algo %s failed: %s", aid, e)

    async def amend_order(
        self,
        symbol: str,
        order_id: str,
        *,
        price: float | None = None,
        amount: float | None = None,
    ) -> dict[str, Any]:
        swap = to_swap_symbol(symbol)
        params: dict[str, Any] = {}
        if price is not None:
            params["price"] = price
        if amount is not None:
            params["amount"] = amount
        return await self._safe_call("edit_order", order_id, swap, None, None, params)

    async def fetch_balance_usdt(self) -> float:
        raw = await self._safe_call("fetch_balance")
        return float(raw.get("USDT", {}).get("free", 0) or raw.get("total", {}).get("USDT", 0) or 0)

    async def fetch_positions(self, symbol: str | None = None) -> list[FuturesPosition]:
        swap = to_swap_symbol(symbol) if symbol else None
        try:
            raw_positions = await self._safe_call("fetch_positions", [swap] if swap else None)
        except Exception:
            raw_positions = await self._safe_call("fetch_positions")

        out: list[FuturesPosition] = []
        for p in raw_positions or []:
            contracts = abs(float(p.get("contracts") or p.get("contractSize") or 0))
            if contracts <= 0:
                continue
            side_raw = str(p.get("side", "long")).lower()
            info = p.get("info") or {}
            liq = p.get("liquidationPrice") or info.get("liqPx")
            out.append(
                FuturesPosition(
                    symbol=str(p.get("symbol", "")),
                    side=side_raw,
                    size=contracts,
                    entry_price=float(p.get("entryPrice") or p.get("average") or 0),
                    mark_price=float(p.get("markPrice") or info.get("markPx") or p.get("entryPrice") or 0),
                    liquidation_price=float(liq) if liq else None,
                    unrealized_pnl=float(p.get("unrealizedPnl") or info.get("upl") or 0),
                    leverage=float(p.get("leverage") or info.get("lever") or 1),
                    margin_mode=str(p.get("marginMode") or info.get("mgnMode") or "cross"),
                )
            )
        return out

    async def close_position_reduce_only(
        self,
        symbol: str,
        side: str,
        size: float,
        order_type: str = "market",
        price: float | None = None,
    ) -> dict[str, Any]:
        close_side = "sell" if side == "long" else "buy"
        params = {"tdMode": "cross", "reduceOnly": True}
        return await self.create_order(symbol, close_side, size, order_type, price, params)

    async def cancel_order(self, symbol: str, order_id: str) -> dict[str, Any]:
        swap = to_swap_symbol(symbol)
        return await self._safe_call("cancel_order", order_id, swap)

    async def fetch_open_orders(self, symbol: str) -> list[dict[str, Any]]:
        swap = to_swap_symbol(symbol)
        return await self._safe_call("fetch_open_orders", swap)

    async def ping(self) -> bool:
        try:
            await self.fetch_ticker("BTC/USDT:USDT")
            return True
        except Exception:
            return False

    @staticmethod
    def _inst_id(symbol: str) -> str:
        swap = to_swap_symbol(symbol)
        base = swap.split("/")[0]
        return f"{base}-USDT-SWAP"

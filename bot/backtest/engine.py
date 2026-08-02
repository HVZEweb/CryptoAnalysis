"""Unified backtest engine — HFT orderbook + quant scalping on historical data."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from backtest.fast_backtest import StrategyParams
from backtest.market_simulator import MarketScenario, fetch_history, generate_scenarios
from backtest.metrics import PerformanceMetrics, build_metrics
from core.config import get_settings
from exchange.okx_rest import OKXRestClient, to_swap_symbol
from market.orderbook import BookSnapshot, OrderBookLevel, analyze_spike_entry

log = logging.getLogger("backtest.engine")


@dataclass
class BacktestTrade:
    symbol: str
    strategy: str
    side: str
    entry: float
    exit: float
    pnl_pct: float
    score: float
    ev: float


@dataclass
class BacktestReport:
    strategy: str
    symbol: str
    trades: list[BacktestTrade] = field(default_factory=list)
    metrics: PerformanceMetrics | None = None

    @property
    def summary(self) -> dict[str, float]:
        if not self.metrics:
            return {}
        return {
            "trades": self.metrics.trades,
            "win_rate": self.metrics.win_rate,
            "total_return_pct": self.metrics.total_return_pct,
            "max_drawdown_pct": self.metrics.max_drawdown_pct,
            "sharpe": self.metrics.sharpe_ratio,
            "profit_factor": self.metrics.profit_factor,
        }


def _synthetic_book(row: pd.Series, symbol: str, wall_usd: float = 2500) -> BookSnapshot:
    mid = float(row["close"])
    spread = mid * 0.0008
    bid = mid - spread / 2
    ask = mid + spread / 2
    vol = float(row.get("volume", 1))
    size = vol / mid / 100 if mid else 1.0
    wall_price = bid * 0.995
    wall_size = wall_usd / wall_price if wall_price else size * 5
    return BookSnapshot(
        symbol=symbol,
        bids=[
            OrderBookLevel(bid, size),
            OrderBookLevel(wall_price, wall_size),
            OrderBookLevel(wall_price * 0.998, size * 0.5),
        ],
        asks=[
            OrderBookLevel(ask, size),
            OrderBookLevel(ask * 1.002, size * 0.8),
        ],
    )


class UnifiedBacktestEngine:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def run_hft(
        self,
        symbol: str = "ETH/USDT:USDT",
        bars: int = 500,
        timeframe: str = "1m",
    ) -> BacktestReport:
        swap = to_swap_symbol(symbol)
        rest = OKXRestClient()
        await rest.connect()
        try:
            ohlcv = await rest.fetch_ohlcv(swap, timeframe, limit=bars)
        finally:
            await rest.close()

        df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
        trades: list[BacktestTrade] = []
        returns: list[float] = []

        s = self.settings
        for i in range(20, len(df) - 5):
            row = df.iloc[i]
            book = _synthetic_book(row, swap, s.trading_min_density_usd)
            analysis = analyze_spike_entry(
                book,
                min_density_usd=s.trading_min_density_usd,
                anomaly_multiplier=s.trading_anomaly_multiplier,
                min_spread_pct=s.trading_min_spread_pct,
                max_spread_pct=s.trading_max_spread_pct,
            )
            if not analysis.has_opportunity or not analysis.target_entry_price:
                continue

            capture = 0.55
            edge_pct = max(0.0, analysis.distance_pct * capture)
            gross = s.trading_notional_usd * edge_pct / 100
            fees = s.trading_notional_usd * (s.trading_maker_fee_pct + s.trading_taker_fee_pct) / 100
            ev = gross - fees - s.trading_notional_usd * s.trading_slippage_pct / 100
            score = min(100, 50 + analysis.distance_pct * 20)

            if score < s.trading_min_score or ev < s.trading_min_ev_usd:
                continue

            entry = analysis.target_entry_price
            future = df.iloc[i + 1 : i + 6]["close"].values
            exit_p = float(np.median(future))
            pnl_pct = (exit_p - entry) / entry * 100
            returns.append(pnl_pct / 100)
            trades.append(
                BacktestTrade(swap, "hft_orderbook", "long", entry, exit_p, pnl_pct, score, ev)
            )

        return BacktestReport(
            strategy="hft_orderbook",
            symbol=swap,
            trades=trades,
            metrics=build_metrics(returns),
        )

    async def run_quant(
        self,
        symbol: str = "ETH/USDT:USDT",
        scenarios: int = 50,
    ) -> BacktestReport:
        swap = to_swap_symbol(symbol)
        pools = await fetch_history([swap], "5m", 1500)
        if swap not in pools:
            raise ValueError(f"No data for {swap}")

        scenario_list = generate_scenarios(pools, n_scenarios=scenarios)
        params = StrategyParams(
            tp_pct=self.settings.trading_tp_pct,
            sl_pct=self.settings.trading_sl_pct,
            trailing_pct=self.settings.trading_trailing_pct,
            rsi_low=self.settings.trading_rsi_low,
            rsi_high=self.settings.trading_rsi_high,
            taker_fee_pct=self.settings.trading_taker_fee_pct,
            slippage_pct=self.settings.trading_slippage_pct,
        )

        all_returns: list[float] = []
        from backtest.fast_backtest import run_scenario_returns

        for sc in scenario_list:
            all_returns.extend(run_scenario_returns(sc, params))

        return BacktestReport(
            strategy="quant_scalping",
            symbol=swap,
            metrics=build_metrics(all_returns),
        )

    async def run_all(self, symbol: str = "ETH/USDT:USDT") -> dict[str, BacktestReport]:
        hft = await self.run_hft(symbol)
        quant = await self.run_quant(symbol)
        return {"hft_orderbook": hft, "quant_scalping": quant}


async def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    engine = UnifiedBacktestEngine()
    reports = await engine.run_all("ETH/USDT")
    for name, r in reports.items():
        print(f"\n=== {name} ===")
        print(r.summary)


if __name__ == "__main__":
    asyncio.run(_main())

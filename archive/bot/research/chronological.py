"""Chronological strategy simulation on real OHLCV (no bootstrap shuffle)."""

from __future__ import annotations

import pandas as pd

from backtest.fast_backtest import StrategyParams, _precompute
from core.costs import round_trip_cost_pct
from exchange.okx_rest import to_swap_symbol
from market.orderbook import BookSnapshot, OrderBookLevel, analyze_spike_entry
from research.config import ExecutionModel
from research.regime_analyzer import classify_regimes_at_bar, label_regime_at_bar
from research.simulation_flags import HftSimulationFlags, SimulationFlags
from research.trade_record import SimulatedTrade


def _fee_components(execution: ExecutionModel, use_limit_entry: bool = False) -> tuple[float, float, float]:
    entry_fee = (execution.maker_fee_pct if use_limit_entry else execution.taker_fee_pct) / 100
    exit_fee = execution.taker_fee_pct / 100
    slip = execution.slippage_pct / 100
    spread = execution.spread_pct * 0.005 / 100 * 100  # half-spread as pct
    return entry_fee * 100, exit_fee * 100, (slip * 2) * 100


def _costs_decimal(execution: ExecutionModel, use_limit_entry: bool = False) -> float:
    return round_trip_cost_pct(
        execution.taker_fee_pct if not use_limit_entry else execution.maker_fee_pct,
        execution.slippage_pct,
        execution.slippage_pct,
        execution.safety_margin_pct,
    ) / 100 + execution.spread_pct * 0.005


def _confidence_score(signal_mode: str, rr: float) -> float:
    score = 60.0
    if rr >= 1.5:
        score += 10.0
    score += 10.0 if signal_mode == "mean_reversion" else 5.0
    return score


def _ai_proxy_score(rsi: float) -> float:
    """OHLCV proxy when historical AI probabilities are unavailable."""
    return max(0.0, min(100.0, 100.0 - abs(rsi - 50.0) * 1.2))


def _close_trade(
    position: dict,
    exec_i: int,
    price: float,
    *,
    strategy: str,
    symbol: str,
    reason: str,
    entry_fee_pct: float,
    exit_fee_pct: float,
    slip_pct: float,
    spread_cost_pct: float,
    safety_pct: float,
    bar_minutes: int,
) -> SimulatedTrade:
    entry = position["entry"]
    if position["side"] == "long":
        gross = (price - entry) / entry * 100
        mfe = (position["high"] - entry) / entry * 100
        mae = (entry - position["low"]) / entry * 100
    else:
        gross = (entry - price) / entry * 100
        mfe = (entry - position["low"]) / entry * 100
        mae = (position["high"] - entry) / entry * 100

    fees = entry_fee_pct + exit_fee_pct
    pnl_no_costs = gross
    pnl_fees_only = gross - fees
    pnl_fees_slip = gross - fees - slip_pct
    net = gross - fees - slip_pct - spread_cost_pct - safety_pct

    hold_bars = exec_i - position["bar"]
    funding = 0.0
    if hold_bars * bar_minutes >= 480:
        funding = position.get("funding_pct", 0.01)
        net -= funding

    return SimulatedTrade(
        strategy=strategy,
        symbol=symbol,
        side=position["side"],
        entry_bar=position["bar"],
        exit_bar=exec_i,
        entry_price=entry,
        exit_price=price,
        gross_return_pct=gross,
        fees_pct=fees,
        slippage_pct=slip_pct,
        net_return_pct=net,
        hold_bars=hold_bars,
        regime=position.get("regime", "unknown"),
        exit_reason=reason,
        signal_mode=position.get("signal_mode", ""),
        entry_rsi=position.get("entry_rsi", 0.0),
        entry_atr_pct=position.get("entry_atr_pct", 0.0),
        entry_confidence=position.get("entry_confidence", 0.0),
        entry_ev_usd=position.get("entry_ev_usd", 0.0),
        spread_cost_pct=spread_cost_pct,
        latency_cost_pct=position.get("latency_cost_pct", 0.0),
        funding_cost_pct=funding,
        pnl_no_costs_pct=pnl_no_costs,
        pnl_fees_only_pct=pnl_fees_only,
        pnl_fees_slip_pct=pnl_fees_slip,
        mfe_pct=mfe,
        mae_pct=mae,
        trend_regime=position.get("trend_regime", ""),
        volatility_regime=position.get("volatility_regime", ""),
        liquidity_regime=position.get("liquidity_regime", ""),
        impulse_regime=position.get("impulse_regime", ""),
    )


def run_quant_chronological(
    df: pd.DataFrame,
    params: StrategyParams,
    execution: ExecutionModel,
    *,
    strategy: str = "quant_scalping",
    symbol: str = "ETH/USDT:USDT",
    bar_minutes: int = 5,
    flags: SimulationFlags | None = None,
) -> list[SimulatedTrade]:
    if len(df) < 60:
        return []

    f = flags or SimulationFlags.legacy()
    w = _precompute(df)
    entry_fee_pct, exit_fee_pct, slip_pct = _fee_components(execution)
    spread_cost_pct = execution.spread_pct * 0.5
    safety_pct = execution.safety_margin_pct
    latency = max(0, execution.latency_bars)

    trades: list[SimulatedTrade] = []
    position: dict | None = None

    for i in range(50, len(w) - latency):
        row = w.iloc[i]
        exec_i = min(i + latency, len(w) - 1)
        price = float(w.iloc[exec_i]["close"])
        atr_val = float(row["atr"] / row["close"] * 100) if row["close"] and pd.notna(row["atr"]) else 0

        if position:
            position["high"] = max(position["high"], price)
            position["low"] = min(position["low"], price)
            bars_held = exec_i - position["bar"]

            if f.use_trailing_stop and params.trailing_pct > 0:
                if position["side"] == "long":
                    trail = position["high"] * (1 - params.trailing_pct / 100)
                    position["sl"] = max(position["sl"], trail)
                else:
                    trail = position["low"] * (1 + params.trailing_pct / 100)
                    position["sl"] = min(position["sl"], trail)

            hit_sl = f.use_stop_loss and (
                price <= position["sl"] if position["side"] == "long" else price >= position["sl"]
            )
            hit_tp = f.use_take_profit and (
                price >= position["tp"] if position["side"] == "long" else price <= position["tp"]
            )
            timeout = bars_held >= params.max_hold_bars
            exit_only = not f.use_stop_loss and not f.use_take_profit

            if hit_sl or hit_tp or timeout or exit_only:
                if exit_only and not timeout:
                    continue
                reason = "trailing" if (hit_sl and f.use_trailing_stop) else "tp" if hit_tp else "sl" if hit_sl else "timeout"
                trades.append(
                    _close_trade(
                        position,
                        exec_i,
                        price,
                        strategy=strategy,
                        symbol=symbol,
                        reason=reason,
                        entry_fee_pct=entry_fee_pct,
                        exit_fee_pct=exit_fee_pct,
                        slip_pct=slip_pct,
                        spread_cost_pct=spread_cost_pct,
                        safety_pct=safety_pct,
                        bar_minutes=bar_minutes,
                    )
                )
                position = None
            continue

        if f.use_atr and atr_val > params.atr_max_pct:
            continue

        rsi = float(row["rsi"]) if pd.notna(row["rsi"]) else 50.0
        ema_bull = float(row["ema9"]) > float(row["ema21"])
        vwap = float(row["vwap"]) if pd.notna(row.get("vwap")) else price
        side: str | None = None
        signal_mode = ""

        if f.use_trend_filter:
            trend_long = True
            trend_short = True
            if f.use_ema:
                trend_long = trend_long and ema_bull
                trend_short = trend_short and not ema_bull
            if f.use_rsi:
                trend_long = trend_long and rsi < params.rsi_low
                trend_short = trend_short and rsi > params.rsi_high
            if f.use_vwap:
                trend_long = trend_long and price > vwap
                trend_short = trend_short and price < vwap
            if trend_long:
                side = "long"
                signal_mode = "trend"
            elif trend_short:
                side = "short"
                signal_mode = "trend"

        if not side and f.use_mean_reversion and f.use_bollinger:
            if price < float(row["bb_lower"]):
                side = "long"
                signal_mode = "mean_reversion"
            elif price > float(row["bb_upper"]):
                side = "short"
                signal_mode = "mean_reversion"

        if not side:
            continue

        rr = params.tp_pct / max(params.sl_pct, 0.01)
        if rr < params.min_rr:
            continue

        regimes = classify_regimes_at_bar(w, i)
        if f.use_regime_filter and regimes["regime"] in f.blocked_regimes:
            continue

        confidence = _confidence_score(signal_mode, rr)
        if f.use_confidence_filter and confidence < f.min_confidence:
            continue

        ev_usd = f.notional_usd * (params.tp_pct - params.sl_pct * 0.5) / 100
        if f.use_ev_filter and ev_usd < f.min_ev_usd:
            continue

        if f.use_ai_filter and _ai_proxy_score(rsi) < f.min_ai_confidence:
            continue

        entry_price = float(w.iloc[exec_i]["close"])
        sl = entry_price * (1 - params.sl_pct / 100) if side == "long" else entry_price * (1 + params.sl_pct / 100)
        tp = entry_price * (1 + params.tp_pct / 100) if side == "long" else entry_price * (1 - params.tp_pct / 100)
        position = {
            "side": side,
            "entry": entry_price,
            "sl": sl,
            "tp": tp,
            "high": entry_price,
            "low": entry_price,
            "bar": exec_i,
            "regime": regimes["regime"],
            "trend_regime": regimes["trend_regime"],
            "volatility_regime": regimes["volatility_regime"],
            "liquidity_regime": regimes["liquidity_regime"],
            "impulse_regime": regimes["impulse_regime"],
            "signal_mode": signal_mode,
            "entry_rsi": rsi,
            "entry_atr_pct": atr_val,
            "entry_confidence": confidence,
            "entry_ev_usd": ev_usd,
            "funding_pct": execution.funding_pct_per_8h,
            "latency_cost_pct": 0.0,
        }

    return trades


def _synthetic_book(row: pd.Series, symbol: str, wall_usd: float) -> BookSnapshot:
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
        bids=[OrderBookLevel(bid, size), OrderBookLevel(wall_price, wall_size)],
        asks=[OrderBookLevel(ask, size), OrderBookLevel(ask * 1.002, size * 0.8)],
    )


def run_hft_chronological(
    df: pd.DataFrame,
    execution: ExecutionModel,
    *,
    min_density_usd: float = 15_000,
    anomaly_multiplier: float = 3.0,
    min_spread_pct: float = 0.02,
    max_spread_pct: float = 0.8,
    min_score: float = 75.0,
    min_ev_usd: float = 0.05,
    notional_usd: float = 25.0,
    symbol: str = "ETH/USDT:USDT",
    hold_bars: int = 5,
    latency_bars: int = 1,
    flags: HftSimulationFlags | None = None,
) -> list[SimulatedTrade]:
    if len(df) < 30:
        return []

    f = flags or HftSimulationFlags.legacy()
    swap = to_swap_symbol(symbol)
    trades: list[SimulatedTrade] = []
    latency = max(0, latency_bars)
    entry_fee_pct = execution.maker_fee_pct
    exit_fee_pct = execution.taker_fee_pct
    slip_pct = execution.slippage_pct * 2
    spread_cost_pct = execution.spread_pct * 0.5
    safety_pct = execution.safety_margin_pct
    tp_pct = 0.45
    sl_pct = 0.25

    for i in range(20, len(df) - hold_bars - latency):
        row = df.iloc[i]
        density = 0.0 if not f.use_density_filter else min_density_usd
        anomaly = 1.0 if not f.use_anomaly_filter else anomaly_multiplier
        book = _synthetic_book(row, swap, density)
        analysis = analyze_spike_entry(
            book,
            min_density_usd=density,
            anomaly_multiplier=anomaly,
            min_spread_pct=0.0 if not f.use_spread_distance else min_spread_pct,
            max_spread_pct=999.0 if not f.use_spread_distance else max_spread_pct,
        )
        if not analysis.has_opportunity or not analysis.target_entry_price:
            continue

        capture = 0.55
        edge_pct = max(0.0, analysis.distance_pct * capture)
        gross_usd = notional_usd * edge_pct / 100
        fees_usd = notional_usd * (execution.maker_fee_pct + execution.taker_fee_pct) / 100
        slip_usd = notional_usd * execution.slippage_pct * 2 / 100
        ev = gross_usd - fees_usd - slip_usd
        score = min(100.0, 50.0 + analysis.distance_pct * 20.0)

        if f.use_score_filter and score < (f.min_score if f.min_score else min_score):
            continue
        if f.use_ev_filter and ev < (f.min_ev_usd if f.min_ev_usd else min_ev_usd):
            continue
        if f.use_ai_filter and score < f.min_ai_confidence:
            continue

        entry = analysis.target_entry_price
        exit_i = min(i + latency + hold_bars, len(df) - 1)
        exit_p = float(df.iloc[exit_i]["close"])
        gross_pct = (exit_p - entry) / entry * 100

        regimes = classify_regimes_at_bar(df, i)
        position = {
            "side": analysis.target_side or "long",
            "entry": entry,
            "sl": entry * (1 - sl_pct / 100),
            "tp": entry * (1 + tp_pct / 100),
            "high": max(entry, exit_p),
            "low": min(entry, exit_p),
            "bar": i,
            "regime": regimes["regime"],
            "trend_regime": regimes["trend_regime"],
            "volatility_regime": regimes["volatility_regime"],
            "liquidity_regime": regimes["liquidity_regime"],
            "impulse_regime": regimes["impulse_regime"],
            "signal_mode": "hft_wall",
            "entry_rsi": 0.0,
            "entry_atr_pct": 0.0,
            "entry_confidence": score,
            "entry_ev_usd": ev,
            "funding_pct": execution.funding_pct_per_8h,
        }

        reason = "hft_capture"
        if f.use_stop_loss and exit_p <= position["sl"]:
            reason = "sl"
        elif f.use_take_profit and exit_p >= position["tp"]:
            reason = "tp"

        trades.append(
            _close_trade(
                position,
                exit_i,
                exit_p,
                strategy="hft_orderbook",
                symbol=swap,
                reason=reason,
                entry_fee_pct=entry_fee_pct,
                exit_fee_pct=exit_fee_pct,
                slip_pct=slip_pct,
                spread_cost_pct=spread_cost_pct,
                safety_pct=safety_pct,
                bar_minutes=5,
            )
        )

    return trades

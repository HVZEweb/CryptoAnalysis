"""Alpha signal backtest engine — shared trade simulation."""

from __future__ import annotations

from core.config import get_settings
from research.chronological import _close_trade, _fee_components
from research.config import ExecutionModel
from research.trade_record import SimulatedTrade


def _execution() -> ExecutionModel:
    s = get_settings()
    return ExecutionModel(
        maker_fee_pct=s.trading_maker_fee_pct,
        taker_fee_pct=s.trading_taker_fee_pct,
        slippage_pct=s.trading_slippage_pct,
        funding_pct_per_8h=s.trading_funding_pct,
        latency_bars=1,
    )


def simulate_entries(
    df,
    entries: list[tuple[int, str]],
    *,
    strategy: str,
    symbol: str,
    tp_pct: float = 0.35,
    sl_pct: float = 0.18,
    max_hold_bars: int = 12,
    execution: ExecutionModel | None = None,
) -> list[SimulatedTrade]:
    if not entries or df is None or len(df) < 50:
        return []

    ex = execution or _execution()
    entry_fee_pct, exit_fee_pct, slip_pct = _fee_components(ex)
    spread_cost_pct = ex.spread_pct * 0.5
    safety_pct = ex.safety_margin_pct
    latency = max(0, ex.latency_bars)

    entry_set = sorted(entries, key=lambda x: x[0])
    trades: list[SimulatedTrade] = []
    position: dict | None = None
    next_entry = 0

    for i in range(30, len(df) - latency - 1):
        exec_i = min(i + latency, len(df) - 1)
        price = float(df.iloc[exec_i]["close"])

        if position:
            position["high"] = max(position["high"], price)
            position["low"] = min(position["low"], price)
            bars_held = exec_i - position["bar"]
            hit_sl = price <= position["sl"] if position["side"] == "long" else price >= position["sl"]
            hit_tp = price >= position["tp"] if position["side"] == "long" else price <= position["tp"]
            timeout = bars_held >= max_hold_bars
            if hit_sl or hit_tp or timeout:
                reason = "tp" if hit_tp else "sl" if hit_sl else "timeout"
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
                        bar_minutes=5,
                    )
                )
                position = None
            continue

        while next_entry < len(entry_set) and entry_set[next_entry][0] < i:
            next_entry += 1
        if next_entry >= len(entry_set) or entry_set[next_entry][0] != i:
            continue

        side = entry_set[next_entry][1]
        next_entry += 1
        entry_price = price
        sl = entry_price * (1 - sl_pct / 100) if side == "long" else entry_price * (1 + sl_pct / 100)
        tp = entry_price * (1 + tp_pct / 100) if side == "long" else entry_price * (1 - tp_pct / 100)
        position = {
            "side": side,
            "entry": entry_price,
            "sl": sl,
            "tp": tp,
            "high": entry_price,
            "low": entry_price,
            "bar": exec_i,
            "regime": "alpha",
            "signal_mode": strategy,
            "entry_rsi": 0.0,
            "entry_atr_pct": 0.0,
            "entry_confidence": 0.0,
            "entry_ev_usd": 0.0,
        }

    return trades

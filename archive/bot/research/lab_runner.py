"""Research Lab runner — validate independent hypotheses."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from research.chronological import _close_trade, _fee_components
from research.config import ExecutionModel
from research.lab.base import Hypothesis
from research.lab.registry import ALL_HYPOTHESES
from research.metrics import ResearchMetrics, aggregate_fold_metrics, build_research_metrics, overfitting_score
from research.oos import split_holdout
from research.regime_analyzer import classify_regimes_at_bar
from research.trade_record import SimulatedTrade


@dataclass
class HypothesisResult:
    hypothesis_id: str
    name: str
    symbol: str
    full_sample: ResearchMetrics
    in_sample: ResearchMetrics
    out_of_sample: ResearchMetrics
    walk_forward: ResearchMetrics
    rolling: ResearchMetrics
    overfitting_score: float = 1.0
    stability_score: float = 0.0
    viable: bool = False
    verdict: str = ""

    def to_dict(self) -> dict:
        return {
            "hypothesis_id": self.hypothesis_id,
            "name": self.name,
            "symbol": self.symbol,
            "full_sample": self.full_sample.to_dict(),
            "in_sample": self.in_sample.to_dict(),
            "out_of_sample": self.out_of_sample.to_dict(),
            "walk_forward": self.walk_forward.to_dict(),
            "rolling": self.rolling.to_dict(),
            "overfitting_score": round(self.overfitting_score, 3),
            "stability_score": round(self.stability_score, 3),
            "viable": self.viable,
            "verdict": self.verdict,
        }


def run_hypothesis_trades(
    df: pd.DataFrame,
    hypothesis: Hypothesis,
    execution: ExecutionModel,
    *,
    symbol: str,
) -> list[SimulatedTrade]:
    if len(df) < 60:
        return []

    w = hypothesis.precompute(df)
    entry_fee_pct, exit_fee_pct, slip_pct = _fee_components(execution)
    spread_cost_pct = execution.spread_pct * 0.5
    safety_pct = execution.safety_margin_pct
    latency = max(0, execution.latency_bars)

    trades: list[SimulatedTrade] = []
    position: dict | None = None

    for i in range(30, len(w) - latency - 1):
        exec_i = min(i + latency, len(w) - 1)
        price = float(w.iloc[exec_i]["close"])

        if position:
            position["high"] = max(position["high"], price)
            position["low"] = min(position["low"], price)
            bars_held = exec_i - position["bar"]
            hit_sl = price <= position["sl"] if position["side"] == "long" else price >= position["sl"]
            hit_tp = price >= position["tp"] if position["side"] == "long" else price <= position["tp"]
            timeout = bars_held >= hypothesis.max_hold_bars
            if hit_sl or hit_tp or timeout:
                reason = "tp" if hit_tp else "sl" if hit_sl else "timeout"
                trades.append(
                    _close_trade(
                        position,
                        exec_i,
                        price,
                        strategy=f"lab:{hypothesis.meta.id}",
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

        side = hypothesis.entry_signal(w, i)
        if not side:
            continue

        entry_price = price
        sl = entry_price * (1 - hypothesis.sl_pct / 100) if side == "long" else entry_price * (1 + hypothesis.sl_pct / 100)
        tp = entry_price * (1 + hypothesis.tp_pct / 100) if side == "long" else entry_price * (1 - hypothesis.tp_pct / 100)
        regimes = classify_regimes_at_bar(w, i)
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
            "signal_mode": hypothesis.meta.id,
            "entry_rsi": float(w.iloc[i]["rsi"]) if pd.notna(w.iloc[i].get("rsi")) else 0.0,
            "entry_atr_pct": 0.0,
            "entry_confidence": 0.0,
            "entry_ev_usd": 0.0,
        }

    return trades


def _walk_forward_metrics(
    df: pd.DataFrame,
    hypothesis: Hypothesis,
    execution: ExecutionModel,
    *,
    symbol: str,
    train_bars: int = 3000,
    test_bars: int = 1000,
    step: int = 1000,
) -> tuple[ResearchMetrics, float]:
    folds: list[ResearchMetrics] = []
    start = 0
    while start + train_bars + test_bars <= len(df):
        test_df = df.iloc[start + train_bars : start + train_bars + test_bars]
        trades = run_hypothesis_trades(test_df, hypothesis, execution, symbol=symbol)
        folds.append(build_research_metrics(trades))
        start += step
    agg = aggregate_fold_metrics(folds)
    return agg, agg.stability_score


def _rolling_metrics(
    df: pd.DataFrame,
    hypothesis: Hypothesis,
    execution: ExecutionModel,
    *,
    symbol: str,
    window: int = 5000,
    step: int = 1000,
) -> ResearchMetrics:
    windows: list[ResearchMetrics] = []
    start = 0
    while start + window <= len(df):
        chunk = df.iloc[start : start + window]
        trades = run_hypothesis_trades(chunk, hypothesis, execution, symbol=symbol)
        windows.append(build_research_metrics(trades))
        start += step
    return aggregate_fold_metrics(windows)


def _verdict(oos: ResearchMetrics, wf: ResearchMetrics, overfit: float) -> tuple[bool, str]:
    viable = (
        oos.trades >= 5
        and oos.expectancy_pct > 0
        and oos.profit_factor > 1.0
        and oos.sharpe_ratio > 0
        and wf.stability_score >= 40
        and overfit < 0.8
    )
    if viable:
        return True, "OOS edge confirmed with acceptable stability"
    if oos.trades < 5:
        return False, "Insufficient OOS trades"
    if oos.expectancy_pct <= 0:
        return False, "Negative OOS expectancy after costs"
    if overfit >= 0.8:
        return False, "High overfitting score — in-sample does not generalize"
    return False, "Fails walk-forward stability or profit factor"


def validate_hypothesis(
    df: pd.DataFrame,
    hypothesis: Hypothesis,
    execution: ExecutionModel,
    *,
    symbol: str,
    holdout_pct: float = 0.25,
) -> HypothesisResult:
    is_df, oos_df = split_holdout(df, holdout_pct)
    full_trades = run_hypothesis_trades(df, hypothesis, execution, symbol=symbol)
    is_trades = run_hypothesis_trades(is_df, hypothesis, execution, symbol=symbol)
    oos_trades = run_hypothesis_trades(oos_df, hypothesis, execution, symbol=symbol)

    full_m = build_research_metrics(full_trades)
    is_m = build_research_metrics(is_trades)
    oos_m = build_research_metrics(oos_trades)
    wf_m, stability = _walk_forward_metrics(df, hypothesis, execution, symbol=symbol)
    roll_m = _rolling_metrics(df, hypothesis, execution, symbol=symbol)
    overfit = overfitting_score(is_m, oos_m)
    viable, verdict = _verdict(oos_m, wf_m, overfit)

    return HypothesisResult(
        hypothesis_id=hypothesis.meta.id,
        name=hypothesis.meta.name,
        symbol=symbol,
        full_sample=full_m,
        in_sample=is_m,
        out_of_sample=oos_m,
        walk_forward=wf_m,
        rolling=roll_m,
        overfitting_score=overfit,
        stability_score=stability,
        viable=viable,
        verdict=verdict,
    )


def run_all_hypotheses(
    df: pd.DataFrame,
    execution: ExecutionModel,
    *,
    symbol: str,
    hypotheses: list[Hypothesis] | None = None,
) -> list[HypothesisResult]:
    hyps = hypotheses or ALL_HYPOTHESES
    return [validate_hypothesis(df, h, execution, symbol=symbol) for h in hyps]

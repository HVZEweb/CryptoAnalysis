"""Ablation analysis — measure each filter/component contribution."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from backtest.fast_backtest import StrategyParams
from research.chronological import run_hft_chronological, run_quant_chronological
from research.config import ExecutionModel
from research.metrics import ResearchMetrics, build_research_metrics
from research.simulation_flags import (
    ABLATION_COMPONENTS,
    HFT_ABLATION_COMPONENTS,
    HftSimulationFlags,
    SimulationFlags,
)


@dataclass
class AblationRow:
    component: str
    disabled: bool
    metrics: ResearchMetrics
    delta_expectancy: float = 0.0
    delta_profit_factor: float = 0.0
    delta_sharpe: float = 0.0
    delta_max_dd: float = 0.0
    delta_trades: int = 0
    impact_score: float = 0.0
    verdict: str = ""

    def to_dict(self) -> dict:
        return {
            "component": self.component,
            "disabled": self.disabled,
            "metrics": self.metrics.to_dict(),
            "delta_expectancy": round(self.delta_expectancy, 4),
            "delta_profit_factor": round(self.delta_profit_factor, 4),
            "delta_sharpe": round(self.delta_sharpe, 4),
            "delta_max_dd": round(self.delta_max_dd, 2),
            "delta_trades": self.delta_trades,
            "impact_score": round(self.impact_score, 4),
            "verdict": self.verdict,
        }


@dataclass
class AblationReport:
    strategy: str
    symbol: str
    baseline: AblationRow
    rows: list[AblationRow] = field(default_factory=list)
    helps: list[str] = field(default_factory=list)
    neutral: list[str] = field(default_factory=list)
    hurts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "strategy": self.strategy,
            "symbol": self.symbol,
            "baseline": self.baseline.to_dict(),
            "rows": [r.to_dict() for r in self.rows],
            "helps": self.helps,
            "neutral": self.neutral,
            "hurts": self.hurts,
            "ranking": [r.component for r in sorted(self.rows, key=lambda x: x.impact_score, reverse=True)],
        }


def _impact_score(delta_ev: float, delta_pf: float, delta_sharpe: float, delta_trades: int) -> float:
    """Positive = disabling component improved metrics (component was hurting)."""
    trade_norm = min(abs(delta_trades), 500) / 500
    return delta_ev * 0.5 + (delta_pf - 1.0) * 0.2 + delta_sharpe * 0.02 + trade_norm * 0.05


def _classify_row(row: AblationRow) -> str:
    if row.delta_expectancy > 0.01 and row.delta_profit_factor > 0.02:
        return "hurts"
    if row.delta_expectancy < -0.01 and row.delta_profit_factor < -0.02:
        return "helps"
    return "neutral"


def run_quant_ablation(
    df: pd.DataFrame,
    params: StrategyParams,
    execution: ExecutionModel,
    *,
    symbol: str,
    baseline_flags: SimulationFlags | None = None,
) -> AblationReport:
    flags = baseline_flags or SimulationFlags.forensic_baseline()
    baseline_trades = run_quant_chronological(df, params, execution, symbol=symbol, flags=flags)
    baseline_m = build_research_metrics(baseline_trades)
    baseline_row = AblationRow(component="baseline", disabled=False, metrics=baseline_m)

    rows: list[AblationRow] = []
    helps: list[str] = []
    neutral: list[str] = []
    hurts: list[str] = []

    for comp in ABLATION_COMPONENTS:
        ablated = flags.with_disabled(comp)
        trades = run_quant_chronological(df, params, execution, symbol=symbol, flags=ablated)
        m = build_research_metrics(trades)
        d_ev = m.expectancy_pct - baseline_m.expectancy_pct
        d_pf = m.profit_factor - baseline_m.profit_factor
        d_sh = m.sharpe_ratio - baseline_m.sharpe_ratio
        d_dd = m.max_drawdown_pct - baseline_m.max_drawdown_pct
        d_tr = m.trades - baseline_m.trades
        impact = _impact_score(d_ev, d_pf, d_sh, d_tr)
        row = AblationRow(
            component=comp,
            disabled=True,
            metrics=m,
            delta_expectancy=d_ev,
            delta_profit_factor=d_pf,
            delta_sharpe=d_sh,
            delta_max_dd=d_dd,
            delta_trades=d_tr,
            impact_score=impact,
        )
        verdict = _classify_row(row)
        row.verdict = verdict
        rows.append(row)
        if verdict == "helps":
            helps.append(comp)
        elif verdict == "hurts":
            hurts.append(comp)
        else:
            neutral.append(comp)

    return AblationReport(
        strategy="quant_scalping",
        symbol=symbol,
        baseline=baseline_row,
        rows=rows,
        helps=helps,
        neutral=neutral,
        hurts=hurts,
    )


def run_hft_ablation(
    df: pd.DataFrame,
    execution: ExecutionModel,
    *,
    symbol: str,
    baseline_flags: HftSimulationFlags | None = None,
) -> AblationReport:
    flags = baseline_flags or HftSimulationFlags.forensic_baseline()
    baseline_trades = run_hft_chronological(df, execution, symbol=symbol, flags=flags)
    baseline_m = build_research_metrics(baseline_trades)
    baseline_row = AblationRow(component="baseline", disabled=False, metrics=baseline_m)

    rows: list[AblationRow] = []
    helps, neutral, hurts = [], [], []

    for comp in HFT_ABLATION_COMPONENTS:
        ablated = flags.with_disabled(comp)
        trades = run_hft_chronological(df, execution, symbol=symbol, flags=ablated)
        m = build_research_metrics(trades)
        d_ev = m.expectancy_pct - baseline_m.expectancy_pct
        d_pf = m.profit_factor - baseline_m.profit_factor
        d_sh = m.sharpe_ratio - baseline_m.sharpe_ratio
        d_dd = m.max_drawdown_pct - baseline_m.max_drawdown_pct
        d_tr = m.trades - baseline_m.trades
        impact = _impact_score(d_ev, d_pf, d_sh, d_tr)
        verdict = _classify_row(
            AblationRow(component=comp, disabled=True, metrics=m, delta_expectancy=d_ev,
                        delta_profit_factor=d_pf, delta_sharpe=d_sh, delta_max_dd=d_dd,
                        delta_trades=d_tr, impact_score=impact)
        )
        row = AblationRow(
            component=comp,
            disabled=True,
            metrics=m,
            delta_expectancy=d_ev,
            delta_profit_factor=d_pf,
            delta_sharpe=d_sh,
            delta_max_dd=d_dd,
            delta_trades=d_tr,
            impact_score=impact,
            verdict=verdict,
        )
        rows.append(row)
        if row.verdict == "helps":
            helps.append(comp)
        elif row.verdict == "hurts":
            hurts.append(comp)
        else:
            neutral.append(comp)

    return AblationReport(
        strategy="hft_orderbook",
        symbol=symbol,
        baseline=baseline_row,
        rows=rows,
        helps=helps,
        neutral=neutral,
        hurts=hurts,
    )

"""Main research framework orchestrator."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from backtest.fast_backtest import StrategyParams
from core.config import get_settings
from exchange.okx_rest import to_swap_symbol
from research.config import ExecutionModel, ResearchConfig
from research.data_loader import load_research_data
from research.metrics import ResearchMetrics, build_research_metrics
from research.oos import validate_hft_oos, validate_quant_oos
from research.recommendations import ResearchRecommendations, build_recommendations
from research.regime_breakdown import analyze_by_regime_hft, analyze_by_regime_quant
from research.report import export_report
from research.rolling import run_rolling_hft, run_rolling_quant
from research.stability import rank_quant_params
from research.walk_forward import run_walk_forward_hft, run_walk_forward_quant

log = logging.getLogger("research.framework")


@dataclass
class ResearchReport:
    generated_at: str
    elapsed_sec: float
    config: dict[str, Any]
    comparison: dict[str, Any] = field(default_factory=dict)
    recommendations: ResearchRecommendations | None = None
    stability_ranking: dict[str, Any] = field(default_factory=dict)
    html_path: str | None = None
    json_path: str | None = None


class ResearchFramework:
    """Full validation pipeline before ML / regime / optimization."""

    def __init__(self, config: ResearchConfig | None = None) -> None:
        self.config = config or ResearchConfig()
        self.settings = get_settings()

    def _default_params(self) -> StrategyParams:
        if self.config.quant_params:
            return self.config.quant_params
        s = self.settings
        return StrategyParams(
            tp_pct=s.trading_tp_pct,
            sl_pct=s.trading_sl_pct,
            trailing_pct=s.trading_trailing_pct,
            rsi_low=s.trading_rsi_low,
            rsi_high=s.trading_rsi_high,
            taker_fee_pct=self.config.execution.taker_fee_pct,
            slippage_pct=self.config.execution.slippage_pct,
        )

    def _default_execution(self) -> ExecutionModel:
        ex = self.config.execution
        s = self.settings
        ex.maker_fee_pct = ex.maker_fee_pct or s.trading_maker_fee_pct
        ex.taker_fee_pct = ex.taker_fee_pct or s.trading_taker_fee_pct
        ex.slippage_pct = ex.slippage_pct or s.trading_slippage_pct
        return ex

    async def _load_data(self) -> dict[str, pd.DataFrame]:
        pools = await load_research_data(
            self.config.symbols,
            self.config.timeframe,
            self.config.total_bars,
            offline=self.config.offline,
        )
        hft_pools = await load_research_data(
            self.config.symbols,
            self.config.hft_timeframe,
            self.config.hft_bars,
            offline=self.config.offline,
        )
        merged = {**pools}
        for sym, df in hft_pools.items():
            merged[f"{sym}:hft"] = df
        return merged

    async def run(self) -> ResearchReport:
        t0 = time.perf_counter()
        params = self._default_params()
        execution = self._default_execution()
        data = await self._load_data()

        comparison: dict[str, Any] = {}
        stability_data: dict[str, Any] = {}

        for symbol in self.config.symbols:
            swap = to_swap_symbol(symbol)
            quant_df = data.get(swap)
            hft_df = data.get(f"{swap}:hft")
            if hft_df is None:
                hft_df = quant_df

            if quant_df is None or len(quant_df) < 200:
                log.warning("Skip %s — insufficient quant data", swap)
                continue

            log.info("Validating quant_scalping on %s (%d bars)", swap, len(quant_df))
            quant_key = f"quant_scalping:{swap}"
            oos_q = validate_quant_oos(quant_df, params, execution, symbol=swap, holdout_pct=self.config.oos_holdout_pct)
            wf_q = run_walk_forward_quant(quant_df, params, execution, self.config, symbol=swap)
            roll_q = run_rolling_quant(quant_df, params, execution, self.config, symbol=swap)
            regime_q = analyze_by_regime_quant(quant_df, params, execution, symbol=swap)

            comparison[quant_key] = {
                "strategy": "quant_scalping",
                "symbol": swap,
                "oos": oos_q.out_of_sample.to_dict(),
                "in_sample": oos_q.in_sample.to_dict(),
                "walk_forward": (wf_q.aggregate_oos or ResearchMetrics()).to_dict(),
                "walk_forward_folds": len(wf_q.folds),
                "rolling": (roll_q.aggregate or ResearchMetrics()).to_dict(),
                "rolling_windows": len(roll_q.windows),
                "rolling_positive_pct": roll_q.positive_windows_pct,
                "regime": {
                    "by_regime": {k: v.to_dict() for k, v in regime_q.by_regime.items()},
                    "best": regime_q.best_regime,
                    "worst": regime_q.worst_regime,
                },
            }

            if hft_df is not None and len(hft_df) >= 200:
                log.info("Validating hft_orderbook on %s (%d bars)", swap, len(hft_df))
                hft_key = f"hft_orderbook:{swap}"
                oos_h = validate_hft_oos(hft_df, execution, symbol=swap, holdout_pct=self.config.oos_holdout_pct)
                wf_h = run_walk_forward_hft(hft_df, execution, self.config, symbol=swap)
                roll_h = run_rolling_hft(hft_df, execution, self.config, symbol=swap)
                regime_h = analyze_by_regime_hft(hft_df, execution, symbol=swap)

                comparison[hft_key] = {
                    "strategy": "hft_orderbook",
                    "symbol": swap,
                    "oos": oos_h.out_of_sample.to_dict(),
                    "in_sample": oos_h.in_sample.to_dict(),
                    "walk_forward": (wf_h.aggregate_oos or ResearchMetrics()).to_dict(),
                    "walk_forward_folds": len(wf_h.folds),
                    "rolling": (roll_h.aggregate or ResearchMetrics()).to_dict(),
                    "rolling_windows": len(roll_h.windows),
                    "rolling_positive_pct": roll_h.positive_windows_pct,
                    "regime": {
                        "by_regime": {k: v.to_dict() for k, v in regime_h.by_regime.items()},
                        "best": regime_h.best_regime,
                        "worst": regime_h.worst_regime,
                    },
                }

            ranking = rank_quant_params(quant_df, execution, self.config, symbol=swap)
            if ranking.best:
                stability_data[swap] = {
                    "best_params": ranking.best.params,
                    "rank_score": ranking.best.rank_score,
                    "oos": ranking.best.oos_metrics.to_dict(),
                    "top_3": [
                        {"params": r.params, "rank_score": r.rank_score, "oos": r.oos_metrics.to_dict()}
                        for r in ranking.ranked[:3]
                    ],
                }

        rec_input_simple = {
            k: {
                "strategy": v["strategy"],
                "symbol": v["symbol"],
                "oos": _dict_to_metrics(v.get("oos")),
                "walk_forward": _dict_to_metrics(v.get("walk_forward")),
                "rolling": _dict_to_metrics(v.get("rolling")),
            }
            for k, v in comparison.items()
        }
        recommendations = build_recommendations(rec_input_simple)

        elapsed = time.perf_counter() - t0
        report_dict = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "elapsed_sec": round(elapsed, 1),
            "config": {
                "symbols": self.config.symbols,
                "timeframe": self.config.timeframe,
                "train_bars": self.config.train_bars,
                "test_bars": self.config.test_bars,
                "oos_holdout_pct": self.config.oos_holdout_pct,
                "execution": {
                    "maker_fee_pct": execution.maker_fee_pct,
                    "taker_fee_pct": execution.taker_fee_pct,
                    "slippage_pct": execution.slippage_pct,
                    "latency_bars": execution.latency_bars,
                },
            },
            "comparison": comparison,
            "stability_ranking": stability_data,
            "recommendations": {
                "overall_verdict": recommendations.overall_verdict,
                "proceed_to_ml": recommendations.proceed_to_ml,
                "proceed_to_regime": recommendations.proceed_to_regime,
                "proceed_to_optimization": recommendations.proceed_to_optimization,
                "actions": recommendations.actions,
                "avoid": recommendations.avoid,
                "strategies": [
                    {
                        "strategy": v.strategy,
                        "symbol": v.symbol,
                        "viable": v.viable,
                        "confidence": v.confidence,
                        "summary": v.summary,
                        "warnings": v.warnings,
                        "strengths": v.strengths,
                    }
                    for v in recommendations.strategies
                ],
            },
        }

        html_path = None
        json_path = None
        if self.config.export_html:
            results_dir = Path(__file__).resolve().parent / "results"
            exported = export_report(report_dict, results_dir)
            html_path = str(exported)
            json_path = str(exported.with_suffix(".json"))

        return ResearchReport(
            generated_at=report_dict["generated_at"],
            elapsed_sec=elapsed,
            config=report_dict["config"],
            comparison=comparison,
            recommendations=recommendations,
            stability_ranking=stability_data,
            html_path=html_path,
            json_path=json_path,
        )


def _dict_to_metrics(d: dict | None) -> ResearchMetrics | None:
    if not d:
        return None
    fields = {f for f in ResearchMetrics.__dataclass_fields__ if f != "equity_curve"}
    kwargs = {k: v for k, v in d.items() if k in fields}
    m = ResearchMetrics(**kwargs)
    if d.get("has_edge") is not None:
        pass
    return m


async def run_research(config: ResearchConfig | None = None) -> ResearchReport:
    framework = ResearchFramework(config)
    return await framework.run()


def print_summary(report: ResearchReport) -> None:
    print("\n" + "=" * 60)
    print("RESEARCH VALIDATION SUMMARY")
    print("=" * 60)
    if report.recommendations:
        print(f"\n{report.recommendations.overall_verdict}\n")
        for v in report.recommendations.strategies:
            status = "VIABLE" if v.viable else "NOT VIABLE"
            print(f"  [{status}] {v.strategy} @ {v.symbol} — {v.summary}")
            for w in v.warnings[:2]:
                print(f"    ! {w}")
        print("\nNext steps:")
        for a in report.recommendations.actions[:4]:
            print(f"  -> {a}")

    print("\nMetrics comparison:")
    for key, data in report.comparison.items():
        oos = data.get("oos", {})
        print(
            f"  {key}: trades={oos.get('trades')} EV={oos.get('expectancy_pct')}% "
            f"PF={oos.get('profit_factor')} Sharpe={oos.get('sharpe_ratio')} "
            f"DD={oos.get('max_drawdown_pct')}%"
        )

    if report.html_path:
        print(f"\nReport: {report.html_path}")
    print(f"Elapsed: {report.elapsed_sec:.1f}s")


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    report = await run_research()
    print_summary(report)


if __name__ == "__main__":
    asyncio.run(_main())

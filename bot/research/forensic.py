"""Forensic quant research orchestrator — stages 1-6."""

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
from research.ablation import run_hft_ablation, run_quant_ablation
from research.chronological import run_hft_chronological, run_quant_chronological
from research.config import ExecutionModel, ResearchConfig
from research.cost_analysis import analyze_costs, build_cost_summary_from_dicts
from research.data_loader import load_research_data
from research.diagnostics import analyze_trades
from research.forensic_report import export_forensic_report
from research.lab_runner import run_all_hypotheses
from research.regime_study import study_regimes
from research.simulation_flags import HftSimulationFlags, SimulationFlags

log = logging.getLogger("research.forensic")


@dataclass
class ForensicConfig:
    symbols: list[str] = field(default_factory=lambda: ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"])
    timeframe: str = "5m"
    total_bars: int = 0
    offline: bool = True
    export_html: bool = True
    run_hypotheses: bool = True
    hypothesis_symbols: list[str] | None = None


@dataclass
class ForensicReport:
    generated_at: str
    elapsed_sec: float
    config: dict[str, Any]
    ablation: dict[str, Any] = field(default_factory=dict)
    diagnostics: dict[str, Any] = field(default_factory=dict)
    regimes: dict[str, Any] = field(default_factory=dict)
    costs: dict[str, Any] = field(default_factory=dict)
    hypotheses: list[dict[str, Any]] = field(default_factory=list)
    conclusions: dict[str, Any] = field(default_factory=dict)
    html_path: str | None = None
    json_path: str | None = None


class ForensicResearch:
    def __init__(self, config: ForensicConfig | None = None) -> None:
        self.config = config or ForensicConfig()
        self.settings = get_settings()

    def _params(self) -> StrategyParams:
        s = self.settings
        return StrategyParams(
            tp_pct=s.trading_tp_pct,
            sl_pct=s.trading_sl_pct,
            trailing_pct=s.trading_trailing_pct,
            rsi_low=s.trading_rsi_low,
            rsi_high=s.trading_rsi_high,
        )

    def _execution(self) -> ExecutionModel:
        s = self.settings
        return ExecutionModel(
            maker_fee_pct=s.trading_maker_fee_pct,
            taker_fee_pct=s.trading_taker_fee_pct,
            slippage_pct=s.trading_slippage_pct,
            funding_pct_per_8h=s.trading_funding_pct,
        )

    async def _load(self) -> dict[str, pd.DataFrame]:
        return await load_research_data(
            self.config.symbols,
            self.config.timeframe,
            self.config.total_bars,
            offline=self.config.offline,
        )

    async def run(self) -> ForensicReport:
        t0 = time.perf_counter()
        params = self._params()
        execution = self._execution()
        quant_flags = SimulationFlags.forensic_baseline(min_ev_usd=self.settings.trading_min_ev_usd)
        hft_flags = HftSimulationFlags.forensic_baseline(
            min_score=self.settings.trading_min_score,
            min_ev_usd=self.settings.trading_min_ev_usd,
        )
        data = await self._load()

        ablation: dict[str, Any] = {}
        diagnostics: dict[str, Any] = {}
        regimes: dict[str, Any] = {}
        cost_breakdowns: list[dict] = []
        all_hypothesis_results: list[dict] = []

        for symbol in self.config.symbols:
            swap = to_swap_symbol(symbol)
            df = data.get(swap)
            if df is None or len(df) < 200:
                log.warning("Skip %s — insufficient data", swap)
                continue

            log.info("Forensic quant_scalping %s (%d bars)", swap, len(df))
            ablation[f"quant_scalping:{swap}"] = run_quant_ablation(
                df, params, execution, symbol=swap, baseline_flags=quant_flags
            ).to_dict()

            q_trades = run_quant_chronological(df, params, execution, symbol=swap, flags=quant_flags)
            diagnostics[f"quant_scalping:{swap}"] = analyze_trades(q_trades, strategy="quant_scalping", symbol=swap).to_dict()
            regimes[f"quant_scalping:{swap}"] = study_regimes(q_trades, strategy="quant_scalping", symbol=swap).to_dict()
            cost_breakdowns.append(analyze_costs(q_trades, strategy="quant_scalping", symbol=swap).to_dict())

            log.info("Forensic hft_orderbook %s", swap)
            ablation[f"hft_orderbook:{swap}"] = run_hft_ablation(df, execution, symbol=swap, baseline_flags=hft_flags).to_dict()
            h_trades = run_hft_chronological(df, execution, symbol=swap, flags=hft_flags)
            diagnostics[f"hft_orderbook:{swap}"] = analyze_trades(h_trades, strategy="hft_orderbook", symbol=swap).to_dict()
            regimes[f"hft_orderbook:{swap}"] = study_regimes(h_trades, strategy="hft_orderbook", symbol=swap).to_dict()
            cost_breakdowns.append(analyze_costs(h_trades, strategy="hft_orderbook", symbol=swap).to_dict())

        if self.config.run_hypotheses:
            hyp_symbols = self.config.hypothesis_symbols or [self.config.symbols[0]]
            for symbol in hyp_symbols:
                swap = to_swap_symbol(symbol)
                df = data.get(swap)
                if df is None or len(df) < 500:
                    continue
                log.info("Research Lab hypotheses on %s", swap)
                results = run_all_hypotheses(df, execution, symbol=swap)
                all_hypothesis_results.extend([r.to_dict() for r in results])

        conclusions = _build_conclusions(ablation, diagnostics, cost_breakdowns, all_hypothesis_results)
        elapsed = time.perf_counter() - t0

        report_dict = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "elapsed_sec": round(elapsed, 1),
            "config": {
                "symbols": self.config.symbols,
                "timeframe": self.config.timeframe,
                "offline": self.config.offline,
            },
            "ablation": ablation,
            "diagnostics": diagnostics,
            "regimes": regimes,
            "costs": {
                "breakdowns": cost_breakdowns,
                "summary": build_cost_summary_from_dicts(cost_breakdowns),
            },
            "hypotheses": all_hypothesis_results,
            "conclusions": conclusions,
        }

        html_path = None
        json_path = None
        if self.config.export_html:
            results_dir = Path(__file__).resolve().parent / "results"
            html_path = str(export_forensic_report(report_dict, results_dir))
            json_path = str(Path(html_path).with_suffix(".json"))

        return ForensicReport(
            generated_at=report_dict["generated_at"],
            elapsed_sec=elapsed,
            config=report_dict["config"],
            ablation=ablation,
            diagnostics=diagnostics,
            regimes=regimes,
            costs=report_dict["costs"],
            hypotheses=all_hypothesis_results,
            conclusions=conclusions,
            html_path=html_path,
            json_path=json_path,
        )


def _build_conclusions(
    ablation: dict,
    diagnostics: dict,
    costs: list[dict],
    hypotheses: list[dict],
) -> dict[str, Any]:
    viable_strategies: list[str] = []
    remove_strategies: list[str] = []
    promising_hypotheses: list[str] = []
    proceed_ml = False

    for key, abl in ablation.items():
        baseline = abl.get("baseline", {}).get("metrics", {})
        if baseline.get("trades", 0) < 5:
            remove_strategies.append(f"{key} — no trades in forensic replay")
            continue
        if baseline.get("expectancy_pct", 0) > 0 and baseline.get("profit_factor", 0) > 1:
            viable_strategies.append(key)
        else:
            remove_strategies.append(f"{key} — negative OOS-like expectancy (EV={baseline.get('expectancy_pct')}%)")

    for h in hypotheses:
        if h.get("viable"):
            promising_hypotheses.append(h["hypothesis_id"])
        elif h.get("out_of_sample", {}).get("expectancy_pct", -99) > -0.05 and h.get("overfitting_score", 2) < 1.0:
            promising_hypotheses.append(f"{h['hypothesis_id']} (weak — needs more data)")

    viable_hyp = [h for h in hypotheses if h.get("viable")]
    proceed_ml = len(viable_hyp) > 0 or len(viable_strategies) > 0

    if not viable_strategies and not viable_hyp:
        ml_note = (
            "Ни одна гипотеза не показывает устойчивого положительного OOS результата. "
            "Дальнейшее усложнение модели (ML/LLM) нецелесообразно до появления новой торговой идеи."
        )
    elif viable_hyp and not viable_strategies:
        ml_note = "Существующие стратегии не жизнеспособны, но отдельные lab-гипотезы заслуживают углублённого исследования."
    else:
        ml_note = "Есть статистические сигналы — можно переходить к regime-фильтрации и контролируемой оптимизации."

    friction_notes = []
    for c in costs:
        if c.get("logic_edge_pct", 0) > 0 and c.get("avg_pnl_full_pct", 0) < 0:
            friction_notes.append(
                f"{c['strategy']}@{c['symbol']}: edge до издержек {c['logic_edge_pct']:.3f}%, после {c['avg_pnl_full_pct']:.3f}%"
            )

    return {
        "viable_strategies": viable_strategies,
        "remove_strategies": remove_strategies,
        "promising_hypotheses": promising_hypotheses,
        "proceed_to_ml": proceed_ml,
        "ml_note": ml_note,
        "friction_notes": friction_notes,
        "forensic_findings": _forensic_findings(ablation, diagnostics),
    }


def _forensic_findings(ablation: dict, diagnostics: dict) -> list[str]:
    findings: list[str] = []
    for key, abl in ablation.items():
        hurts = abl.get("hurts", [])
        helps = abl.get("helps", [])
        if hurts:
            findings.append(f"{key}: фильтры, ухудшающие результат — {', '.join(hurts[:5])}")
        if helps:
            findings.append(f"{key}: полезные фильтры — {', '.join(helps[:5])}")
        baseline = abl.get("baseline", {}).get("metrics", {})
        if baseline.get("trades", 0) == 0 and "hft" in key:
            findings.append(
                f"{key}: 0 сделок — HFT на OHLCV не воспроизводим (нужен live orderbook или L2 история)"
            )
    for key, diag in diagnostics.items():
        for driver in diag.get("loss_drivers", [])[:2]:
            findings.append(f"{key}: {driver}")
    return findings


async def run_forensic(config: ForensicConfig | None = None) -> ForensicReport:
    return await ForensicResearch(config).run()


def print_forensic_summary(report: ForensicReport) -> None:
    print("\n" + "=" * 60)
    print("FORENSIC QUANT RESEARCH SUMMARY")
    print("=" * 60)
    c = report.conclusions
    print(f"\n{c.get('ml_note', '')}\n")
    print("Viable strategies:", c.get("viable_strategies") or "none")
    print("Remove / fix:", c.get("remove_strategies", [])[:3])
    print("Promising hypotheses:", c.get("promising_hypotheses", [])[:5])
    print("Proceed to ML:", c.get("proceed_to_ml"))
    for f in c.get("forensic_findings", [])[:6]:
        print(f"  • {f}")
    if report.html_path:
        print(f"\nReport: {report.html_path}")
    print(f"Elapsed: {report.elapsed_sec:.1f}s")

"""Automatic research recommendations based on validation results."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from research.metrics import ResearchMetrics


@dataclass
class StrategyVerdict:
    strategy: str
    symbol: str
    viable: bool
    confidence: str
    summary: str
    warnings: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)


@dataclass
class ResearchRecommendations:
    overall_verdict: str
    proceed_to_ml: bool
    proceed_to_regime: bool
    proceed_to_optimization: bool
    strategies: list[StrategyVerdict] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    avoid: list[str] = field(default_factory=list)


def _assess_strategy(
    strategy: str,
    symbol: str,
    oos: ResearchMetrics | None,
    walk_forward: ResearchMetrics | None,
    rolling: ResearchMetrics | None,
) -> StrategyVerdict:
    warnings: list[str] = []
    strengths: list[str] = []

    oos = oos or ResearchMetrics()
    wf = walk_forward or ResearchMetrics()
    roll = rolling or ResearchMetrics()

    metrics_list = [m for m in (oos, wf, roll) if m.trades >= 3]
    positive_oos = sum(1 for m in metrics_list if m.expectancy_pct > 0 and m.profit_factor > 1.0)
    total_checks = len(metrics_list) or 1

    viable = (
        oos.trades >= 5
        and oos.expectancy_pct > 0
        and oos.profit_factor > 1.0
        and positive_oos >= 2
        and wf.stability_score >= 40
    )

    if oos.trades < 5:
        warnings.append("Недостаточно сделок для статистически значимого вывода.")
    if oos.expectancy_pct <= 0:
        warnings.append("OOS expectancy <= 0 — net edge after costs is not positive.")
    if oos.profit_factor <= 1.0:
        warnings.append("Profit Factor <= 1 — gross edge does not cover fees and slippage.")
    if wf.stability_score < 50:
        warnings.append(f"Walk-forward stability {wf.stability_score:.0f}% — результат нестабилен между периодами.")
    if roll.sharpe_ratio < 0 and roll.trades >= 5:
        warnings.append("Rolling Sharpe отрицательный — периодические просадки доминируют.")

    if oos.expectancy_pct > 0.02:
        strengths.append(f"Положительный OOS expectancy: {oos.expectancy_pct:.3f}% на сделку.")
    if oos.sharpe_ratio > 0.5:
        strengths.append(f"Sharpe OOS: {oos.sharpe_ratio:.2f}.")
    if wf.stability_score >= 55:
        strengths.append(f"Walk-forward: {wf.stability_score:.0f}% фолдов с положительным EV.")

    if viable:
        confidence = "medium" if wf.stability_score < 65 else "high"
        summary = "Стратегия показывает устойчивое положительное мат. ожидание на независимых выборках."
    elif positive_oos >= 1:
        confidence = "low"
        summary = "Слабые признаки edge — требуется больше данных или доработка параметров."
        viable = False
    else:
        confidence = "none"
        summary = "Стратегия не прошла валидацию. ML не исправит фундаментальную проблему."

    return StrategyVerdict(
        strategy=strategy,
        symbol=symbol,
        viable=viable,
        confidence=confidence,
        summary=summary,
        warnings=warnings,
        strengths=strengths,
    )


def build_recommendations(comparison: dict[str, Any]) -> ResearchRecommendations:
    verdicts: list[StrategyVerdict] = []

    for key, data in comparison.items():
        verdicts.append(
            _assess_strategy(
                data["strategy"],
                data["symbol"],
                data.get("oos"),
                data.get("walk_forward"),
                data.get("rolling"),
            )
        )

    viable_strats = [v for v in verdicts if v.viable]
    best = max(verdicts, key=lambda v: (v.viable, len(v.strengths)), default=None)

    if not viable_strats:
        overall = "НИ ОДНА стратегия не показала устойчивого положительного EV после комиссий и slippage."
        proceed_ml = False
        proceed_regime = False
        proceed_opt = False
        actions = [
            "Не переходить к ML — сначала исправить логику входа/выхода или фильтры.",
            "Пересмотреть TP/SL, min EV, min score на реальных OHLCV.",
            "Увеличить выборку данных (больше баров / больше пар).",
            "Проверить, не переобучены ли текущие параметры на in-sample.",
        ]
        avoid = [
            "Замена стратегий на LLM.",
            "Добавление десятков новых индикаторов без валидации.",
            "Оптимизация только по итоговой прибыли без walk-forward.",
        ]
    else:
        names = ", ".join(f"{v.strategy} ({v.symbol})" for v in viable_strats)
        overall = f"Рабочая база обнаружена: {names}. Можно развивать систему дальше."
        proceed_ml = len(viable_strats) >= 1 and any(v.confidence == "high" for v in viable_strats)
        proceed_regime = True
        proceed_opt = True
        actions = [
            f"Приоритет: Market Regime + адаптация для {best.strategy if best else 'лучшей стратегии'}.",
            "Запустить walk-forward / Bayesian оптимизацию только для viable стратегий.",
            "Портфель: распределить риск между инструментами с положительным OOS.",
        ]
        if proceed_ml:
            actions.append("ML как фильтр вероятности/EV, не как замена стратегии.")
        avoid = [
            "«Бот, который всегда в плюс» — нереалистичная цель.",
            "Усложнение входов без OOS-подтверждения.",
        ]

    return ResearchRecommendations(
        overall_verdict=overall,
        proceed_to_ml=proceed_ml,
        proceed_to_regime=proceed_regime,
        proceed_to_optimization=proceed_opt,
        strategies=verdicts,
        actions=actions,
        avoid=avoid,
    )

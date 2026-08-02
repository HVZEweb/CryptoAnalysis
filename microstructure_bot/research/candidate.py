"""Alpha candidate and no-edge report generation."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def write_report_alpha_candidate(
    hypothesis: dict,
    exploration: dict,
    validations: list[dict],
    *,
    out_dir: Path,
    fee_cost_pct: float,
) -> Path:
    """Phase 3 — report_alpha_candidate.md"""
    path = out_dir / "report_alpha_candidate.md"
    h = next(
        (x for x in exploration.get("horizons", []) if x.get("horizon_sec") == exploration.get("best_horizon_sec")),
        {},
    )
    lines = [
        "# Report — Alpha Candidate (Phase 3)",
        "",
        f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
        f"**Hypothesis:** {hypothesis.get('id')}",
        f"**Question:** {hypothesis.get('question')}",
        "",
        "## Описание события",
        "",
        hypothesis.get("description", ""),
        "",
        "## Статистика",
        "",
        f"| Метрика | Gross | Net (after fees) |",
        f"|---------|-------|------------------|",
        f"| Events | {exploration.get('count', 0)} | — |",
        f"| Expectancy | {h.get('expectancy_pct')}% | {exploration.get('net_expectancy')}% |",
        f"| Profit Factor | {h.get('profit_factor')} | {exploration.get('net_pf')} |",
        f"| Prob Up | {h.get('prob_up_pct')}% | — |",
        f"| Prob Down | {h.get('prob_down_pct')}% | — |",
        f"| MAE | {h.get('mae_pct')}% | — |",
        f"| MFE | {h.get('mfe_pct')}% | — |",
        f"| Horizon | {exploration.get('best_horizon_sec')}s | — |",
        f"| Round-trip cost | — | {fee_cost_pct:.4f}% |",
        "",
        "## Устойчивость",
        "",
    ]
    for v in validations:
        lines.append(f"- **{v.get('symbol')}**: {v.get('verdict')} (OOS EV={v.get('test_ev')}, boot p={v.get('bootstrap_p')})")
    lines += [
        "",
        "## Экономическое объяснение",
        "",
        hypothesis.get("economic", _economic_note(hypothesis.get("id", ""))),
        "",
        "## Ограничения",
        "",
        "- Не интегрировано в торгового бота автоматически",
        "- Требуется paper trading и независимая проверка",
        f"- Издержки: {fee_cost_pct:.4f}% round-trip (taker+slippage)",
        "",
        "## Рекомендации по paper trading",
        "",
        "1. Запустить `execution/paper_engine.py` с latency simulation",
        "2. Повторить на новых данных (out-of-time)",
        "3. Ручной review перед live",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_report_no_edge(
    hypothesis: dict,
    *,
    exploration: dict,
    validations: list[dict],
    data_summary: dict,
    rejection_reasons: list[str],
    out_dir: Path,
) -> Path:
    """Phase 3 — report_no_edge.md"""
    path = out_dir / "report_no_edge.md"
    lines = [
        "# Report — No Edge (Phase 3)",
        "",
        f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
        f"**Hypothesis:** {hypothesis.get('id')}",
        f"**Question:** {hypothesis.get('question')}",
        "",
        "## Вердикт",
        "",
        "Статистически воспроизводимое преимущество **не обнаружено** для данной гипотезы.",
        "",
        "## Что исследовали",
        "",
        hypothesis.get("description", ""),
        "",
        "## Выборка",
        "",
        f"- Events detected: **{exploration.get('count', 0)}**",
        f"- Orderbook rows: {data_summary.get('orderbook_rows', 0)}",
        f"- Trade rows: {data_summary.get('trade_rows', 0)}",
        f"- Symbols with data: {data_summary.get('symbols_with_data', [])}",
        "",
        "## Проверки выполнены",
        "",
        "- Train/Test split",
        "- Walk-forward",
        "- Out-of-sample",
        "- Bootstrap significance",
        "- Independent days",
        "- Cross-symbol (BTC, ETH, SOL)",
        "- Net returns after fees + slippage",
        "",
        "## Почему гипотеза отвергнута",
        "",
    ]
    for r in rejection_reasons:
        lines.append(f"- {r}")
    if validations:
        lines.append("")
        lines.append("### Per-symbol validation")
        for v in validations:
            lines.append(f"- {v.get('symbol')}: {v.get('verdict')}")
    lines += [
        "",
        "## Экономическое объяснение (ожидаемое)",
        "",
        hypothesis.get("economic", ""),
        "",
        "**Торговая стратегия не создавалась.**",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_alpha_candidate(entry: dict[str, Any], exploration: dict, validations: list[dict], out_dir: Path) -> Path:
    path = out_dir / "alpha_candidate.md"
    horizons = exploration.get("horizons", [])
    h = next((x for x in horizons if x.get("horizon_sec") == entry.get("horizon_sec")), {})

    lines = [
        "# Alpha Candidate — Microstructure Event",
        "",
        f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
        f"**Event:** `{entry.get('event_key')}`",
        f"**Horizon:** {entry.get('horizon_sec')}s",
        f"**Rank:** #{entry.get('rank', 1)}",
        "",
        "## Что произошло",
        "",
        f"Обнаружено **{exploration.get('count', 0)}** событий типа `{entry.get('event_key')}` "
        f"на основе статистических квантилей (без фиксированных порогов).",
        "",
        "## Почему интересно",
        "",
        "Событие отражает аномалию в микроструктуре: стакан, поток сделок или ликвидность "
        "отклонились от типичного распределения (верхние 1%/5%/10% квантили).",
        "",
        "## Статистика",
        "",
        f"| Метрика | Значение |",
        f"|---------|----------|",
        f"| Expectancy | {h.get('expectancy_pct', entry.get('expectancy'))}% |",
        f"| Profit Factor | {h.get('profit_factor', entry.get('profit_factor'))} |",
        f"| Win Rate | {h.get('win_rate')}% |",
        f"| Prob Up | {h.get('prob_up_pct')}% |",
        f"| Prob Down | {h.get('prob_down_pct')}% |",
        f"| MAE | {h.get('mae_pct')}% |",
        f"| MFE | {h.get('mfe_pct')}% |",
        f"| Bootstrap p | {entry.get('bootstrap_p')} |",
        "",
        "## Валидация",
        "",
        f"- OOS: {'PASS' if entry.get('oos_pass') else 'FAIL'}",
        f"- Walk-forward: {'PASS' if entry.get('walk_forward_stable') else 'FAIL'}",
        f"- Independent days: {'PASS' if entry.get('independent_days_pass') else 'FAIL'}",
        f"- Cross-symbol (BTC+ETH+SOL): {'PASS' if entry.get('cross_symbol_pass') else 'FAIL'}",
        f"- Symbols passed: {', '.join(entry.get('symbols_passed', []))}",
        "",
        "## Возможное экономическое объяснение",
        "",
        _economic_note(entry.get("event_key", "")),
        "",
        "## Примеры (первые события)",
        "",
    ]
    for s in exploration.get("labeled_sample", [])[:5]:
        lines.append(f"- ts={s.get('ts')} mid={s.get('mid')} event={s.get('event')}")

    lines += [
        "",
        "## Ограничения",
        "",
        "- Исследовательский результат — **не интегрирован в торгового бота**",
        "- Требуется ручной review и paper trading",
        "- Результат чувствителен к режиму рынка и ликвидности",
        "- Не учтены все торговые издержки в event study",
        "",
        "## Следующие шаги",
        "",
        "1. Paper trading на `execution/paper_engine.py`",
        "2. Независимая проверка на новых данных",
        "3. Ручное решение о live",
    ]

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_no_edge_report(
    ranking: list[dict],
    *,
    data_summary: dict,
    out_dir: Path,
) -> Path:
    path = out_dir / "no_edge_report.md"
    lines = [
        "# Итоговый отчёт — Edge не обнаружен",
        "",
        f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
        "",
        "## Вердикт",
        "",
        "На доступном объёме данных микроструктуры **не найдено ни одного события**, "
        "которое прошло все проверки:",
        "",
        "- train/test split с положительным OOS",
        "- walk-forward stability",
        "- bootstrap significance (p < 0.05)",
        "- independent days",
        "- воспроизведение на BTC, ETH и SOL",
        "",
        "## Данные",
        "",
        f"- Symbols: {data_summary.get('symbols', [])}",
        f"- Orderbook rows: {data_summary.get('orderbook_rows', 0)}",
        f"- Trade rows: {data_summary.get('trade_rows', 0)}",
        f"- Hourly stats rows: {data_summary.get('stats_rows', 0)}",
        "",
        "## Протестировано событий",
        "",
        f"Всего кандидатов в рейтинге: **{len(ranking)}**",
        "",
    ]
    if ranking:
        lines.append("| Rank | Event | Horizon | EV% | PF | Cross |")
        lines.append("|------|-------|---------|-----|-----|-------|")
        for r in ranking[:15]:
            lines.append(
                f"| {r.get('rank')} | {r.get('event_key')} | {r.get('horizon_sec')}s "
                f"| {r.get('expectancy')} | {r.get('profit_factor')} "
                f"| {'Y' if r.get('cross_symbol_pass') else 'N'} |"
            )
    lines += [
        "",
        "## Что может изменить вывод",
        "",
        "- Накопление недель/месяцев непрерывного `collect`",
        "- Более глубокий L2 (books-l2-tbt)",
        "- Кросс-биржевой basis",
        "- Режимы высокой волатильности (отдельная выборка)",
        "",
        "**Торговый алгоритм не создавался** — только исследование.",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _economic_note(event_key: str) -> str:
    notes = {
        "extreme_imbalance": "Дисбаланс глубины стакана может отражать краткосрочное давление одной стороны.",
        "depth_vanish": "Исчезновение ликвидности часто предшествует импульсу или повышенной волатильности.",
        "spread_expand": "Расширение спреда — маркет-мейкеры снимают риск; возможен mean-reversion или продолжение.",
        "spread_compress": "Сжатие спреда — конкуренция ликвидности; часто предшествует пробою.",
        "absorption": "Пассивная сторона поглощает агрессию — возможен разворот или накопление позиции.",
        "sweep": "Агрессивный проход уровней — информационный поток или принудительное исполнение.",
        "replenishment": "Быстрое восстановление ликвидности — скрытый MM или iceberg.",
    }
    for k, v in notes.items():
        if k in event_key:
            return v
    return "Аномалия микроструктуры требует дополнительного контекста."

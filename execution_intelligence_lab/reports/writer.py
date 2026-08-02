"""Research report writers — no automatic strategy generation."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def write_execution_alpha_candidate(
    pattern: dict[str, Any],
    exploration: dict[str, Any],
    validations: list[dict[str, Any]],
    *,
    out_dir: Path,
    fee_cost_pct: float,
) -> Path:
    path = out_dir / "execution_alpha_candidate.md"
    h = next(
        (x for x in exploration.get("horizons", []) if x.get("horizon_sec") == exploration.get("best_horizon_sec")),
        {},
    )
    lines = [
        "# Execution Alpha Candidate",
        "",
        f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
        f"**Pattern:** {pattern.get('id')}",
        f"**Category:** {pattern.get('category', '—')}",
        f"**Question:** {pattern.get('question')}",
        "",
        "## Описание события",
        "",
        pattern.get("description", ""),
        "",
        "## Статистика (Event Study)",
        "",
        "| Метрика | Значение |",
        "|---------|----------|",
        f"| Events | {exploration.get('count', 0)} |",
        f"| Horizon | {exploration.get('best_horizon_sec')}s |",
        f"| Expectancy (net) | {exploration.get('net_expectancy')}% |",
        f"| Profit Factor (net) | {exploration.get('net_pf')} |",
        f"| Win Rate | {h.get('win_rate')}% |",
        f"| MAE | {h.get('mae_pct')}% |",
        f"| MFE | {h.get('mfe_pct')}% |",
        f"| Information Coefficient | {h.get('information_coefficient')} |",
        f"| Round-trip cost | {fee_cost_pct:.4f}% |",
        "",
        "## Валидация",
        "",
        "Train/Test · Walk-forward · Bootstrap · OOS · Cross-symbol · Cross-session · Cross-day",
        "",
    ]
    for v in validations:
        lines.append(
            f"- **{v.get('symbol')}**: {v.get('verdict')} "
            f"(OOS EV={v.get('test_ev')}, boot p={v.get('bootstrap_p')}, "
            f"sessions={v.get('cross_session_pass')}, days={v.get('cross_day_pass')})"
        )

    lines += [
        "",
        "## Экономическое объяснение",
        "",
        pattern.get("economic", ""),
        "",
        "## Ограничения",
        "",
        "- Лабораторный результат — не торговая стратегия",
        "- Не интегрируется в Unified Trading Bot автоматически",
        "- Требуется ручной review и paper trading",
        f"- Издержки модели: {fee_cost_pct:.4f}% round-trip",
        "",
        "## Риск переобучения",
        "",
        "- Пороги определены квантилями на том же сэмпле — требуется out-of-time проверка",
        "- При малом числе событий bootstrap может быть нестабилен",
        "- Cross-symbol gate снижает, но не устраняет риск data-snooping",
        "",
        "## Требования к дополнительной проверке",
        "",
        "1. Повторить на новых данных (Execution Intelligence Lab — новый цикл)",
        "2. Manual Review → Alpha Proposal",
        "3. Paper trading с latency simulation",
        "4. Явное утверждение перед любой интеграцией в Unified Trading Bot",
        "",
        "## Экосистема",
        "",
        "```",
        "Execution Intelligence Lab → Microstructure Lab → Research Validation",
        "→ Alpha Proposal → Manual Review → Unified Trading Bot",
        "```",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_no_edge_report(
    pattern: dict[str, Any],
    *,
    exploration: dict[str, Any],
    validations: list[dict[str, Any]],
    rejection_reasons: list[str],
    data_summary: dict[str, Any],
    out_dir: Path,
) -> Path:
    path = out_dir / "execution_no_edge.md"
    lines = [
        "# Execution Research — No Edge",
        "",
        f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
        f"**Pattern:** {pattern.get('id')}",
        f"**Question:** {pattern.get('question')}",
        "",
        "## Результат",
        "",
        "Гипотеза **отклонена**. Параметры не оптимизировались.",
        "",
        "## Причины отказа",
        "",
    ]
    for r in rejection_reasons:
        lines.append(f"- {r}")
    lines += [
        "",
        "## Данные",
        "",
        f"- Orderbook rows: {data_summary.get('orderbook_rows', 0)}",
        f"- Trade rows: {data_summary.get('trade_rows', 0)}",
        f"- Events detected: {exploration.get('count', 0)}",
        "",
        "## Вывод",
        "",
        "Отрицательный результат зафиксирован честно. Накопление данных продолжается без изменения критериев.",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path

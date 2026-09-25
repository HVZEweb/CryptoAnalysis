"""Auto-generated documents — integration proposal and final conclusion."""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path

from alpha_registry.schema import AlphaRecord, AlphaStatus

_PROPOSALS_DIR = Path(__file__).resolve().parent / "proposals"
FINAL_CONCLUSION_PATH = _PROPOSALS_DIR / "final_research_conclusion.md"
FINAL_MIN_DAYS = int(os.getenv("REGISTRY_FINAL_MIN_DAYS", "90"))
FINAL_MIN_RECORDS = int(os.getenv("REGISTRY_FINAL_MIN_RECORDS", "8"))


def _safe_filename(registry_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", registry_id)


def proposal_path(registry_id: str) -> Path:
    return _PROPOSALS_DIR / f"integration_proposal_{_safe_filename(registry_id)}.md"


def generate_integration_proposal(record: AlphaRecord) -> Path:
    """Create integration proposal when hypothesis becomes validated. No bot changes."""
    _PROPOSALS_DIR.mkdir(parents=True, exist_ok=True)
    path = proposal_path(record.registry_id)
    v = record.validation
    m = record.metrics
    d = record.data

    lines = [
        "# Integration Proposal",
        "",
        f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
        f"**Registry ID:** {record.registry_id}",
        f"**Source Lab:** {record.source_lab}",
        f"**Status:** validated (manual review completed)",
        "",
        "> Документ для рассмотрения. **Интеграция в Unified Trading Bot не выполняется автоматически.**",
        "> Требуется отдельный pull request после вашего решения.",
        "",
        "## Описание идеи",
        "",
        f"**{record.title}**",
        "",
        record.description,
        "",
        "## Статистика",
        "",
        "| Метрика | Значение |",
        "|---------|----------|",
        f"| Expectancy (net) | {m.expectancy_pct}% |",
        f"| Profit Factor (net) | {m.profit_factor} |",
        f"| Horizon | {m.horizon_sec}s |",
        f"| Information Coefficient | {m.information_coefficient} |",
        f"| MAE | {m.mae_pct}% |",
        f"| MFE | {m.mfe_pct}% |",
        f"| Events | {d.events_total} |",
        f"| Orderbook rows | {d.orderbook_rows:,} |",
        f"| OOS pass | {v.oos_pass} |",
        f"| Walk-forward stable | {v.walk_forward_stable} |",
        f"| Bootstrap p (min) | {v.bootstrap_p_min} |",
        f"| Cross-symbol | {v.cross_symbol_pass} |",
        "",
        "## Экономическое объяснение",
        "",
        record.economic_rationale or "—",
        "",
        "## Ограничения",
        "",
    ]
    for lim in record.limitations:
        lines.append(f"- {lim}")
    lines += [
        "",
        f"**Риск переобучения:** {record.overfitting_risk or '—'}",
        "",
        "## Ожидаемый риск",
        "",
        "- Квантили и критерии определены на накопленном сэмпле — возможна деградация out-of-time",
        "- Исполнение на live: проскальзывание, latency, funding",
        f"- Round-trip cost model: {d.fee_cost_pct}%",
        "- Режим рынка может измениться после периода исследования",
        "",
        "## Необходимые изменения в Unified Trading Bot",
        "",
        "1. **Отдельный PR** — не автоматический merge",
        f"2. Модуль сигнала для `{record.hypothesis_id}` из `{record.source_lab}`",
        "3. Paper execution path с latency simulation",
        "4. Логирование и мониторинг отклонения от исследовательских метрик",
        "5. Feature flag / kill switch до подтверждения live",
        "",
        "## Влияние на риск-менеджмент",
        "",
        "- Оценить max position size относительно глубины стакана на момент события",
        "- Добавить лимит частоты сделок по типу события",
        "- Correlation с существующими стратегиями бота (spread, etc.)",
        "- Стресс-тест при расширении spread и падении ликвидности",
        "",
        "## План paper trading",
        "",
        "1. Запуск на новых данных (out-of-time), минимум 2–4 недели",
        "2. Сравнение live paper EV/PF с registry metrics",
        "3. Журнал отклонений и false positives",
        "4. Review после paper — решение о live или retired",
        "",
        "## Критерии перехода в live",
        "",
        "- Paper EV > 0 после fees на N ≥ 30 событий",
        "- PF ≥ 1.2 на paper",
        "- Нет деградации vs registry OOS > 50%",
        "- Явное ручное утверждение",
        "- Risk limits настроены и протестированы",
        "",
        "## Workflow",
        "",
        "```",
        "Execution Intelligence Lab → Microstructure Lab → Alpha Registry",
        "→ Manual Review (validated) → THIS PROPOSAL → PR → Unified Trading Bot",
        "```",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")

    latest = _PROPOSALS_DIR / "integration_proposal.md"
    latest.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    return path


def generate_final_research_conclusion(records: list[AlphaRecord], *, observation_days: int) -> Path:
    """Final document when no validated hypotheses after long observation."""
    _PROPOSALS_DIR.mkdir(parents=True, exist_ok=True)

    by_status: dict[str, list[AlphaRecord]] = {}
    for r in records:
        by_status.setdefault(r.status, []).append(r)

    rejected = by_status.get(AlphaStatus.REJECTED.value, [])
    candidates = by_status.get(AlphaStatus.CANDIDATE.value, [])
    validated = by_status.get(AlphaStatus.VALIDATED.value, [])
    retired = by_status.get(AlphaStatus.RETIRED.value, [])

    labs = sorted({r.source_lab for r in records})
    hypotheses = [f"- `{r.registry_id}` — {r.title[:80]}" for r in records]

    common_rejections: dict[str, int] = {}
    for r in rejected:
        for reason in r.limitations[:2]:
            key = reason[:80]
            common_rejections[key] = common_rejections.get(key, 0) + 1
    top_reasons = sorted(common_rejections.items(), key=lambda x: -x[1])[:8]

    lines = [
        "# Final Research Conclusion",
        "",
        f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
        f"**Observation period:** ≥ {observation_days} days",
        f"**Validated hypotheses:** {len(validated)}",
        "",
        "## Вывод",
        "",
        "За период непрерывного исследования **ни одна гипотеза не достигла статуса validated** "
        "в Alpha Registry после ручного review. Отрицательный результат зафиксирован как полноценный "
        "исследовательский итог.",
        "",
        "## Проверенные гипотезы",
        "",
        f"Всего записей в реестре: **{len(records)}**",
        f"Лаборатории: {', '.join(labs)}",
        "",
    ]
    lines.extend(hypotheses or ["—"])
    lines += [
        "",
        "## Статусы",
        "",
        f"- Rejected: {len(rejected)}",
        f"- Candidate (ожидают review): {len(candidates)}",
        f"- Validated: {len(validated)}",
        f"- Retired: {len(retired)}",
        "",
        "## Почему отвергнуты (типичные причины)",
        "",
    ]
    for reason, count in top_reasons:
        lines.append(f"- ({count}×) {reason}")
    if not top_reasons:
        lines.append("- Недостаточно событий, cross-symbol fail, OOS/bootstrap fail")

    lines += [
        "",
        "## Данные, оказавшиеся недостаточными",
        "",
        "- Короткая история L2/trades — мало экстремальных квантильных событий",
        "- 25–30 минут снимков недостаточно для q99-событий на 3 символах",
        "- Funding/OI без длинного горизонта не дали отдельного edge в текущих гипотезах",
        "",
        "## Перспективные направления",
        "",
        "- Продолжить накопление без изменения критериев (Continuous Research)",
        "- Execution Intelligence Lab: TWAP/VWAP/iceberg при длинной истории",
        "- Microstructure Lab: существующие 8 гипотез на месяцах данных",
        "- Out-of-time повторение candidate перед validated",
        "",
        "## Стоит ли продолжать исследования?",
        "",
        "**Да**, при условии:",
        "- Сборщики работают непрерывно",
        "- Критерии и признаки не подгоняются",
        "- Alpha Registry фиксирует все результаты",
        "- Unified Trading Bot не меняется без PR",
        "",
        "Прекратить имеет смысл только если после **≥6 месяцев** данных повторные циклы "
        "не улучшают bootstrap/OOS на тех же гипотезах.",
        "",
        "## Принцип",
        "",
        "Платформа одинаково честно фиксирует наличие и отсутствие статистического преимущества. "
        "Этот документ — полноценный результат исследования.",
    ]
    FINAL_CONCLUSION_PATH.write_text("\n".join(lines), encoding="utf-8")
    return FINAL_CONCLUSION_PATH


def observation_days_since(started_at: str | None) -> int:
    if not started_at:
        return 0
    try:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - start
        return max(0, delta.days)
    except Exception:
        return 0

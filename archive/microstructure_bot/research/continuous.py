"""Continuous Research — daily health checks and weekly hypothesis cycles."""

from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from collector.storage import ParquetStore
from config import Config
from research.pipeline import list_hypotheses, run_hypothesis_study

log = logging.getLogger("msb.continuous")

KINDS = ("orderbook", "trades", "ticker", "statistics")
MIN_ORDERBOOK_ROWS_PER_SYMBOL = 500
STALE_HOURS = 24
FINAL_REPORT_MIN_SPAN_DAYS = 28
FINAL_REPORT_MIN_WEEKS = 4


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_study_ts(path: Path) -> datetime | None:
    m = path.stem.split("_")
    if len(m) < 3:
        return None
    raw = f"{m[-2]}_{m[-1]}"
    try:
        return datetime.strptime(raw, "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _inventory_symbol(store: ParquetStore, kind: str, symbol: str) -> dict[str, Any]:
    files = store.list_files(kind, symbol)
    rows = 0
    days: list[str] = []
    last_ts_ms: int | None = None

    for f in files:
        days.append(f.stem)
        try:
            df = pd.read_parquet(f, columns=["ts"])
            rows += len(df)
            if not df.empty:
                ts = int(df["ts"].max())
                if last_ts_ms is None or ts > last_ts_ms:
                    last_ts_ms = ts
        except Exception:
            try:
                df = pd.read_parquet(f)
                rows += len(df)
                if "ts" in df.columns and not df.empty:
                    ts = int(df["ts"].max())
                    if last_ts_ms is None or ts > last_ts_ms:
                        last_ts_ms = ts
            except Exception as e:
                log.warning("Read failed %s: %s", f, e)

    days_sorted = sorted(set(days))
    span_days = 0
    if len(days_sorted) >= 2:
        d0 = datetime.strptime(days_sorted[0], "%Y-%m-%d").date()
        d1 = datetime.strptime(days_sorted[-1], "%Y-%m-%d").date()
        span_days = (d1 - d0).days + 1

    missing_days: list[str] = []
    if len(days_sorted) >= 2:
        cur = datetime.strptime(days_sorted[0], "%Y-%m-%d").date()
        end = datetime.strptime(days_sorted[-1], "%Y-%m-%d").date()
        have = set(days_sorted)
        while cur <= end:
            ds = cur.strftime("%Y-%m-%d")
            if ds not in have:
                missing_days.append(ds)
            cur += timedelta(days=1)

    return {
        "files": len(files),
        "rows": rows,
        "first_day": days_sorted[0] if days_sorted else None,
        "last_day": days_sorted[-1] if days_sorted else None,
        "span_days": span_days,
        "missing_days": missing_days,
        "last_ts_ms": last_ts_ms,
        "last_ts": (
            datetime.fromtimestamp(last_ts_ms / 1000, tz=timezone.utc).isoformat()
            if last_ts_ms
            else None
        ),
    }


def build_data_inventory(config: Config) -> dict[str, Any]:
    store = ParquetStore(config.data_dir)
    per_kind: dict[str, dict[str, Any]] = {}
    totals = {"files": 0, "rows": 0}
    all_missing: list[str] = []
    stale_symbols: list[str] = []
    now = _utc_now()

    for kind in KINDS:
        per_kind[kind] = {}
        for sym in config.symbols:
            inv = _inventory_symbol(store, kind, sym)
            per_kind[kind][sym] = inv
            totals["files"] += inv["files"]
            totals["rows"] += inv["rows"]
            if kind == "orderbook":
                all_missing.extend(inv["missing_days"])
                if inv["last_ts_ms"]:
                    age_h = (now.timestamp() * 1000 - inv["last_ts_ms"]) / 3_600_000
                    if age_h > STALE_HOURS:
                        stale_symbols.append(sym)

    ob_rows = sum(per_kind["orderbook"][s]["rows"] for s in config.symbols)
    low_volume = [
        s
        for s in config.symbols
        if per_kind["orderbook"][s]["rows"] < MIN_ORDERBOOK_ROWS_PER_SYMBOL
    ]

    span_days = max((per_kind["orderbook"][s]["span_days"] for s in config.symbols), default=0)

    checks = {
        "collector_data_present": ob_rows > 0,
        "no_gaps": len(set(all_missing)) == 0,
        "not_stale": len(stale_symbols) == 0,
        "min_volume": len(low_volume) == 0,
    }
    ok = all(checks.values())

    return {
        "symbols": list(config.symbols),
        "totals": totals,
        "per_kind": per_kind,
        "history_span_days": span_days,
        "missing_days_unique": sorted(set(all_missing)),
        "stale_symbols": stale_symbols,
        "low_volume_symbols": low_volume,
        "checks": checks,
        "healthy": ok,
    }


def run_daily(config: Config, out_dir: Path) -> dict[str, Any]:
    """Daily cycle — collectors, quality, gaps, volume."""
    out_dir.mkdir(parents=True, exist_ok=True)
    inventory = build_data_inventory(config)
    generated_at = _utc_now().isoformat()

    issues: list[str] = []
    if not inventory["checks"]["collector_data_present"]:
        issues.append("Нет данных orderbook — запустите сборщик (collect).")
    if inventory["missing_days_unique"]:
        issues.append(f"Пропуски дней в orderbook: {len(inventory['missing_days_unique'])}")
    if inventory["stale_symbols"]:
        issues.append(f"Устаревшие данные (> {STALE_HOURS}ч): {', '.join(inventory['stale_symbols'])}")
    if inventory["low_volume_symbols"]:
        issues.append(
            f"Мало строк orderbook (< {MIN_ORDERBOOK_ROWS_PER_SYMBOL}): "
            f"{', '.join(inventory['low_volume_symbols'])}"
        )

    report: dict[str, Any] = {
        "mode": "Continuous Research — Daily",
        "generated_at": generated_at,
        "healthy": inventory["healthy"],
        "issues": issues,
        "inventory": inventory,
        "recommendations": _daily_recommendations(inventory),
    }

    json_path = out_dir / "daily_report.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    md_path = out_dir / "daily_report.md"
    md_path.write_text(_format_daily_md(report), encoding="utf-8")
    report["paths"] = {"json": str(json_path), "markdown": str(md_path)}
    log.info("Daily report: healthy=%s issues=%d", inventory["healthy"], len(issues))
    return report


def _daily_recommendations(inventory: dict[str, Any]) -> list[str]:
    rec: list[str] = []
    if not inventory["checks"]["collector_data_present"] or inventory["stale_symbols"]:
        rec.append("Запустите сборщик и оставьте его работать 24/7 (вкладка «Действия» → Сбор данных).")
    if inventory["missing_days_unique"]:
        rec.append("Проверьте интернет и логи сборщика — восстановите непрерывный сбор.")
    if inventory["low_volume_symbols"]:
        rec.append("Дождитесь накопления минимум нескольких часов непрерывных данных.")
    if inventory["healthy"]:
        rec.append("Данные в порядке. Еженедельное исследование — по расписанию (раз в 7 дней).")
    return rec


def _format_daily_md(report: dict[str, Any]) -> str:
    inv = report["inventory"]
    lines = [
        "# Ежедневный отчёт — Continuous Research",
        "",
        f"**Дата:** {report['generated_at']}",
        f"**Статус:** {'✅ OK' if report['healthy'] else '⚠️ Требует внимания'}",
        "",
        "## Объём данных",
        "",
        f"- История (orderbook): **{inv['history_span_days']}** дней",
        f"- Всего файлов: **{inv['totals']['files']}**",
        f"- Всего строк: **{inv['totals']['rows']:,}**",
        "",
        "## Проверки",
        "",
    ]
    labels = {
        "collector_data_present": "Данные собираются",
        "no_gaps": "Нет пропусков дней",
        "not_stale": "Данные свежие (< 24ч)",
        "min_volume": "Достаточный объём",
    }
    for key, label in labels.items():
        ok = inv["checks"][key]
        lines.append(f"- {'✅' if ok else '❌'} {label}")

    if report["issues"]:
        lines += ["", "## Проблемы", ""]
        for i in report["issues"]:
            lines.append(f"- {i}")

    if report["recommendations"]:
        lines += ["", "## Что делать", ""]
        for r in report["recommendations"]:
            lines.append(f"- {r}")

    return "\n".join(lines)


def _study_metrics(study: dict[str, Any]) -> dict[str, Any]:
    expl = study.get("exploration") or {}
    vals = study.get("validations") or []
    boot_ps = [v.get("bootstrap_p") for v in vals if v.get("bootstrap_p") is not None]
    min_p = min(boot_ps) if boot_ps else None
    sig = min_p is not None and min_p < 0.05
    return {
        "events_total": study.get("events_total", 0),
        "expectancy_pct": expl.get("net_expectancy"),
        "profit_factor": expl.get("net_pf"),
        "bootstrap_p_min": min_p,
        "significant": sig,
        "accepted": study.get("accepted", False),
        "best_horizon_sec": expl.get("best_horizon_sec"),
    }


def _compare_studies(current: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any]:
    cur = _study_metrics(current)
    if not previous:
        return {
            "has_previous": False,
            "significance_improved": None,
            "events_increased": None,
            "expectancy_delta": None,
            "profit_factor_delta": None,
            "new_patterns": ["Первый еженедельный цикл для этой гипотезы"],
        }

    prev = _study_metrics(previous)
    sig_improved = None
    if cur["bootstrap_p_min"] is not None and prev["bootstrap_p_min"] is not None:
        sig_improved = cur["bootstrap_p_min"] < prev["bootstrap_p_min"]

    ev_delta = None
    if cur["expectancy_pct"] is not None and prev["expectancy_pct"] is not None:
        ev_delta = round(cur["expectancy_pct"] - prev["expectancy_pct"], 6)

    pf_delta = None
    if cur["profit_factor"] is not None and prev["profit_factor"] is not None:
        pf_delta = round(cur["profit_factor"] - prev["profit_factor"], 4)

    new_patterns: list[str] = []
    cur_reasons = set(current.get("rejection_reasons") or [])
    prev_reasons = set(previous.get("rejection_reasons") or [])
    added = cur_reasons - prev_reasons
    removed = prev_reasons - cur_reasons
    if added:
        new_patterns.append(f"Новые причины отказа: {list(added)[:3]}")
    if removed:
        new_patterns.append(f"Исчезли причины: {list(removed)[:3]}")
    if cur["accepted"] and not prev["accepted"]:
        new_patterns.append("Впервые прошла все критерии — см. alpha_candidate.md")
    if not new_patterns:
        new_patterns.append("Существенных новых закономерностей не обнаружено")

    return {
        "has_previous": True,
        "previous_at": previous.get("generated_at"),
        "significance_improved": sig_improved,
        "events_increased": cur["events_total"] > prev["events_total"],
        "events_delta": cur["events_total"] - prev["events_total"],
        "expectancy_delta": ev_delta,
        "profit_factor_delta": pf_delta,
        "current": cur,
        "previous": prev,
        "new_patterns": new_patterns,
    }


def _find_previous_study(results_dir: Path, hypothesis_id: str, before: datetime) -> dict[str, Any] | None:
    pattern = f"study_{hypothesis_id}_*.json"
    files = sorted(results_dir.glob(pattern), key=lambda p: _parse_study_ts(p) or datetime.min.replace(tzinfo=timezone.utc))
    candidate: dict[str, Any] | None = None
    for f in reversed(files):
        ts = _parse_study_ts(f)
        if ts and ts < before - timedelta(days=6):
            try:
                candidate = json.loads(f.read_text(encoding="utf-8"))
                candidate["_source_file"] = f.name
                return candidate
            except Exception:
                continue
    if len(files) >= 2:
        try:
            candidate = json.loads(files[-2].read_text(encoding="utf-8"))
            candidate["_source_file"] = files[-2].name
            return candidate
        except Exception:
            return None
    return None


def _count_weekly_cycles(results_dir: Path) -> int:
    return len(list(results_dir.glob("weekly_report_*.json")))


def _any_accepted_study(results_dir: Path) -> bool:
    for f in results_dir.glob("study_*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("accepted"):
                return True
        except Exception:
            continue
    return False


def run_weekly(config: Config, out_dir: Path) -> dict[str, Any]:
    """Weekly cycle — all hypotheses, week-over-week comparison."""
    out_dir.mkdir(parents=True, exist_ok=True)
    inventory = build_data_inventory(config)
    started = _utc_now()
    compare_before = started

    hypotheses_results: list[dict[str, Any]] = []
    alpha_candidates: list[str] = []

    for hid in list_hypotheses():
        log.info("Weekly study: %s", hid)
        previous = _find_previous_study(out_dir, hid, compare_before)
        study = run_hypothesis_study(hid, config, out_dir)
        comparison = _compare_studies(study, previous)

        if study.get("accepted"):
            alpha_candidates.append(hid)
            report_path = out_dir / "report_alpha_candidate.md"
            alpha_path = out_dir / "alpha_candidate.md"
            if report_path.exists():
                shutil.copy2(report_path, alpha_path)
            study["alpha_candidate_path"] = str(alpha_path)

        hypotheses_results.append(
            {
                "hypothesis_id": hid,
                "accepted": study.get("accepted", False),
                "study": study,
                "comparison": comparison,
            }
        )

    accepted_count = sum(1 for h in hypotheses_results if h["accepted"])
    ts = started.strftime("%Y%m%d_%H%M%S")
    report: dict[str, Any] = {
        "mode": "Continuous Research — Weekly",
        "generated_at": started.isoformat(),
        "finished_at": _utc_now().isoformat(),
        "hypotheses_tested": len(hypotheses_results),
        "accepted_count": accepted_count,
        "alpha_candidates": alpha_candidates,
        "data_span_days": inventory["history_span_days"],
        "inventory_summary": {
            "orderbook_rows": sum(inventory["per_kind"]["orderbook"][s]["rows"] for s in config.symbols),
            "history_span_days": inventory["history_span_days"],
        },
        "hypotheses": hypotheses_results,
    }

    json_path = out_dir / f"weekly_report_{ts}.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    latest_path = out_dir / "weekly_report_latest.json"
    latest_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    md_path = out_dir / f"weekly_report_{ts}.md"
    md_path.write_text(_format_weekly_md(report), encoding="utf-8")
    latest_md = out_dir / "weekly_report_latest.md"
    latest_md.write_text(md_path.read_text(encoding="utf-8"), encoding="utf-8")

    weeks_done = _count_weekly_cycles(out_dir)
    if (
        inventory["history_span_days"] >= FINAL_REPORT_MIN_SPAN_DAYS
        and weeks_done >= FINAL_REPORT_MIN_WEEKS
        and not _any_accepted_study(out_dir)
    ):
        conclusion = _write_final_conclusion(out_dir, report, weeks_done)
        report["final_conclusion_path"] = str(conclusion)

    report["paths"] = {
        "json": str(json_path),
        "markdown": str(md_path),
        "latest_json": str(latest_path),
    }
    log.info("Weekly complete: %d/%d accepted", accepted_count, len(hypotheses_results))
    return report


def _format_weekly_md(report: dict[str, Any]) -> str:
    lines = [
        "# Еженедельный отчёт — Continuous Research",
        "",
        f"**Период:** {report['generated_at']}",
        f"**Гипотез протестировано:** {report['hypotheses_tested']}",
        f"**Прошли критерии:** {report['accepted_count']}",
        f"**История данных:** {report['data_span_days']} дней",
        "",
    ]
    if report.get("alpha_candidates"):
        lines += [
            "## Alpha candidates",
            "",
            "Создан **alpha_candidate.md** для:",
            "",
        ]
        for h in report["alpha_candidates"]:
            lines.append(f"- `{h}`")
        lines += ["", "Стратегия в бота **не** добавляется автоматически.", ""]

    lines += ["## Сравнение с прошлой неделей", ""]
    for item in report["hypotheses"]:
        hid = item["hypothesis_id"]
        cmp_ = item["comparison"]
        lines.append(f"### {hid}")
        if not cmp_.get("has_previous"):
            lines.append("- Нет предыдущего цикла для сравнения")
        else:
            sig = cmp_.get("significance_improved")
            ev = cmp_.get("events_increased")
            lines.append(
                f"- Значимость улучшилась: {'да' if sig else 'нет' if sig is not None else '—'}"
            )
            lines.append(
                f"- Событий больше: {'да' if ev else 'нет' if ev is not None else '—'} "
                f"(Δ {cmp_.get('events_delta', '—')})"
            )
            lines.append(f"- Δ Expectancy: {cmp_.get('expectancy_delta', '—')}")
            lines.append(f"- Δ Profit Factor: {cmp_.get('profit_factor_delta', '—')}")
        for p in cmp_.get("new_patterns", []):
            lines.append(f"- {p}")
        lines.append("")

    return "\n".join(lines)


def _write_final_conclusion(out_dir: Path, weekly: dict[str, Any], weeks: int) -> Path:
    path = out_dir / "research_conclusion.md"
    lines = [
        "# Итоговый исследовательский отчёт",
        "",
        f"**Дата:** {_utc_now().isoformat()}",
        "",
        "## Вывод",
        "",
        f"За **{weeks}** еженедельных циклов и **{weekly['data_span_days']}** дней накопленных данных "
        "ни одна из 8 протестированных гипотез микроструктуры не прошла все критерии валидации "
        "(статистическая значимость, cross-symbol BTC+ETH+SOL, достаточное число событий, net EV после комиссий).",
        "",
        "## Протестированные гипотезы",
        "",
        "imbalance, sweep, liquidity_vanish, absorption, replenishment, "
        "cumulative_delta, spread_expand, book_flow_combo",
        "",
        "## Рекомендации",
        "",
        "1. Продолжить сбор данных без изменения параметров исследования.",
        "2. Не подгонять квантили, горизонты и критерии под исторические результаты.",
        "3. При появлении alpha_candidate.md — ручная проверка и paper trading.",
        "4. Новые гипотезы — только по отдельному исследовательскому решению.",
        "",
        "## Ограничения",
        "",
        "- Результаты не интегрируются в торгового бота автоматически.",
        "- Вывод относится к накопленному объёму на момент отчёта.",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path

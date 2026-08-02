"""Ingest study JSON from independent labs into Alpha Registry."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from alpha_registry.schema import (
    AlphaRecord,
    AlphaStatus,
    DataProvenance,
    MetricsSummary,
    ValidationSummary,
    make_registry_id,
)
from alpha_registry.store import RegistryStore

log = logging.getLogger("alpha_registry.ingest")

_REPO = Path(__file__).resolve().parent.parent

LAB_PATHS = {
    "microstructure_bot": _REPO / "microstructure_bot" / "results",
    "execution_intelligence_lab": _REPO / "execution_intelligence_lab" / "results",
    "bot_alpha": _REPO / "bot" / "alpha" / "results",
}


def _min_bootstrap(validations: list[dict]) -> float | None:
    ps = [v.get("bootstrap_p") for v in validations if v.get("bootstrap_p") is not None]
    return min(ps) if ps else None


def _all_oos(validations: list[dict]) -> bool:
    return bool(validations) and all(v.get("oos_pass") for v in validations)


def _all_wf(validations: list[dict]) -> bool:
    return bool(validations) and all(v.get("walk_forward_stable") for v in validations)


def _cross_symbol(validations: list[dict], accepted: bool) -> bool:
    return accepted and len([v for v in validations if v.get("accepted")]) >= 2


def record_from_msb_study(study: dict[str, Any], study_file: str) -> AlphaRecord:
    hyp = study.get("hypothesis") or {}
    hid = hyp.get("id") or "unknown"
    expl = study.get("exploration") or {}
    vals = study.get("validations") or []
    data_sum = study.get("data_summary") or {}
    accepted = bool(study.get("accepted"))

    best_h = expl.get("best_horizon_sec")
    h_stats = next((x for x in expl.get("horizons", []) if x.get("horizon_sec") == best_h), {})

    limitations = list(study.get("rejection_reasons") or []) if not accepted else [
        "Квантили на том же сэмпле — нужна out-of-time проверка",
        "Не интегрируется в Unified Trading Bot автоматически",
    ]

    return AlphaRecord(
        registry_id=make_registry_id("microstructure_bot", hid),
        source_lab="microstructure_bot",
        hypothesis_id=hid,
        title=hyp.get("question") or hid,
        description=hyp.get("description") or "",
        economic_rationale=hyp.get("economic") or "",
        data=DataProvenance(
            symbols=data_sum.get("symbols") or data_sum.get("symbols_with_data") or [],
            orderbook_rows=int(data_sum.get("orderbook_rows") or 0),
            trade_rows=int(data_sum.get("trade_rows") or 0),
            events_total=int(study.get("events_total") or 0),
            study_generated_at=study.get("generated_at"),
            study_file=study_file,
            fee_cost_pct=study.get("fee_cost_pct"),
        ),
        validation=ValidationSummary(
            oos_pass=_all_oos(vals),
            walk_forward_stable=_all_wf(vals),
            bootstrap_p_min=_min_bootstrap(vals),
            cross_symbol_pass=_cross_symbol(vals, accepted),
            per_symbol=vals,
            study_accepted=accepted,
        ),
        metrics=MetricsSummary(
            expectancy_pct=expl.get("net_expectancy"),
            profit_factor=expl.get("net_pf"),
            horizon_sec=best_h,
            mae_pct=h_stats.get("mae_pct"),
            mfe_pct=h_stats.get("mfe_pct"),
        ),
        limitations=limitations,
        overfitting_risk="Пороги — квантили на накопленном сэмпле; риск data-snooping при малом N",
        status=AlphaStatus.CANDIDATE.value if accepted else AlphaStatus.REJECTED.value,
    )


def record_from_eil_study(study: dict[str, Any], study_file: str) -> AlphaRecord:
    pat = study.get("pattern") or {}
    pid = pat.get("id") or "unknown"
    expl = study.get("exploration") or {}
    vals = study.get("validations") or []
    data_sum = study.get("data_summary") or {}
    accepted = bool(study.get("accepted"))

    best_h = expl.get("best_horizon_sec")
    h_stats = next((x for x in expl.get("horizons", []) if x.get("horizon_sec") == best_h), {})

    cross_sess = all(v.get("cross_session_pass") for v in vals) if vals else None
    cross_day = all(v.get("cross_day_pass") for v in vals) if vals else None

    limitations = list(study.get("rejection_reasons") or []) if not accepted else [
        "Execution lab result — требуется manual review перед bot",
        "IC и cross-session проверены только на текущем сэмпле",
    ]

    return AlphaRecord(
        registry_id=make_registry_id("execution_intelligence_lab", pid),
        source_lab="execution_intelligence_lab",
        hypothesis_id=pid,
        title=pat.get("question") or pid,
        description=pat.get("description") or "",
        economic_rationale=pat.get("economic") or "",
        data=DataProvenance(
            symbols=data_sum.get("symbols") or data_sum.get("symbols_with_data") or [],
            orderbook_rows=int(data_sum.get("orderbook_rows") or 0),
            trade_rows=int(data_sum.get("trade_rows") or 0),
            events_total=int(study.get("events_total") or 0),
            study_generated_at=study.get("generated_at"),
            study_file=study_file,
            fee_cost_pct=study.get("fee_cost_pct"),
        ),
        validation=ValidationSummary(
            oos_pass=_all_oos(vals),
            walk_forward_stable=_all_wf(vals),
            bootstrap_p_min=_min_bootstrap(vals),
            cross_symbol_pass=_cross_symbol(vals, accepted),
            cross_session_pass=cross_sess,
            cross_day_pass=cross_day,
            per_symbol=vals,
            study_accepted=accepted,
        ),
        metrics=MetricsSummary(
            expectancy_pct=expl.get("net_expectancy"),
            profit_factor=expl.get("net_pf"),
            horizon_sec=best_h,
            information_coefficient=h_stats.get("information_coefficient"),
            mae_pct=h_stats.get("mae_pct"),
            mfe_pct=h_stats.get("mfe_pct"),
        ),
        limitations=limitations,
        overfitting_risk="Статистические квантили на том же периоде; execution patterns чувствительны к режиму рынка",
        status=AlphaStatus.CANDIDATE.value if accepted else AlphaStatus.REJECTED.value,
    )


_STUDY_FILE_RE = re.compile(r"^study_(.+)_(\d{8})_(\d{6})$")


def _latest_studies(results_dir: Path) -> dict[str, Path]:
    """Latest study file per hypothesis/pattern id."""
    if not results_dir.exists():
        return {}
    out: dict[str, tuple[str, Path]] = {}
    for f in results_dir.glob("study_*.json"):
        m = _STUDY_FILE_RE.match(f.stem)
        if not m:
            continue
        hid, date_part, time_part = m.group(1), m.group(2), m.group(3)
        ts = f"{date_part}_{time_part}"
        prev = out.get(hid)
        if not prev or ts > prev[0]:
            out[hid] = (ts, f)
    return {k: v[1] for k, v in out.items()}


def ingest_lab(store: RegistryStore, lab: str) -> list[str]:
    results_dir = LAB_PATHS.get(lab)
    if not results_dir:
        raise ValueError(f"Unknown lab: {lab}")

    ingested: list[str] = []
    for hid, path in _latest_studies(results_dir).items():
        try:
            study = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning("Skip %s: %s", path, e)
            continue

        if lab == "microstructure_bot":
            record = record_from_msb_study(study, str(path.relative_to(_REPO)))
        elif lab == "execution_intelligence_lab":
            record = record_from_eil_study(study, str(path.relative_to(_REPO)))
        else:
            continue

        auto = AlphaStatus.CANDIDATE if record.validation.study_accepted else AlphaStatus.REJECTED
        store.register_or_update(
            record,
            ingest_note=f"Ingested latest study from {lab}",
            study_ref=path.name,
            auto_status=auto,
        )
        ingested.append(record.registry_id)
        log.info("Registered %s (%s)", record.registry_id, record.status)

    return ingested


def ingest_all(store: RegistryStore | None = None) -> dict[str, list[str]]:
    store = store or RegistryStore()
    result: dict[str, list[str]] = {}
    for lab in ("microstructure_bot", "execution_intelligence_lab"):
        result[lab] = ingest_lab(store, lab)
    store.maybe_generate_final_conclusion()
    return result

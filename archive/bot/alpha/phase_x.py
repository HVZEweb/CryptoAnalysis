"""Phase X — Alpha Discovery 2.0 unified research pipeline."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from alpha.config import AlphaConfig
from alpha.data.coverage import build_coverage_report, save_coverage_report
from alpha.data.quality import quality_summary, run_all_quality_checks
from alpha.discovery.engine import DiscoveryEngine, DiscoveryReport
from alpha.phase_x_report import export_phase_x_report
from alpha.run_archive import run_daily_archive

log = logging.getLogger("alpha.phase_x")


@dataclass
class PhaseXReport:
    generated_at: str
    elapsed_sec: float
    coverage: dict[str, Any]
    quality: dict[str, Any]
    archive: dict[str, Any] | None
    discovery: DiscoveryReport | None
    final_verdict: str
    html_path: str | None = None
    sections: dict[str, Any] = field(default_factory=dict)


def run_phase_x(
    *,
    update_data: bool = False,
    run_discovery: bool = True,
    skip_l2: bool = False,
    l2_duration: int = 120,
    config: AlphaConfig | None = None,
) -> PhaseXReport:
    t0 = time.perf_counter()
    config = config or AlphaConfig()

    log.info("Phase X — Step 1: Data Coverage Report")
    coverage = build_coverage_report()
    cov_path = save_coverage_report(coverage)
    log.info("Coverage saved: %s (discovery_ready=%s)", cov_path, coverage["summary"]["discovery_ready"])

    log.info("Phase X — Step 2: Data Quality Checks")
    quality = quality_summary(run_all_quality_checks())
    log.info("Quality: %d/%d passed", quality["passed"], quality["total"])

    archive_report = None
    if update_data:
        log.info("Phase X — Step 3: Daily Archive Update")
        archive_report = run_daily_archive(skip_l2=skip_l2, l2_duration=l2_duration)
        coverage = build_coverage_report()
        quality = quality_summary(run_all_quality_checks())

    discovery_report = None
    if run_discovery:
        if coverage["summary"]["discovery_ready"]:
            log.info("Phase X — Step 4: Discovery Engine (sufficient OHLCV)")
            discovery_report = DiscoveryEngine(config).run(coverage=coverage)
        else:
            log.warning("Discovery skipped — insufficient OHLCV coverage")

    final_verdict = _final_verdict(coverage, quality, discovery_report)
    sections = _build_sections(coverage, quality, discovery_report)

    elapsed = time.perf_counter() - t0
    report_dict = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_sec": round(elapsed, 1),
        "coverage": coverage,
        "quality": quality,
        "archive": archive_report,
        "discovery": _discovery_to_dict(discovery_report) if discovery_report else None,
        "final_verdict": final_verdict,
        "sections": sections,
    }

    html_path = str(export_phase_x_report(report_dict, Path(__file__).resolve().parent / "results"))
    json_path = Path(html_path).with_suffix(".json")
    json_path.write_text(json.dumps(report_dict, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    return PhaseXReport(
        generated_at=report_dict["generated_at"],
        elapsed_sec=elapsed,
        coverage=coverage,
        quality=quality,
        archive=archive_report,
        discovery=discovery_report,
        final_verdict=final_verdict,
        html_path=html_path,
        sections=sections,
    )


def _discovery_to_dict(dr: DiscoveryReport) -> dict[str, Any]:
    return {
        "generated_at": dr.generated_at,
        "elapsed_sec": dr.elapsed_sec,
        "accepted": dr.accepted,
        "validated_patterns": dr.validated_patterns,
        "feature_rankings": dr.feature_rankings,
        "conclusions": dr.conclusions,
        "html_path": dr.html_path,
    }


def _final_verdict(coverage: dict, quality: dict, discovery: DiscoveryReport | None) -> str:
    if discovery and discovery.accepted:
        return (
            f"Обнаружено {len(discovery.accepted)} воспроизводимых закономерностей "
            f"на {len(discovery.accepted)} инструментах. Требуется независимая проверка."
        )

    gaps = coverage.get("retry_after_accumulation", [])
    failed_q = quality.get("failed", 0)

    parts = [
        "В рамках имеющихся данных и проверенных гипотез воспроизводимое торговое преимущество не обнаружено.",
    ]
    if failed_q:
        parts.append(f"Проблемы качества данных: {failed_q} источников не прошли проверку.")
    if gaps:
        parts.append("Потенциально изменить вывод могут: " + "; ".join(gaps[:5]))
    parts.append(
        "Новые типы данных: длительная история funding/OI, поток ликвидаций, L2 orderbook, "
        "trades tape, cross-exchange basis."
    )
    return " ".join(parts)


def _build_sections(coverage: dict, quality: dict, discovery: DiscoveryReport | None) -> dict[str, Any]:
    features_tested: list[str] = []
    significant: list[str] = []
    rejected: list[dict] = []
    reject_reasons: list[str] = []

    if discovery:
        features_tested = [f"{f.get('name')}@{f.get('symbol')}" for f in discovery.feature_rankings[:30]]
        significant = discovery.conclusions.get("significant_features", [])
        rejected = [p for p in discovery.validated_patterns if p.get("status") == "rejected"]
        reject_reasons = discovery.conclusions.get("rejection_reasons", [])

    return {
        "data_quality": {
            "passed": quality.get("passed"),
            "failed": quality.get("failed"),
            "details": quality.get("results", [])[:20],
        },
        "features_investigated": features_tested,
        "statistically_significant_features": significant,
        "rejected_hypotheses": [r.get("description") for r in rejected[:20]],
        "rejection_reasons": reject_reasons,
        "missing_data": coverage.get("missing_sources", []),
        "retry_after_accumulation": coverage.get("retry_after_accumulation", []),
        "blocked_research": coverage.get("blocked_research", {}),
    }


def print_phase_x_summary(report: PhaseXReport) -> None:
    print("\n" + "=" * 60)
    print("PHASE X — ALPHA DISCOVERY 2.0")
    print("=" * 60)
    print(f"\n{report.final_verdict}\n")
    s = report.coverage.get("summary", {})
    print(f"Data: {s.get('present')}/{s.get('total_sources')} sources present, discovery_ready={s.get('discovery_ready')}")
    print(f"Quality: {report.quality.get('passed')}/{report.quality.get('total')} passed")
    if report.discovery:
        print(f"Accepted hypotheses: {len(report.discovery.accepted)}")
        for a in report.discovery.accepted[:3]:
            print(f"  ✓ {a}")
    if report.html_path:
        print(f"\nReport: {report.html_path}")
    print(f"Elapsed: {report.elapsed_sec:.1f}s")

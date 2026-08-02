"""
Alpha Registry — общий слой результатов исследований.

Исследование → доказательство → регистрация → ручное решение → интеграция.
Только status=validated рассматривается для переноса в Unified Trading Bot.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

REGISTRY_VERSION = 1
_ROOT = Path(__file__).resolve().parent
DEFAULT_REGISTRY_PATH = _ROOT / "data" / "registry.json"


class AlphaStatus(str, Enum):
    CANDIDATE = "candidate"
    VALIDATED = "validated"
    REJECTED = "rejected"
    RETIRED = "retired"


VALID_STATUS_TRANSITIONS: dict[AlphaStatus, set[AlphaStatus]] = {
    AlphaStatus.CANDIDATE: {AlphaStatus.VALIDATED, AlphaStatus.REJECTED, AlphaStatus.RETIRED},
    AlphaStatus.VALIDATED: {AlphaStatus.RETIRED},
    AlphaStatus.REJECTED: {AlphaStatus.CANDIDATE, AlphaStatus.RETIRED},
    AlphaStatus.RETIRED: set(),
}


@dataclass
class HistoryEntry:
    at: str
    action: str
    from_status: str | None
    to_status: str | None
    note: str
    actor: str = "system"
    study_ref: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DataProvenance:
    symbols: list[str] = field(default_factory=list)
    span_days: int = 0
    orderbook_rows: int = 0
    trade_rows: int = 0
    events_total: int = 0
    study_generated_at: str | None = None
    study_file: str | None = None
    fee_cost_pct: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ValidationSummary:
    oos_pass: bool = False
    walk_forward_stable: bool = False
    bootstrap_p_min: float | None = None
    cross_symbol_pass: bool = False
    cross_session_pass: bool | None = None
    cross_day_pass: bool | None = None
    per_symbol: list[dict[str, Any]] = field(default_factory=list)
    study_accepted: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MetricsSummary:
    expectancy_pct: float | None = None
    profit_factor: float | None = None
    horizon_sec: int | None = None
    information_coefficient: float | None = None
    mae_pct: float | None = None
    mfe_pct: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class AlphaRecord:
    """Уникальный идентификатор: {source_lab}:{hypothesis_id}"""

    registry_id: str
    source_lab: str
    hypothesis_id: str
    title: str
    description: str
    economic_rationale: str
    data: DataProvenance
    validation: ValidationSummary
    metrics: MetricsSummary
    limitations: list[str] = field(default_factory=list)
    overfitting_risk: str = ""
    status: str = AlphaStatus.REJECTED.value
    history: list[HistoryEntry] = field(default_factory=list)
    registered_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "registry_id": self.registry_id,
            "source_lab": self.source_lab,
            "hypothesis_id": self.hypothesis_id,
            "title": self.title,
            "description": self.description,
            "economic_rationale": self.economic_rationale,
            "data": self.data.to_dict(),
            "validation": self.validation.to_dict(),
            "metrics": self.metrics.to_dict(),
            "limitations": self.limitations,
            "overfitting_risk": self.overfitting_risk,
            "status": self.status,
            "history": [h.to_dict() for h in self.history],
            "registered_at": self.registered_at,
            "updated_at": self.updated_at,
            "bot_integration_eligible": self.status == AlphaStatus.VALIDATED.value,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> AlphaRecord:
        data = DataProvenance(**d.get("data", {}))
        validation_raw = d.get("validation", {})
        validation = ValidationSummary(
            oos_pass=bool(validation_raw.get("oos_pass")),
            walk_forward_stable=bool(validation_raw.get("walk_forward_stable")),
            bootstrap_p_min=validation_raw.get("bootstrap_p_min"),
            cross_symbol_pass=bool(validation_raw.get("cross_symbol_pass")),
            cross_session_pass=validation_raw.get("cross_session_pass"),
            cross_day_pass=validation_raw.get("cross_day_pass"),
            per_symbol=validation_raw.get("per_symbol") or [],
            study_accepted=bool(validation_raw.get("study_accepted")),
        )
        metrics_raw = d.get("metrics", {})
        metrics = MetricsSummary(**{k: metrics_raw.get(k) for k in MetricsSummary.__dataclass_fields__})
        history = [HistoryEntry(**h) for h in d.get("history", [])]
        return cls(
            registry_id=d["registry_id"],
            source_lab=d["source_lab"],
            hypothesis_id=d["hypothesis_id"],
            title=d.get("title", ""),
            description=d.get("description", ""),
            economic_rationale=d.get("economic_rationale", ""),
            data=data,
            validation=validation,
            metrics=metrics,
            limitations=d.get("limitations") or [],
            overfitting_risk=d.get("overfitting_risk", ""),
            status=d.get("status", AlphaStatus.REJECTED.value),
            history=history,
            registered_at=d.get("registered_at", ""),
            updated_at=d.get("updated_at", ""),
        )


def make_registry_id(source_lab: str, hypothesis_id: str) -> str:
    return f"{source_lab}:{hypothesis_id}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

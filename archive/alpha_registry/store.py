"""Persistent JSON store with append-only history."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from alpha_registry.documents import (
    FINAL_CONCLUSION_PATH,
    FINAL_MIN_DAYS,
    FINAL_MIN_RECORDS,
    generate_final_research_conclusion,
    generate_integration_proposal,
    observation_days_since,
    proposal_path,
)
from alpha_registry.schema import (
    DEFAULT_REGISTRY_PATH,
    REGISTRY_VERSION,
    AlphaRecord,
    AlphaStatus,
    HistoryEntry,
    VALID_STATUS_TRANSITIONS,
    utc_now,
)

log = logging.getLogger("alpha_registry.store")


class RegistryStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or DEFAULT_REGISTRY_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _load_raw(self) -> dict[str, Any]:
        if not self.path.exists():
            return {
                "version": REGISTRY_VERSION,
                "updated_at": utc_now(),
                "meta": {
                    "platform_complete": True,
                    "observation_started_at": None,
                    "final_conclusion_generated_at": None,
                },
                "entries": {},
            }
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            data.setdefault("meta", {})
            data["meta"].setdefault("platform_complete", True)
            return data
        except Exception as e:
            log.error("Registry read failed: %s", e)
            return {
                "version": REGISTRY_VERSION,
                "updated_at": utc_now(),
                "meta": {"platform_complete": True},
                "entries": {},
            }

    def _ensure_observation_started(self, raw: dict[str, Any]) -> None:
        meta = raw.setdefault("meta", {})
        if not meta.get("observation_started_at"):
            meta["observation_started_at"] = utc_now()

    def _save_raw(self, data: dict[str, Any]) -> None:
        data["version"] = REGISTRY_VERSION
        data["updated_at"] = utc_now()
        self._ensure_observation_started(data)
        payload = json.dumps(data, indent=2, ensure_ascii=False)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(self.path)

    def list_records(self) -> list[AlphaRecord]:
        raw = self._load_raw()
        entries = raw.get("entries") or {}
        return [AlphaRecord.from_dict(v) for v in entries.values()]

    def get(self, registry_id: str) -> AlphaRecord | None:
        raw = self._load_raw()
        entry = (raw.get("entries") or {}).get(registry_id)
        return AlphaRecord.from_dict(entry) if entry else None

    def upsert(self, record: AlphaRecord) -> AlphaRecord:
        raw = self._load_raw()
        entries: dict[str, Any] = raw.setdefault("entries", {})
        entries[record.registry_id] = record.to_dict()
        self._save_raw(raw)
        return record

    def register_or_update(
        self,
        record: AlphaRecord,
        *,
        ingest_note: str,
        study_ref: str | None = None,
        auto_status: AlphaStatus | None = None,
    ) -> AlphaRecord:
        existing = self.get(record.registry_id)
        now = utc_now()

        if existing is None:
            record.registered_at = now
            record.updated_at = now
            initial_status = auto_status or (
                AlphaStatus.CANDIDATE if record.validation.study_accepted else AlphaStatus.REJECTED
            )
            record.status = initial_status.value
            record.history.append(
                HistoryEntry(
                    at=now,
                    action="registered",
                    from_status=None,
                    to_status=record.status,
                    note=ingest_note,
                    actor="system",
                    study_ref=study_ref,
                )
            )
            return self.upsert(record)

        # Never auto-downgrade validated
        if existing.status == AlphaStatus.VALIDATED.value:
            record.status = AlphaStatus.VALIDATED.value
        elif existing.status == AlphaStatus.RETIRED.value:
            record.status = AlphaStatus.RETIRED.value
        elif auto_status:
            record.status = auto_status.value
        else:
            record.status = (
                AlphaStatus.CANDIDATE.value
                if record.validation.study_accepted
                else AlphaStatus.REJECTED.value
            )

        record.registered_at = existing.registered_at
        record.updated_at = now
        record.history = list(existing.history)
        record.history.append(
            HistoryEntry(
                at=now,
                action="study_ingested",
                from_status=existing.status,
                to_status=record.status,
                note=ingest_note,
                actor="system",
                study_ref=study_ref,
            )
        )
        return self.upsert(record)

    def set_status(
        self,
        registry_id: str,
        new_status: AlphaStatus,
        *,
        note: str,
        actor: str = "manual",
    ) -> AlphaRecord:
        record = self.get(registry_id)
        if not record:
            raise KeyError(f"Unknown registry_id: {registry_id}")

        current = AlphaStatus(record.status)
        allowed = VALID_STATUS_TRANSITIONS.get(current, set())
        if new_status != current and new_status not in allowed:
            raise ValueError(f"Transition {current.value} → {new_status.value} not allowed")

        now = utc_now()
        record.history.append(
            HistoryEntry(
                at=now,
                action="status_change",
                from_status=current.value,
                to_status=new_status.value,
                note=note,
                actor=actor,
            )
        )
        record.status = new_status.value
        record.updated_at = now
        saved = self.upsert(record)

        if new_status == AlphaStatus.VALIDATED and current != AlphaStatus.VALIDATED:
            prop = generate_integration_proposal(saved)
            saved.history.append(
                HistoryEntry(
                    at=utc_now(),
                    action="document_generated",
                    from_status=new_status.value,
                    to_status=new_status.value,
                    note=f"integration_proposal: {prop.name}",
                    actor="system",
                    study_ref=None,
                )
            )
            self.upsert(saved)
            log.info("Integration proposal: %s", prop)

        return saved

    def maybe_generate_final_conclusion(self) -> Path | None:
        raw = self._load_raw()
        meta = raw.get("meta") or {}
        if meta.get("final_conclusion_generated_at"):
            return FINAL_CONCLUSION_PATH if FINAL_CONCLUSION_PATH.exists() else None

        records = self.list_records()
        if len(records) < FINAL_MIN_RECORDS:
            return None

        validated = [r for r in records if r.status == AlphaStatus.VALIDATED.value]
        if validated:
            return None

        days = observation_days_since(meta.get("observation_started_at"))
        if days < FINAL_MIN_DAYS:
            return None

        path = generate_final_research_conclusion(records, observation_days=days)
        meta["final_conclusion_generated_at"] = utc_now()
        raw["meta"] = meta
        self._save_raw(raw)
        log.info("Final research conclusion: %s", path)
        return path

    def summary(self) -> dict[str, Any]:
        records = self.list_records()
        by_status: dict[str, int] = {}
        for r in records:
            by_status[r.status] = by_status.get(r.status, 0) + 1
        raw = self._load_raw()
        meta = raw.get("meta") or {}
        days = observation_days_since(meta.get("observation_started_at"))
        return {
            "total": len(records),
            "by_status": by_status,
            "validated_for_bot_review": [
                r.registry_id for r in records if r.status == AlphaStatus.VALIDATED.value
            ],
            "registry_path": str(self.path),
            "updated_at": raw.get("updated_at"),
            "meta": {
                "platform_complete": True,
                "observation_days": days,
                "observation_started_at": meta.get("observation_started_at"),
                "final_conclusion_generated_at": meta.get("final_conclusion_generated_at"),
            },
            "documents": {
                "final_conclusion": str(FINAL_CONCLUSION_PATH) if FINAL_CONCLUSION_PATH.exists() else None,
                "integration_proposals_dir": str(proposal_path("x").parent),
            },
        }

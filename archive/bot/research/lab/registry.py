"""Registered research hypotheses — independent modules, no changes to live strategies."""

from __future__ import annotations

import pandas as pd

from research.lab.base import Hypothesis, HypothesisMeta
from research.lab.hypotheses import ALL_HYPOTHESES

__all__ = ["ALL_HYPOTHESES", "Hypothesis", "HypothesisMeta", "get_hypothesis", "list_hypotheses"]


def list_hypotheses() -> list[HypothesisMeta]:
    return [h.meta for h in ALL_HYPOTHESES]


def get_hypothesis(hypothesis_id: str) -> Hypothesis | None:
    for h in ALL_HYPOTHESES:
        if h.meta.id == hypothesis_id:
            return h
    return None

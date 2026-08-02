"""Data mining research engine."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from alpha.config import AlphaConfig
from alpha.discovery.combinations import search_combinations
from alpha.discovery.features import build_feature_matrix, feature_columns
from alpha.discovery.metrics import rank_features, score_feature
from alpha.discovery.patterns import validate_pattern
from alpha.discovery.report import export_discovery_report
from exchange.okx_rest import to_swap_symbol
from research.oos import split_holdout

log = logging.getLogger("alpha.discovery.engine")

SYMBOLS = ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"]
TARGET = "fwd_ret_6"
TOP_FEATURES = 15
MAX_COMBOS_TO_VALIDATE = 20
MIN_CROSS_INSTRUMENTS = 2


@dataclass
class DiscoveryReport:
    generated_at: str
    elapsed_sec: float
    data_inventory: dict[str, Any]
    feature_rankings: list[dict] = field(default_factory=list)
    combinations: list[dict] = field(default_factory=list)
    validated_patterns: list[dict] = field(default_factory=list)
    accepted: list[str] = field(default_factory=list)
    conclusions: dict[str, Any] = field(default_factory=dict)
    html_path: str | None = None


class DiscoveryEngine:
    def __init__(self, config: AlphaConfig | None = None) -> None:
        self.config = config or AlphaConfig()

    def run(self, *, coverage: dict[str, Any] | None = None) -> DiscoveryReport:
        t0 = time.perf_counter()
        feature_rankings: list[dict] = []
        all_combos: list[dict] = []
        validated: list[dict] = []
        accepted: list[str] = []
        inventory: dict[str, Any] = {}

        for symbol in SYMBOLS:
            swap = to_swap_symbol(symbol)
            cross = [s for s in SYMBOLS if s != symbol]
            df, meta = build_feature_matrix(symbol, timeframe="5m", bars=self.config.total_bars, cross_symbols=cross)
            inventory[swap] = meta
            if df.empty:
                continue

            log.info("Mining %s (%d bars, sources: %s)", swap, len(df), meta.get("sources"))

            is_df, oos_df = split_holdout(df, self.config.oos_holdout_pct)

            feats = feature_columns(df)
            ranked = rank_features(is_df, feats, TARGET, symbol=swap)
            for s in ranked[:TOP_FEATURES]:
                feature_rankings.append(s.to_dict())

            combos = search_combinations(is_df, oos_df, ranked, TARGET, symbol=swap, top_k=TOP_FEATURES)
            for c in combos[:30]:
                all_combos.append(c.to_dict())

            promising = [c for c in combos if c.oos_mean_ret > 0 and c.oos_samples >= 15][:MAX_COMBOS_TO_VALIDATE]
            for cand in promising:
                log.info("Validate pattern: %s @ %s", cand.rule, swap)
                pr = validate_pattern(df, cand, symbol=swap, execution=self.config.execution)
                validated.append(pr.to_dict())

        validated, accepted = _apply_cross_instrument_gate(validated)

        cross_rankings = self._cross_asset_stability()
        feature_rankings.extend(cross_rankings)

        conclusions = _build_conclusions(feature_rankings, validated, accepted, inventory, coverage)
        elapsed = time.perf_counter() - t0

        report_dict = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "elapsed_sec": round(elapsed, 1),
            "data_inventory": inventory,
            "feature_rankings": feature_rankings[:50],
            "combinations": all_combos[:40],
            "validated_patterns": validated,
            "accepted": accepted,
            "conclusions": conclusions,
        }

        html_path = None
        if self.config.export_html:
            out = Path(__file__).resolve().parents[1] / "results"
            html_path = str(export_discovery_report(report_dict, out))

        return DiscoveryReport(
            generated_at=report_dict["generated_at"],
            elapsed_sec=elapsed,
            data_inventory=inventory,
            feature_rankings=feature_rankings[:50],
            combinations=all_combos[:40],
            validated_patterns=validated,
            accepted=accepted,
            conclusions=conclusions,
            html_path=html_path,
        )

    def _cross_asset_stability(self) -> list[dict]:
        """IC of same feature across BTC/ETH/SOL."""
        matrices: dict[str, pd.DataFrame] = {}
        for symbol in SYMBOLS:
            df, _ = build_feature_matrix(symbol, bars=0, cross_symbols=[s for s in SYMBOLS if s != symbol])
            if not df.empty:
                matrices[to_swap_symbol(symbol)] = df

        if len(matrices) < 2:
            return []

        common_feats = set(feature_columns(next(iter(matrices.values()))))
        for m in matrices.values():
            common_feats &= set(feature_columns(m))

        extra = []
        for feat in sorted(common_feats):
            ics = []
            for sym, m in matrices.items():
                s = score_feature(m, feat, TARGET, symbol=sym)
                if s:
                    ics.append(s.ic)
            if len(ics) >= 2:
                extra.append(
                    {
                        "name": feat,
                        "symbol": "cross_asset",
                        "target": TARGET,
                        "ic": round(float(sum(ics) / len(ics)), 4),
                        "cross_asset_ic_mean": round(float(sum(ics) / len(ics)), 4),
                        "rolling_ic_positive_pct": round(float(sum(1 for x in ics if x > 0) / len(ics) * 100), 2),
                        "score": round(abs(sum(ics) / len(ics)), 4),
                    }
                )
        return sorted(extra, key=lambda x: x["score"], reverse=True)[:15]


def _apply_cross_instrument_gate(validated: list[dict]) -> tuple[list[dict], list[str]]:
    """Hypothesis accepted only if reproduced on >= MIN_CROSS_INSTRUMENTS symbols."""
    by_rule: dict[str, list[int]] = {}
    for i, v in enumerate(validated):
        rule = (v.get("candidate") or {}).get("rule", v.get("description", ""))
        by_rule.setdefault(rule, []).append(i)

    accepted: list[str] = []
    for _rule, indices in by_rule.items():
        passed_idx = [i for i in indices if validated[i].get("status") == "symbol_pass"]
        if len(passed_idx) >= MIN_CROSS_INSTRUMENTS:
            for i in passed_idx:
                validated[i]["status"] = "accepted"
                validated[i]["strategy_ready"] = True
                validated[i]["verdict"] = (
                    validated[i].get("verdict", "") + f"; reproduced on {len(passed_idx)} instruments"
                ).strip("; ")
                accepted.append(validated[i].get("description", _rule))
        else:
            for i in passed_idx:
                validated[i]["status"] = "rejected"
                validated[i]["strategy_ready"] = False
                validated[i]["verdict"] = (
                    validated[i].get("verdict", "")
                    + f"; needs reproduction on {MIN_CROSS_INSTRUMENTS}+ instruments (got {len(passed_idx)})"
                ).strip("; ")
    return validated, accepted


def _build_conclusions(rankings, validated, accepted, inventory, coverage: dict | None = None) -> dict[str, Any]:
    top_feats = rankings[:5]
    promising_combos = [v for v in validated if v.get("out_of_sample", {}).get("expectancy_pct", -99) > -0.05]

    rejected = [v for v in validated if v.get("status") == "rejected"]
    significant_features = [
        f for f in rankings
        if abs(f.get("ic", 0)) > 0.02 and f.get("rolling_ic_positive_pct", 0) > 55 and f.get("ic_pvalue", 1) < 0.05
    ]

    data_gaps: list[str] = []
    if coverage:
        data_gaps = coverage.get("retry_after_accumulation", [])
        missing = coverage.get("missing_sources", [])
        if missing:
            data_gaps.insert(0, f"Missing datasets: {len(missing)} sources")
    else:
        data_gaps = [
            "Funding: limited history (OKX API cap ~100 rows per pull)",
            "OI: short coverage — daily archive required",
            "Liquidations: often empty via public API",
            "L2 orderbook: requires npm run trading:archive",
        ]

    if accepted:
        note = (
            f"Найдено {len(accepted)} закономерностей с полной валидацией "
            f"и воспроизведением на {MIN_CROSS_INSTRUMENTS}+ инструментах. Ручной review обязателен."
        )
    elif promising_combos:
        note = (
            f"Полного ACCEPTED нет. {len(promising_combos)} паттернов — слабый OOS; "
            f"{len(rejected)} отклонено. Нужно больше данных или cross-instrument reproduction."
        )
    else:
        note = (
            "Воспроизводимое статистическое преимущество не обнаружено на доступных данных и проверенных признаках. "
            "Рекомендуется накопление funding/OI/L2 архива и повтор discovery."
        )

    return {
        "summary": note,
        "top_features": [f"{t.get('name')} IC={t.get('ic')}" for t in top_feats],
        "significant_features": [f"{t.get('name')} ({t.get('symbol')})" for t in significant_features[:10]],
        "rejected_count": len(rejected),
        "rejection_reasons": _summarize_rejections(rejected),
        "data_gaps": data_gaps,
        "accepted_count": len(accepted),
        "validated_count": len(validated),
        "proceed_to_strategy": False,
    }


def _summarize_rejections(rejected: list[dict]) -> list[str]:
    counts: dict[str, int] = {}
    for r in rejected:
        verdict = r.get("verdict", "unknown")
        key = verdict.split(";")[0].strip()[:80]
        counts[key] = counts.get(key, 0) + 1
    return [f"{k} ({n})" for k, n in sorted(counts.items(), key=lambda x: -x[1])[:10]]


def run_discovery(config: AlphaConfig | None = None) -> DiscoveryReport:
    return DiscoveryEngine(config).run()


def print_discovery_summary(report: DiscoveryReport) -> None:
    print("\n" + "=" * 60)
    print("QUANT DISCOVERY — DATA MINING REPORT")
    print("=" * 60)
    print(f"\n{report.conclusions.get('summary', '')}\n")
    print("Top features:")
    for t in report.conclusions.get("top_features", [])[:5]:
        print(f"  • {t}")
    print(f"\nAccepted patterns: {len(report.accepted)}")
    for a in report.accepted[:3]:
        print(f"  ✓ {a}")
    if report.html_path:
        print(f"\nReport: {report.html_path}")
    print(f"Elapsed: {report.elapsed_sec:.1f}s")

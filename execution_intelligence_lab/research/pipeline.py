"""Execution pattern research pipeline — one pattern per cycle."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from collector.storage import ParquetStore
from config import Config
from execution_patterns.detection import detect_statistical_events
from execution_patterns.registry import PATTERNS, get_pattern, list_patterns
from features.engine import build_feature_frame
from reports.writer import write_execution_alpha_candidate, write_no_edge_report
from research.labeling import apply_net_returns, label_forward_returns, round_trip_cost_pct
from research.causal import EXPANDING_MIN_PERIODS, RESEARCH_METHODOLOGY_VERSION, expanding_quantile
from research.statistics import compute_horizon_stats, explore_event_horizons
from validation.gates import cross_symbol_gate, validate_events

log = logging.getLogger("eil.pipeline")


def _quantile_value(label: str) -> float | None:
    mapping = {"q99": 0.99, "q95": 0.95, "q90": 0.90, "q10": 0.10, "q05": 0.05, "q01": 0.01}
    return mapping.get(label)


def select_pattern_events(features: pd.DataFrame, pattern: dict[str, Any], config: Config) -> pd.DataFrame:
    """Detect events using distribution-derived quantiles only."""
    feature_col = pattern["feature"]
    if features.empty or feature_col not in features.columns:
        return pd.DataFrame()

    all_ev = detect_statistical_events(
        features,
        feature_col,
        pattern["id"],
        quantiles=config.quantile_tails,
        flag_condition=None,
    )
    if all_ev.empty:
        return all_ev

    q_label = pattern.get("quantile", "q99")
    if q_label != "flag":
        all_ev = all_ev[all_ev["quantile"] == q_label].reset_index(drop=True)

    flag_expr = pattern.get("flag")
    if flag_expr and not all_ev.empty:
        import re

        feat_work = features.copy()
        resolved = flag_expr
        for m in re.finditer(r"(\w+)\.quantile\(([\d.]+)\)", flag_expr):
            col, q = m.group(1), float(m.group(2))
            if col in feat_work.columns:
                thr_col = f"__thr_{col}_{int(q * 100)}"
                feat_work[thr_col] = expanding_quantile(
                    feat_work[col].astype(float), q, min_periods=EXPANDING_MIN_PERIODS
                ).shift(1)
                resolved = resolved.replace(m.group(0), thr_col)
        merged = feat_work.merge(all_ev[["ts"]], on="ts", how="inner")
        try:
            valid_ts = set(merged.loc[merged.eval(resolved).fillna(False), "ts"].tolist())
            all_ev = all_ev[all_ev["ts"].isin(valid_ts)].reset_index(drop=True)
        except Exception:
            pass

    return all_ev


def run_pattern_study(pattern_id: str, config: Config) -> dict[str, Any]:
    pattern = get_pattern(pattern_id)
    store = ParquetStore(config.data_dir)
    out_dir = config.results_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    fee_cost = round_trip_cost_pct(config)

    data_summary: dict[str, Any] = {
        "symbols": list(config.symbols),
        "symbols_with_data": [],
        "orderbook_rows": 0,
        "trade_rows": 0,
        "funding_rows": 0,
        "oi_rows": 0,
    }
    rejection_reasons: list[str] = []
    per_symbol_val = []
    per_symbol_expl: dict[str, dict] = {}
    total_events = 0

    for sym in config.symbols:
        ob = store.load("orderbook", sym)
        tr = store.load("trades", sym)
        data_summary["orderbook_rows"] += len(ob)
        data_summary["trade_rows"] += len(tr)
        data_summary["funding_rows"] += len(store.load("funding", sym))
        data_summary["oi_rows"] += len(store.load("open_interest", sym))

        if ob.empty:
            rejection_reasons.append(f"{sym}: нет orderbook")
            continue
        data_summary["symbols_with_data"].append(sym)

        feat = build_feature_frame(ob, tr)
        feat["inst_id"] = sym
        events = select_pattern_events(feat, pattern, config)
        total_events += len(events)

        if events.empty:
            rejection_reasons.append(f"{sym}: 0 событий для {pattern_id}")
            continue

        labeled = label_forward_returns(ob, events, horizons_sec=config.event_horizons_sec)
        labeled = apply_net_returns(labeled, config, config.event_horizons_sec)
        exploration = explore_event_horizons(
            labeled, config.event_horizons_sec, use_net=True, holdout_pct=config.oos_holdout_pct
        )

        best_h = exploration.get("best_horizon_sec") or config.event_horizons_sec[0]
        net_col = f"net_fwd_ret_{best_h}s"
        net_series = labeled[net_col] if net_col in labeled else labeled[f"fwd_ret_{best_h}s"] - fee_cost
        net_stats = compute_horizon_stats(
            net_series, best_h, signal=labeled.get("feature_value")
        )
        exploration["net_expectancy"] = net_stats.expectancy_pct
        wins = net_series[net_series > 0]
        losses = net_series[net_series <= 0]
        exploration["net_pf"] = (
            float(wins.sum() / abs(losses.sum())) if losses.sum() != 0 else (999.0 if wins.sum() > 0 else 0.0)
        )
        exploration["horizons"] = [
            h if h.get("horizon_sec") != best_h else {**h, **net_stats.to_dict()}
            for h in exploration.get("horizons", [])
        ]
        per_symbol_expl[sym] = exploration

        fv = validate_events(
            labeled,
            pattern_id=pattern_id,
            symbol=sym,
            horizon_sec=best_h,
            ret_col=net_col if net_col in labeled.columns else f"fwd_ret_{best_h}s",
            config=config,
            min_n=config.min_events_per_symbol,
        )
        if fv.train_ev <= 0 and fv.n_events >= config.min_events_per_symbol:
            fv.accepted = False
            fv.verdict = (fv.verdict + "; net EV ≤ 0 on train").strip("; ")
        per_symbol_val.append(fv)

    cross_ok, missing = cross_symbol_gate(per_symbol_val, config.required_symbols)
    if missing:
        rejection_reasons.append(f"Cross-symbol: нет валидации для {missing}")
    if not cross_ok:
        rejection_reasons.append("Закономерность не воспроизведена на BTC+ETH+SOL")

    for v in per_symbol_val:
        if not v.accepted:
            rejection_reasons.append(f"{v.symbol}: {v.verdict}")

    economic = pattern.get("economic", "")
    if len(economic) < 20:
        rejection_reasons.append("Нет экономического объяснения")

    accepted = cross_ok and all(v.accepted for v in per_symbol_val if v.symbol in config.required_symbols)
    ref_sym = data_summary["symbols_with_data"][0] if data_summary["symbols_with_data"] else config.symbols[0]
    ref_expl = per_symbol_expl.get(ref_sym, {"count": total_events, "horizons": []})

    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "research_methodology_version": RESEARCH_METHODOLOGY_VERSION,
        "lab": "Execution Intelligence Lab",
        "pattern": pattern,
        "events_total": total_events,
        "fee_cost_pct": fee_cost,
        "exploration": ref_expl,
        "validations": [v.to_dict() for v in per_symbol_val],
        "accepted": accepted,
        "rejection_reasons": rejection_reasons,
        "data_summary": data_summary,
    }

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    json_path = out_dir / f"study_{pattern_id}_{ts}.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    report["study_path"] = str(json_path)

    if accepted:
        md_path = write_execution_alpha_candidate(
            pattern, ref_expl, [v.to_dict() for v in per_symbol_val], out_dir=out_dir, fee_cost_pct=fee_cost
        )
        report["report_path"] = str(md_path)
        log.info("ACCEPTED → %s", md_path)
    else:
        md_path = write_no_edge_report(
            pattern,
            exploration=ref_expl,
            validations=[v.to_dict() for v in per_symbol_val],
            rejection_reasons=rejection_reasons,
            data_summary=data_summary,
            out_dir=out_dir,
        )
        report["report_path"] = str(md_path)
        log.info("REJECTED → %s", md_path)

    return report


def run_full_scan(config: Config) -> dict[str, Any]:
    """Scan all patterns — no parameter tuning."""
    results = []
    for pid in list_patterns():
        try:
            results.append({"pattern_id": pid, "result": run_pattern_study(pid, config)})
        except Exception as e:
            log.exception("Pattern %s failed: %s", pid, e)
            results.append({"pattern_id": pid, "error": str(e)})

    accepted = [r for r in results if r.get("result", {}).get("accepted")]
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patterns_tested": len(results),
        "accepted_count": len(accepted),
        "results": results,
    }
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = config.results_dir / f"full_scan_{ts}.json"
    config.results_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return summary

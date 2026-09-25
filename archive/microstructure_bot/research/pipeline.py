"""Phase 2 — Market Microstructure Research pipeline."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from collector.storage import ParquetStore
from config import Config
from research.anomaly import detect_quantile_events, prepare_features
from research.candidate import (
    write_alpha_candidate,
    write_no_edge_report,
    write_report_alpha_candidate,
    write_report_no_edge,
)
from research.causal import RESEARCH_METHODOLOGY_VERSION
from research.event_explorer import explore_all_event_types, explore_events
from research.hourly_stats import sync_hourly_statistics
from research.labeling import apply_net_returns, label_forward_returns, round_trip_cost_pct
from research.ranking import build_ranking_entry, rank_candidates
from research.reports import export_phase2_html
from research.statistics import compute_horizon_stats, event_study_table
from research.validation import cross_symbol_gate, validate_labeled_events

log = logging.getLogger("msb.pipeline")

# Phase 3 — one hypothesis per research cycle (no new modules)
HYPOTHESES: dict[str, dict[str, Any]] = {
    "imbalance": {
        "id": "imbalance",
        "question": "Что происходит после сильного imbalance стакана?",
        "description": "Экстремальный дисбаланс bid/ask depth (верхний 1% квантиль imb_10).",
        "event_types": ["extreme_imbalance_high", "extreme_imbalance_low"],
        "quantile": "q99",
        "economic": "Преобладание лимитной ликвидности с одной стороны создаёт краткосрочное давление; "
        "возможен импульс по направлению дисбаланса или mean-reversion после поглощения.",
    },
    "sweep": {
        "id": "sweep",
        "question": "Что происходит после серии sweep?",
        "description": "Серия агрессивных проходов уровней стакана (sweep_proxy flag).",
        "event_types": ["sweep_series"],
        "quantile": "flag",
        "economic": "Агрессивное исполнение через несколько уровней — информационный поток или каскад стопов.",
    },
    "liquidity_vanish": {
        "id": "liquidity_vanish",
        "question": "Что происходит после исчезновения крупной ликвидности?",
        "description": "Резкое падение глубины стакана (нижний 1% квантиль depth_chg_pct).",
        "event_types": ["depth_vanish"],
        "quantile": "q1",
        "economic": "Нехватка ликвидности — маркет-мейкеры сняли котировки; повышенная волатильность или импульс.",
    },
    "absorption": {
        "id": "absorption",
        "question": "Что происходит после absorption?",
        "description": "Сильный агрессивный поток без пропорционального движения цены.",
        "event_types": ["absorption_strong"],
        "quantile": "flag",
        "economic": "Поглощение крупным пассивным участником — возможен разворот или накопление позиции.",
    },
    "replenishment": {
        "id": "replenishment",
        "question": "Что происходит после восстановления ликвидности?",
        "description": "Быстрое восстановление глубины стакана после падения.",
        "event_types": ["replenishment_fast"],
        "quantile": "flag",
        "economic": "Восстановление стакана маркет-мейкером — стабилизация или подготовка к пробою.",
    },
    "cumulative_delta": {
        "id": "cumulative_delta",
        "question": "Что происходит после экстремального cumulative delta?",
        "description": "Экстремальный rolling delta объёма (верхний/нижний 1% квантиль).",
        "event_types": ["delta_surge", "delta_dump"],
        "quantile": "q99",
        "economic": "Дисбаланс агрессивных покупок/продаж — информированная торговля или краткосрочный импульс.",
    },
    "spread_expand": {
        "id": "spread_expand",
        "question": "Что происходит после резкого расширения spread?",
        "description": "Spread расширяется до верхнего 1% квантиля.",
        "event_types": ["spread_expand"],
        "quantile": "q99",
        "economic": "Маркет-мейкеры расширяют спред из-за риска — задержка реакции участников, возможен импульс.",
    },
    "book_flow_combo": {
        "id": "book_flow_combo",
        "question": "Что происходит после одновременного изменения стакана и потока сделок?",
        "description": "Absorption при экстремальном imbalance — комбинация стакана и tape.",
        "event_types": ["absorption_strong"],
        "quantile": "flag",
        "economic": "Согласованный сигнал стакана и потока — более сильный, чем каждый по отдельности.",
    },
}


def list_hypotheses() -> list[str]:
    return list(HYPOTHESES.keys())


def run_hypothesis_study(hypothesis_id: str, config: Config, out_dir: Path) -> dict[str, Any]:
    """Phase 3 — single hypothesis research cycle."""
    if hypothesis_id not in HYPOTHESES:
        raise ValueError(f"Unknown hypothesis: {hypothesis_id}. Available: {list_hypotheses()}")

    hyp = HYPOTHESES[hypothesis_id]
    store = ParquetStore(config.data_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    fee_cost = round_trip_cost_pct(config)

    data_summary: dict[str, Any] = {
        "symbols": list(config.symbols),
        "symbols_with_data": [],
        "orderbook_rows": 0,
        "trade_rows": 0,
    }

    per_symbol_expl: dict[str, dict] = {}
    per_symbol_val: list = []
    all_events_count = 0
    rejection_reasons: list[str] = []

    for sym in config.symbols:
        ob = store.load("orderbook", sym)
        trades = store.load("trades", sym)
        data_summary["orderbook_rows"] += len(ob)
        data_summary["trade_rows"] += len(trades)
        if ob.empty:
            rejection_reasons.append(f"{sym}: нет orderbook данных")
            continue
        data_summary["symbols_with_data"].append(sym)

        if "mid" not in ob.columns:
            ob["mid"] = (ob["best_bid"] + ob["best_ask"]) / 2
        feat = prepare_features(ob, trades)
        all_ev = detect_quantile_events(feat, quantiles=config.quantile_tails)
        q = hyp["quantile"]
        mask = all_ev["event"].isin(hyp["event_types"])
        if q != "flag":
            mask &= all_ev["quantile"] == q
        else:
            mask &= all_ev["quantile"] == "flag"
        ev_subset = all_ev[mask].reset_index(drop=True)
        all_events_count += len(ev_subset)

        if ev_subset.empty:
            rejection_reasons.append(f"{sym}: 0 событий типа {hyp['event_types']}")
            continue

        labeled = label_forward_returns(ob, ev_subset, horizons_sec=config.event_horizons_sec)
        labeled = apply_net_returns(labeled, config, config.event_horizons_sec)

        exploration = explore_events(ob, ev_subset, config, event_key=hypothesis_id)
        horizons = exploration.get("horizons", [])
        best_h = exploration.get("best_horizon_sec") or config.event_horizons_sec[0]

        net_col = f"net_fwd_ret_{best_h}s"
        gross_col = f"fwd_ret_{best_h}s"
        net_series = labeled[net_col] if net_col in labeled else labeled[gross_col] - fee_cost
        net_stats = compute_horizon_stats(net_series, best_h)
        exploration["net_expectancy"] = net_stats.expectancy_pct
        wins = net_series[net_series > 0]
        losses = net_series[net_series <= 0]
        exploration["net_pf"] = (
            wins.sum() / abs(losses.sum()) if losses.sum() != 0 else (999.0 if wins.sum() > 0 else 0.0)
        )
        exploration["horizons"] = horizons
        per_symbol_expl[sym] = exploration

        fv = validate_labeled_events(
            labeled,
            event_key=hypothesis_id,
            symbol=sym,
            horizon_sec=best_h,
            ret_col=net_col if net_col in labeled.columns else gross_col,
            holdout_pct=config.oos_holdout_pct,
            n_boot=config.bootstrap_samples,
            min_n=max(10, config.min_events_per_type // 2),
        )
        if fv.train_ev <= 0 and fv.n_events >= 10:
            fv.accepted = False
            fv.verdict = (fv.verdict + "; net EV after fees negative on train").strip("; ")
        per_symbol_val.append(fv)

    cross_ok, missing = cross_symbol_gate(per_symbol_val, config.required_symbols)
    if missing:
        rejection_reasons.append(f"Cross-symbol fail — нет данных/валидации: {missing}")
    if not cross_ok:
        rejection_reasons.append("Закономерность не воспроизведена на BTC+ETH+SOL")

    accepted_vals = [v for v in per_symbol_val if v.accepted]
    if len(accepted_vals) < len(config.required_symbols):
        for v in per_symbol_val:
            if not v.accepted:
                rejection_reasons.append(f"{v.symbol}: {v.verdict}")

    # Economic plausibility
    economic = hyp.get("economic", "")
    if not economic or len(economic) < 20:
        rejection_reasons.append("Подозрительно: нет экономического объяснения")

    accepted = cross_ok and len(accepted_vals) >= 2 and all(v.accepted for v in accepted_vals)

    ref_sym = data_summary["symbols_with_data"][0] if data_summary["symbols_with_data"] else config.symbols[0]
    ref_expl = per_symbol_expl.get(ref_sym, {"count": all_events_count, "horizons": [], "best_horizon_sec": 60})

    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "research_methodology_version": RESEARCH_METHODOLOGY_VERSION,
        "phase": "Phase 3 — Quantitative Market Research",
        "hypothesis": hyp,
        "events_total": all_events_count,
        "fee_cost_pct": fee_cost,
        "exploration": ref_expl,
        "validations": [v.to_dict() for v in per_symbol_val],
        "accepted": accepted,
        "rejection_reasons": rejection_reasons,
        "data_summary": data_summary,
    }

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    json_path = out_dir / f"study_{hypothesis_id}_{ts}.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    if accepted:
        path = write_report_alpha_candidate(
            hyp, ref_expl, [v.to_dict() for v in per_symbol_val],
            out_dir=out_dir, fee_cost_pct=fee_cost,
        )
        report["report_path"] = str(path)
        log.info("ALPHA: %s", path)
    else:
        path = write_report_no_edge(
            hyp,
            exploration=ref_expl,
            validations=[v.to_dict() for v in per_symbol_val],
            data_summary=data_summary,
            rejection_reasons=rejection_reasons,
            out_dir=out_dir,
        )
        report["report_path"] = str(path)
        log.info("NO EDGE: %s", path)

    return report


def _parse_event_key(event_key: str) -> tuple[str, str]:
    if event_key.endswith("_flag"):
        return event_key[:-5], "flag"
    for suffix in ("_q99", "_q95", "_q90", "_q10", "_q5", "_q1"):
        if event_key.endswith(suffix):
            return event_key[: -len(suffix)], suffix[1:]
    parts = event_key.rsplit("_", 1)
    return (parts[0], parts[1]) if len(parts) == 2 else (event_key, "flag")


def run_phase2_research(config: Config, out_dir: Path) -> dict[str, Any]:
    store = ParquetStore(config.data_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Stage 1 — hourly statistics
    stats_synced = 0
    data_summary: dict[str, Any] = {"symbols": list(config.symbols), "orderbook_rows": 0, "trade_rows": 0, "stats_rows": 0}
    for sym in config.symbols:
        stats_synced += sync_hourly_statistics(store, sym)
        data_summary["orderbook_rows"] += len(store.load("orderbook", sym))
        data_summary["trade_rows"] += len(store.load("trades", sym))
        data_summary["stats_rows"] += len(store.load("statistics", sym))
    log.info("Hourly stats synced: %d new rows", stats_synced)

    # Per-symbol events and explorations
    symbol_events: dict[str, pd.DataFrame] = {}
    symbol_prices: dict[str, pd.DataFrame] = {}
    explorations_by_symbol: dict[str, list[dict]] = {}

    for sym in config.symbols:
        ob = store.load("orderbook", sym)
        trades = store.load("trades", sym)
        if ob.empty:
            log.warning("%s: no orderbook data", sym)
            continue
        if "mid" not in ob.columns:
            ob["mid"] = (ob["best_bid"] + ob["best_ask"]) / 2
        feat = prepare_features(ob, trades)
        events = detect_quantile_events(feat, quantiles=config.quantile_tails)
        symbol_events[sym] = events
        symbol_prices[sym] = ob
        explorations_by_symbol[sym] = explore_all_event_types(ob, events, config)
        log.info("%s: %d anomalous events detected", sym, len(events))

    # Collect all event keys
    all_keys: set[str] = set()
    for expl_list in explorations_by_symbol.values():
        for e in expl_list:
            all_keys.add(e["event_key"])

    # Stage 2-4 — validate each event_key across symbols
    ranking_pool: list[dict] = []
    validations_by_key: dict[str, list] = {}

    for event_key in sorted(all_keys):
        per_symbol_val: list = []
        per_symbol_expl: dict[str, dict] = {}

        for sym in config.symbols:
            events = symbol_events.get(sym, pd.DataFrame())
            prices = symbol_prices.get(sym, pd.DataFrame())
            if events.empty or prices.empty:
                continue
            ev_name, quantile = _parse_event_key(event_key)
            mask = (events["event"] == ev_name) & (events["quantile"] == quantile)
            ev_subset = events[mask].reset_index(drop=True)
            if ev_subset.empty:
                continue

            exploration = explore_events(prices, ev_subset, config, event_key=event_key)
            per_symbol_expl[sym] = exploration

            best_h = exploration.get("best_horizon_sec") or config.event_horizons_sec[0]
            ret_col = f"fwd_ret_{best_h}s"
            labeled = label_forward_returns(prices, ev_subset, horizons_sec=config.event_horizons_sec)
            fv = validate_labeled_events(
                labeled,
                event_key=event_key,
                symbol=sym,
                horizon_sec=best_h,
                ret_col=ret_col,
                holdout_pct=config.oos_holdout_pct,
                n_boot=config.bootstrap_samples,
                min_n=config.min_events_per_type,
            )
            per_symbol_val.append(fv)

        if not per_symbol_val:
            continue

        validations_by_key[event_key] = [v.to_dict() for v in per_symbol_val]
        cross_ok, missing = cross_symbol_gate(per_symbol_val, config.required_symbols)
        symbols_passed = [v.symbol for v in per_symbol_val if v.accepted]

        ref_sym = config.symbols[0]
        ref_expl = per_symbol_expl.get(ref_sym, {})
        ref_val = next((v for v in per_symbol_val if v.symbol == ref_sym), per_symbol_val[0])
        best_h = ref_expl.get("best_horizon_sec") or ref_val.horizon_sec

        entry = build_ranking_entry(
            event_key,
            best_h,
            ref_expl,
            ref_val.to_dict(),
            cross_symbol_pass=cross_ok,
            symbols_passed=symbols_passed,
        )
        entry["cross_missing"] = missing
        entry["validations"] = [v.to_dict() for v in per_symbol_val]
        if not cross_ok:
            entry["accepted"] = False
            entry["verdict"] = (entry.get("verdict", "") + f"; missing symbols: {missing}").strip("; ")
        ranking_pool.append(entry)

    ranking = rank_candidates(ranking_pool)
    accepted = [r for r in ranking if r.get("accepted")]

    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "research_methodology_version": RESEARCH_METHODOLOGY_VERSION,
        "phase": "Phase 2 — Market Microstructure Research",
        "data_summary": data_summary,
        "stats_synced": stats_synced,
        "event_keys_tested": len(all_keys),
        "ranking": ranking,
        "accepted_count": len(accepted),
        "accepted": accepted,
    }

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    json_path = out_dir / f"phase2_research_{ts}.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    export_phase2_html(report, json_path)

    if accepted:
        top = accepted[0]
        ref_expl = {}
        for sym, expl_list in explorations_by_symbol.items():
            for e in expl_list:
                if e["event_key"] == top["event_key"]:
                    ref_expl = e
                    break
        cand_path = write_alpha_candidate(
            top,
            ref_expl,
            top.get("validations", []),
            out_dir,
        )
        report["alpha_candidate_path"] = str(cand_path)
        log.info("ALPHA CANDIDATE: %s", cand_path)
    else:
        no_edge_path = write_no_edge_report(ranking, data_summary=data_summary, out_dir=out_dir)
        report["no_edge_report_path"] = str(no_edge_path)
        log.info("No edge report: %s", no_edge_path)

    return report

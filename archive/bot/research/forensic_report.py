"""Forensic quant research HTML report."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _heat_color(value: float, vmin: float = -0.5, vmax: float = 0.5) -> str:
    if value >= 0.1:
        return "#065f46"
    if value >= 0:
        return "#14532d"
    if value >= -0.1:
        return "#7f1d1d"
    return "#450a0a"


def _heatmap_html(heatmap: dict[str, dict[str, float]], title: str) -> str:
    if not heatmap:
        return ""
    rows = ""
    for factor, buckets in heatmap.items():
        cells = "".join(
            f'<td style="background:{_heat_color(v)}">{k}<br><strong>{v:.3f}%</strong></td>'
            for k, v in sorted(buckets.items(), key=lambda x: x[1])
        )
        rows += f"<tr><th>{factor}</th>{cells}</tr>"
    return f"<h3>{title}</h3><table class='heatmap'><tr><th>Factor</th><th colspan='99'>Buckets (avg net EV %)</th></tr>{rows}</table>"


def _ablation_table(abl: dict) -> str:
    baseline = abl.get("baseline", {}).get("metrics", {})
    rows = (
        f"<tr class='baseline'><td>baseline</td><td>{baseline.get('trades')}</td>"
        f"<td>{baseline.get('expectancy_pct')}</td><td>{baseline.get('profit_factor')}</td>"
        f"<td>{baseline.get('sharpe_ratio')}</td><td>{baseline.get('max_drawdown_pct')}</td>"
        f"<td>—</td><td>—</td></tr>"
    )
    for r in sorted(abl.get("rows", []), key=lambda x: x.get("impact_score", 0), reverse=True):
        m = r.get("metrics", {})
        verdict = r.get("verdict", "")
        cls = "helps" if verdict == "helps" else "hurts" if verdict == "hurts" else ""
        rows += (
            f"<tr class='{cls}'><td>-{r.get('component')}</td><td>{m.get('trades')}</td>"
            f"<td>{m.get('expectancy_pct')}</td><td>{m.get('profit_factor')}</td>"
            f"<td>{m.get('sharpe_ratio')}</td><td>{m.get('max_drawdown_pct')}</td>"
            f"<td>{r.get('delta_expectancy')}</td><td>{r.get('impact_score')}</td></tr>"
        )
    helps = ", ".join(abl.get("helps", [])) or "—"
    hurts = ", ".join(abl.get("hurts", [])) or "—"
    return (
        f"<p><strong>Помогают:</strong> {helps} · <strong>Ухудшают:</strong> {hurts}</p>"
        f"<table><tr><th>Component</th><th>Trades</th><th>EV%</th><th>PF</th><th>Sharpe</th>"
        f"<th>MaxDD%</th><th>ΔEV</th><th>Impact</th></tr>{rows}</table>"
    )


def _hypothesis_table(hypotheses: list[dict]) -> str:
    if not hypotheses:
        return "<p>Нет данных</p>"
    rows = ""
    for h in sorted(hypotheses, key=lambda x: x.get("out_of_sample", {}).get("expectancy_pct", -99), reverse=True):
        oos = h.get("out_of_sample", {})
        full = h.get("full_sample", {})
        viable = "✓" if h.get("viable") else "✗"
        rows += (
            f"<tr><td>{h.get('hypothesis_id')}</td><td>{h.get('symbol')}</td>"
            f"<td>{full.get('trades')}</td><td>{oos.get('profit_factor')}</td>"
            f"<td>{oos.get('expectancy_pct')}</td><td>{oos.get('sharpe_ratio')}</td>"
            f"<td>{oos.get('sortino_ratio')}</td><td>{oos.get('calmar_ratio')}</td>"
            f"<td>{oos.get('max_drawdown_pct')}</td><td>{full.get('recovery_factor')}</td>"
            f"<td>{oos.get('win_rate')}</td><td>{h.get('stability_score')}</td>"
            f"<td>{h.get('overfitting_score')}</td><td>{viable}</td><td>{h.get('verdict')}</td></tr>"
        )
    return (
        "<table><tr><th>Hypothesis</th><th>Symbol</th><th>Trades</th><th>PF</th><th>EV%</th>"
        "<th>Sharpe</th><th>Sortino</th><th>Calmar</th><th>MaxDD%</th><th>Recovery</th>"
        "<th>Win%</th><th>Stability</th><th>Overfit</th><th>Viable</th><th>Verdict</th></tr>"
        f"{rows}</table>"
    )


def render_forensic_html(report: dict[str, Any]) -> str:
    conclusions = report.get("conclusions", {})
    sections = ""

    sections += "<section><h2>Этап 1 — Ablation Analysis</h2>"
    for key, abl in report.get("ablation", {}).items():
        sections += f"<h3>{key}</h3>{_ablation_table(abl)}"
    sections += "</section>"

    sections += "<section><h2>Этап 2 — Trade Diagnostics</h2>"
    for key, diag in report.get("diagnostics", {}).items():
        groups = diag.get("groups", [])
        g_rows = "".join(
            f"<tr><td>{g['name']}</td><td>{g['count']}</td>"
            f"<td>{g['metrics'].get('expectancy_pct')}</td><td>{g['metrics'].get('profit_factor')}</td>"
            f"<td>{g['avg_rsi']}</td><td>{g['avg_hold_bars']}</td></tr>"
            for g in groups
        )
        sections += f"<h3>{key} ({diag.get('total_trades')} trades)</h3>"
        if diag.get("loss_drivers"):
            sections += "<ul>" + "".join(f"<li>{d}</li>" for d in diag["loss_drivers"]) + "</ul>"
        sections += f"<table><tr><th>Group</th><th>Count</th><th>EV%</th><th>PF</th><th>Avg RSI</th><th>Hold bars</th></tr>{g_rows}</table>"
        sections += _heatmap_html(diag.get("heatmap", {}), "Factor Heatmap")
    sections += "</section>"

    sections += "<section><h2>Этап 3 — Market Regimes</h2>"
    for key, reg in report.get("regimes", {}).items():
        slices = reg.get("slices", [])
        r_rows = "".join(
            f"<tr><td>{s['dimension']}</td><td>{s['label']}</td><td>{s['metrics'].get('trades')}</td>"
            f"<td>{s['metrics'].get('win_rate')}</td><td>{s['metrics'].get('profit_factor')}</td>"
            f"<td>{s['metrics'].get('expectancy_pct')}</td><td>{s['metrics'].get('max_drawdown_pct')}</td>"
            f"<td>{s['avg_hold_min']}</td></tr>"
            for s in slices
            if s["metrics"].get("trades", 0) > 0
        )
        losing = ", ".join(reg.get("losing_regimes", [])) or "—"
        sections += f"<h3>{key}</h3><p>Losing regimes: {losing}</p>"
        sections += (
            "<table><tr><th>Dimension</th><th>Regime</th><th>Trades</th><th>Win%</th>"
            "<th>PF</th><th>EV%</th><th>MaxDD%</th><th>Avg hold min</th></tr>"
            f"{r_rows}</table>"
        )
    sections += "</section>"

    sections += "<section><h2>Этап 4 — Cost Analysis</h2>"
    sections += f"<p>{report.get('costs', {}).get('summary', '')}</p><table>"
    sections += "<tr><th>Strategy</th><th>Trades</th><th>No costs</th><th>Fees only</th><th>Fees+Slip</th><th>Full sim</th><th>Logic edge</th><th>Friction</th></tr>"
    for b in report.get("costs", {}).get("breakdowns", []):
        sections += (
            f"<tr><td>{b['strategy']}@{b['symbol']}</td><td>{b['trades']}</td>"
            f"<td>{b.get('avg_pnl_no_costs_pct')}</td><td>{b.get('avg_pnl_fees_only_pct')}</td>"
            f"<td>{b.get('avg_pnl_fees_slip_pct')}</td><td>{b.get('avg_pnl_full_pct')}</td>"
            f"<td>{b.get('logic_edge_pct')}</td><td>{b.get('friction_drag_pct')}</td></tr>"
        )
    sections += "</table></section>"

    sections += f"<section><h2>Этап 5 — Research Lab Hypotheses</h2>{_hypothesis_table(report.get('hypotheses', []))}</section>"

    sections += "<section><h2>Этап 6 — Conclusions</h2><div class='verdict'>"
    sections += f"<p><strong>ML:</strong> {'Proceed' if conclusions.get('proceed_to_ml') else 'Do NOT proceed'}</p>"
    sections += f"<p>{conclusions.get('ml_note', '')}</p>"
    sections += "<h3>Viable strategies</h3><ul>" + "".join(
        f"<li>{s}</li>" for s in conclusions.get("viable_strategies", [])
    ) + "</ul>"
    sections += "<h3>Remove / fix</h3><ul class='warnings'>" + "".join(
        f"<li>{s}</li>" for s in conclusions.get("remove_strategies", [])
    ) + "</ul>"
    sections += "<h3>Promising hypotheses</h3><ul class='strengths'>" + "".join(
        f"<li>{h}</li>" for h in conclusions.get("promising_hypotheses", [])
    ) + "</ul>"
    sections += "<h3>Forensic findings</h3><ul>" + "".join(
        f"<li>{f}</li>" for f in conclusions.get("forensic_findings", [])
    ) + "</ul></div></section>"

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Forensic Quant Research Report</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; background: #0f1117; color: #e8e8e8; max-width: 1400px; }}
    h1, h2 {{ color: #a78bfa; }}
    table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 13px; }}
    td, th {{ border: 1px solid #333; padding: 6px 8px; text-align: left; }}
    tr:nth-child(even) {{ background: #1a1d27; }}
    tr.baseline {{ background: #1e3a5f; }}
    tr.helps td {{ color: #86efac; }}
    tr.hurts td {{ color: #fca5a5; }}
    .verdict {{ background: #1e1b4b; padding: 1rem; border-radius: 12px; }}
    .warnings {{ color: #fca5a5; }}
    .strengths {{ color: #86efac; }}
    .heatmap td {{ min-width: 90px; text-align: center; }}
    section {{ margin-bottom: 2.5rem; }}
  </style>
</head>
<body>
  <h1>Forensic Quant Research Report</h1>
  <p>Generated: {report.get('generated_at', '')} · Elapsed: {report.get('elapsed_sec')}s</p>
  <p>Symbols: {', '.join(report.get('config', {}).get('symbols', []))} · {report.get('config', {}).get('timeframe')}</p>
  {sections}
  <footer><p>Quant Research Lab — statistical validation before ML.</p></footer>
</body>
</html>"""


def export_forensic_report(report: dict[str, Any], results_dir: str | Path) -> Path:
    out_dir = Path(results_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    html_path = out_dir / f"forensic_report_{ts}.html"
    json_path = out_dir / f"forensic_report_{ts}.json"
    html_path.write_text(render_forensic_html(report), encoding="utf-8")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return html_path

"""HTML research report export."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _metric_row(label: str, value: Any) -> str:
    return f"<tr><td>{label}</td><td><strong>{value}</strong></td></tr>"


def _metrics_table(metrics: dict[str, Any] | None, title: str) -> str:
    if not metrics:
        return f"<h3>{title}</h3><p>Нет данных</p>"
    rows = "".join(
        _metric_row(k, v)
        for k, v in metrics.items()
        if k not in ("equity_curve", "has_edge")
    )
    edge = metrics.get("has_edge", False)
    badge = '<span class="badge ok">EDGE</span>' if edge else '<span class="badge bad">NO EDGE</span>'
    return f"<h3>{title} {badge}</h3><table>{rows}</table>"


def _verdict_block(verdicts: list[dict]) -> str:
    parts = []
    for v in verdicts:
        cls = "ok" if v.get("viable") else "bad"
        warns = "".join(f"<li>{w}</li>" for w in v.get("warnings", []))
        strengths = "".join(f"<li>{s}</li>" for s in v.get("strengths", []))
        parts.append(
            f"""
            <div class="card {cls}">
              <h4>{v.get('strategy')} · {v.get('symbol')} — {v.get('confidence')}</h4>
              <p>{v.get('summary')}</p>
              <ul class="strengths">{strengths}</ul>
              <ul class="warnings">{warns}</ul>
            </div>
            """
        )
    return "".join(parts)


def render_html_report(report: dict[str, Any]) -> str:
    rec = report.get("recommendations", {})
    comparison = report.get("comparison", {})
    config = report.get("config", {})

    strategy_sections = ""
    for key, data in comparison.items():
        strategy_sections += f"<section><h2>{key}</h2>"
        strategy_sections += _metrics_table(data.get("oos"), "Out-of-Sample")
        strategy_sections += _metrics_table(data.get("walk_forward"), "Walk-Forward OOS")
        strategy_sections += _metrics_table(data.get("rolling"), "Rolling Windows")
        regime = data.get("regime", {})
        if regime.get("by_regime"):
            strategy_sections += "<h3>По рыночным режимам</h3><table>"
            for rname, rm in regime["by_regime"].items():
                strategy_sections += (
                    f"<tr><td>{rname}</td><td>trades={rm.get('trades')}</td>"
                    f"<td>EV={rm.get('expectancy_pct')}</td><td>PF={rm.get('profit_factor')}</td></tr>"
                )
            strategy_sections += "</table>"
        strategy_sections += "</section>"

    actions = "".join(f"<li>{a}</li>" for a in rec.get("actions", []))
    avoid = "".join(f"<li>{a}</li>" for a in rec.get("avoid", []))

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Trading Research Report</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; background: #0f1117; color: #e8e8e8; }}
    h1, h2 {{ color: #a78bfa; }}
    table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; }}
    td, th {{ border: 1px solid #333; padding: 8px; text-align: left; }}
    tr:nth-child(even) {{ background: #1a1d27; }}
    .badge {{ padding: 2px 8px; border-radius: 6px; font-size: 12px; }}
    .badge.ok {{ background: #065f46; }}
    .badge.bad {{ background: #7f1d1d; }}
    .card {{ border: 1px solid #333; border-radius: 12px; padding: 1rem; margin: 1rem 0; }}
    .card.ok {{ border-color: #10b981; }}
    .card.bad {{ border-color: #ef4444; }}
    .warnings {{ color: #fca5a5; }}
    .strengths {{ color: #86efac; }}
    .verdict {{ font-size: 1.1rem; padding: 1rem; background: #1e1b4b; border-radius: 12px; }}
    @media print {{ body {{ background: white; color: black; }} }}
  </style>
</head>
<body>
  <h1>Research Validation Report</h1>
  <p>Generated: {report.get('generated_at', '')} UTC</p>
  <p>Symbols: {', '.join(config.get('symbols', []))} · Timeframe: {config.get('timeframe')}</p>
  <p>Execution: fees {config.get('execution', {}).get('taker_fee_pct')}% · slippage {config.get('execution', {}).get('slippage_pct')}% · latency {config.get('execution', {}).get('latency_bars')} bars</p>

  <div class="verdict">
    <h2>Вердикт</h2>
    <p>{rec.get('overall_verdict', '')}</p>
    <p>ML: {'✓' if rec.get('proceed_to_ml') else '✗'} · Regime: {'✓' if rec.get('proceed_to_regime') else '✗'} · Optimization: {'✓' if rec.get('proceed_to_optimization') else '✗'}</p>
  </div>

  <h2>Рекомендации</h2>
  <ul>{actions}</ul>
  <h3>Не делать сейчас</h3>
  <ul class="warnings">{avoid}</ul>

  <h2>Стратегии</h2>
  {_verdict_block(rec.get('strategies', []))}

  {strategy_sections}

  <h2>Stability Ranking (Quant)</h2>
  <pre>{json.dumps(report.get('stability_ranking', {}), indent=2, ensure_ascii=False)[:4000]}</pre>

  <footer><p>Research Framework — validation before ML. Print this page to PDF (Ctrl+P).</p></footer>
</body>
</html>"""


def export_report(report: dict[str, Any], results_dir: str | Path) -> Path:
    out_dir = Path(results_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    html_path = out_dir / f"research_report_{ts}.html"
    json_path = out_dir / f"research_report_{ts}.json"

    html_path.write_text(render_html_report(report), encoding="utf-8")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return html_path

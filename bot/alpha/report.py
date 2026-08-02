"""Alpha Research Platform HTML report."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _status_color(status: str) -> str:
    if status == "accepted":
        return "#065f46"
    if status.startswith("skipped"):
        return "#374151"
    return "#7f1d1d"


def render_alpha_html(report: dict[str, Any]) -> str:
    conclusions = report.get("conclusions", {})
    rows = ""
    for r in sorted(report.get("results", []), key=lambda x: (x.get("status") != "accepted", -(x.get("out_of_sample") or {}).get("expectancy_pct", -99))):
        oos = r.get("out_of_sample") or {}
        sig = r.get("significance") or {}
        rows += (
            f"<tr><td>{r.get('module_id')}</td><td>{r.get('category')}</td><td>{r.get('symbol')}</td>"
            f"<td style='background:{_status_color(r.get('status',''))}'>{r.get('status')}</td>"
            f"<td>{oos.get('trades')}</td><td>{oos.get('expectancy_pct')}</td><td>{oos.get('profit_factor')}</td>"
            f"<td>{oos.get('sharpe_ratio')}</td><td>{r.get('stability_score')}</td><td>{r.get('overfitting_score')}</td>"
            f"<td>{sig.get('p_value')}</td><td>{r.get('verdict')}</td></tr>"
        )

    by_category: dict[str, list] = {}
    for r in report.get("results", []):
        by_category.setdefault(r.get("category", "?"), []).append(r)

    cat_sections = ""
    for cat, items in sorted(by_category.items()):
        accepted = sum(1 for i in items if i.get("status") == "accepted")
        cat_sections += f"<h3>{cat} ({accepted}/{len(items)} accepted)</h3><ul>"
        for i in items:
            mark = "✓" if i.get("status") == "accepted" else "✗" if i.get("status", "").startswith("rejected") else "○"
            cat_sections += f"<li>{mark} {i.get('module_id')} @ {i.get('symbol')} — {i.get('verdict')}</li>"
        cat_sections += "</ul>"

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Alpha Research Platform Report</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; background: #0a0e17; color: #e8e8e8; max-width: 1500px; }}
    h1, h2 {{ color: #38bdf8; }}
    table {{ border-collapse: collapse; width: 100%; font-size: 12px; margin: 1rem 0; }}
    td, th {{ border: 1px solid #333; padding: 5px 7px; }}
    tr:nth-child(even) {{ background: #111827; }}
    .verdict {{ background: #1e293b; padding: 1rem; border-radius: 8px; margin: 1rem 0; }}
    .accepted {{ color: #4ade80; }}
    .rejected {{ color: #f87171; }}
  </style>
</head>
<body>
  <h1>Alpha Research Platform</h1>
  <p>Generated: {report.get('generated_at')} · Modules: {report.get('config', {}).get('modules_tested')} · {report.get('elapsed_sec')}s</p>
  <div class="verdict">
    <p>{conclusions.get('ml_note', '')}</p>
    <p>Accepted: <span class="accepted">{len(report.get('accepted', []))}</span> ·
       Rejected: <span class="rejected">{len(report.get('rejected', []))}</span> ·
       Skipped L2: {len(report.get('skipped', []))}</p>
  </div>
  <h2>Results by Category</h2>
  {cat_sections}
  <h2>Full Results Table</h2>
  <table>
    <tr><th>Module</th><th>Category</th><th>Symbol</th><th>Status</th><th>OOS Trades</th>
    <th>OOS EV%</th><th>PF</th><th>Sharpe</th><th>Stability</th><th>Overfit</th><th>p-value</th><th>Verdict</th></tr>
    {rows}
  </table>
  <footer><p>Alpha Research Platform — no integration until ACCEPTED status.</p></footer>
</body>
</html>"""


def export_alpha_report(report: dict[str, Any], results_dir: Path) -> Path:
    results_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    html_path = results_dir / f"alpha_report_{ts}.html"
    json_path = results_dir / f"alpha_report_{ts}.json"
    html_path.write_text(render_alpha_html(report), encoding="utf-8")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return html_path

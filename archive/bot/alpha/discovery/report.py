"""Discovery research HTML report."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def export_discovery_report(report: dict[str, Any], results_dir: Path) -> Path:
    results_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    html_path = results_dir / f"discovery_report_{ts}.html"
    json_path = results_dir / f"discovery_report_{ts}.json"

    html_path.write_text(_render(report), encoding="utf-8")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return html_path


def _render(report: dict[str, Any]) -> str:
    conc = report.get("conclusions", {})
    feat_rows = "".join(
        f"<tr><td>{f.get('name')}</td><td>{f.get('symbol')}</td><td>{f.get('ic')}</td>"
        f"<td>{f.get('mi')}</td><td>{f.get('rolling_ic_positive_pct')}</td><td>{f.get('score')}</td></tr>"
        for f in report.get("feature_rankings", [])[:30]
    )
    pat_rows = "".join(
        f"<tr><td>{p.get('description')}</td><td>{p.get('status')}</td>"
        f"<td>{(p.get('out_of_sample') or {}).get('expectancy_pct')}</td>"
        f"<td>{(p.get('out_of_sample') or {}).get('profit_factor')}</td>"
        f"<td>{p.get('overfitting_score')}</td><td>{p.get('verdict')}</td></tr>"
        for p in report.get("validated_patterns", [])
    )
    inv = "<ul>" + "".join(
        f"<li>{k}: {v}</li>" for k, v in report.get("data_inventory", {}).items()
    ) + "</ul>"

    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>Quant Discovery Report</title>
<style>
body{{font-family:system-ui,sans-serif;margin:2rem;background:#0a0e17;color:#e8e8e8;max-width:1400px}}
h1,h2{{color:#a78bfa}} table{{border-collapse:collapse;width:100%;font-size:12px;margin:1rem 0}}
td,th{{border:1px solid #333;padding:6px}} tr:nth-child(even){{background:#111827}}
.verdict{{background:#1e293b;padding:1rem;border-radius:8px}}
.accepted{{color:#4ade80}} .rejected{{color:#f87171}}
</style></head><body>
<h1>Quant Discovery — Data Mining Report</h1>
<p>{report.get('generated_at')} · {report.get('elapsed_sec')}s</p>
<div class="verdict"><p>{conc.get('summary','')}</p>
<p>Accepted: <span class="accepted">{conc.get('accepted_count',0)}</span> · Validated: {conc.get('validated_count',0)}</p>
<h3>Data gaps</h3><ul>{"".join(f"<li>{g}</li>" for g in conc.get('data_gaps',[]))}</ul></div>
<h2>Data Inventory</h2>{inv}
<h2>Feature Rankings (IC / MI / Stability)</h2>
<table><tr><th>Feature</th><th>Symbol</th><th>IC</th><th>MI</th><th>Rolling IC+%</th><th>Score</th></tr>{feat_rows}</table>
<h2>Validated Patterns</h2>
<table><tr><th>Pattern</th><th>Status</th><th>OOS EV%</th><th>PF</th><th>Overfit</th><th>Verdict</th></tr>{pat_rows}</table>
<footer><p>Research result only — NOT auto-integrated into trading bot.</p></footer>
</body></html>"""

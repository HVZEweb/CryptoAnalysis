"""Phase X research HTML report."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def export_phase_x_report(report: dict[str, Any], results_dir: Path) -> Path:
    results_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    html_path = results_dir / f"phase_x_report_{ts}.html"
    html_path.write_text(_render(report), encoding="utf-8")
    return html_path


def _render(report: dict[str, Any]) -> str:
    sections = report.get("sections", {})
    cov = report.get("coverage", {}).get("summary", {})
    qual = report.get("quality", {})

    cov_rows = "".join(
        f"<tr><td>{s.get('source_id')}</td><td>{s.get('category')}</td><td>{s.get('rows')}</td>"
        f"<td>{s.get('span_days')}</td><td>{s.get('completeness_pct')}%</td>"
        f"<td>{', '.join(f'{k}:{v}' for k,v in (s.get('suitability') or {}).items())}</td></tr>"
        for s in report.get("coverage", {}).get("sources", [])[:25]
    )

    qual_rows = "".join(
        f"<tr><td>{q.get('dataset')}</td><td>{'OK' if q.get('ok') else 'FAIL'}</td>"
        f"<td>{q.get('gaps')}</td><td>{q.get('duplicates')}</td>"
        f"<td>{'; '.join(q.get('issues', []))}</td></tr>"
        for q in qual.get("results", [])[:20]
    )

    feat_list = "".join(f"<li>{f}</li>" for f in sections.get("features_investigated", [])[:20])
    sig_list = "".join(f"<li>{f}</li>" for f in sections.get("statistically_significant_features", []))
    rej_list = "".join(f"<li>{r}</li>" for r in sections.get("rejected_hypotheses", [])[:15])
    reason_list = "".join(f"<li>{r}</li>" for r in sections.get("rejection_reasons", []))
    missing_list = "".join(f"<li>{m}</li>" for m in sections.get("missing_data", [])[:15])
    retry_list = "".join(f"<li>{r}</li>" for r in sections.get("retry_after_accumulation", []))

    disc = report.get("discovery") or {}
    accepted = disc.get("accepted", [])

    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>Phase X — Alpha Discovery 2.0</title>
<style>
body{{font-family:system-ui,sans-serif;margin:2rem;background:#0a0e17;color:#e8e8e8;max-width:1400px}}
h1,h2{{color:#a78bfa}} table{{border-collapse:collapse;width:100%;font-size:12px;margin:1rem 0}}
td,th{{border:1px solid #333;padding:6px}} tr:nth-child(even){{background:#111827}}
.verdict{{background:#1e293b;padding:1.2rem;border-radius:8px;line-height:1.6}}
.ok{{color:#4ade80}} .fail{{color:#f87171}}
</style></head><body>
<h1>Phase X — Alpha Discovery 2.0</h1>
<p>{report.get('generated_at')} · {report.get('elapsed_sec')}s</p>

<div class="verdict"><h2>Итоговый вердикт</h2><p>{report.get('final_verdict','')}</p>
<p>Accepted: <span class="ok">{len(accepted)}</span> · Data sources: {cov.get('present')}/{cov.get('total_sources')} ·
Quality passed: {qual.get('passed')}/{qual.get('total')}</p></div>

<h2>1. Качество данных</h2>
<table><tr><th>Dataset</th><th>Status</th><th>Gaps</th><th>Dupes</th><th>Issues</th></tr>{qual_rows}</table>

<h2>2. Data Coverage Report</h2>
<p>Discovery ready: <b>{cov.get('discovery_ready')}</b> · Missing: {cov.get('missing')}</p>
<table><tr><th>Source</th><th>Category</th><th>Rows</th><th>Span (days)</th><th>Completeness</th><th>Suitability</th></tr>{cov_rows}</table>

<h2>3. Исследованные признаки</h2><ul>{feat_list or '<li>Discovery не запускался</li>'}</ul>

<h2>4. Статистически значимые признаки</h2><ul>{sig_list or '<li>Нет</li>'}</ul>

<h2>5. Отклонённые гипотезы</h2><ul>{rej_list or '<li>Нет валидированных паттернов</li>'}</ul>

<h2>6. Причины отклонения</h2><ul>{reason_list or '<li>—</li>'}</ul>

<h2>7. Отсутствующие данные</h2><ul>{missing_list or '<li>—</li>'}</ul>

<h2>8. Повторить после накопления данных</h2><ul>{retry_list or '<li>—</li>'}</ul>

<footer><p>Research only — NOT auto-integrated into trading bot. Schedule daily archive: npm run trading:archive</p></footer>
</body></html>"""

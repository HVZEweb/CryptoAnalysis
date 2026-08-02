"""HTML research reports."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def export_html(report: dict[str, Any], path: Path) -> Path:
    html_path = path.with_suffix(".html")
    studies_html = ""
    for s in report.get("studies", []):
        rows = "".join(
            f"<tr><td>{h.get('horizon_sec')}s</td><td>{h.get('mean_ret_pct')}</td>"
            f"<td>{h.get('win_rate')}%</td><td>{h.get('expectancy_pct')}</td>"
            f"<td>{h.get('profit_factor')}</td><td>{h.get('mae_pct')}</td><td>{h.get('mfe_pct')}</td></tr>"
            for h in s.get("horizons", [])
        )
        val = s.get("validations", [])
        accepted = s.get("accepted", False)
        studies_html += f"""
        <h3>{s.get('name')} — {s.get('events', 0)} events
          <span class="{'ok' if accepted else 'fail'}">{'ACCEPTED' if accepted else 'NOT VIABLE'}</span>
        </h3>
        <table><tr><th>Horizon</th><th>Mean%</th><th>WR</th><th>EV</th><th>PF</th><th>MAE</th><th>MFE</th></tr>{rows}</table>
        <p>Validations: {len(val)} horizons tested</p>"""

    html = f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>MSB Event Study</title>
<style>
body{{font-family:system-ui;background:#0a0e17;color:#e8e8e8;margin:2rem;max-width:1200px}}
h1,h2{{color:#a78bfa}} table{{border-collapse:collapse;width:100%;font-size:13px;margin:1rem 0}}
td,th{{border:1px solid #333;padding:6px}} .ok{{color:#4ade80}} .fail{{color:#f87171}}
</style></head><body>
<h1>Market Microstructure Alpha — Event Study</h1>
<p>{report.get('generated_at')} · {report.get('symbol')}</p>
{studies_html or '<p>No studies</p>'}
<footer><p>Research only — not live trading</p></footer>
</body></html>"""
    html_path.write_text(html, encoding="utf-8")
    return html_path


def export_phase2_html(report: dict[str, Any], json_path: Path) -> Path:
    html_path = json_path.with_suffix(".html")
    ranking = report.get("ranking", [])[:20]
    rows = "".join(
        f"<tr><td>{r.get('rank')}</td><td>{r.get('event_key')}</td><td>{r.get('horizon_sec')}s</td>"
        f"<td>{r.get('expectancy')}</td><td>{r.get('profit_factor')}</td>"
        f"<td>{r.get('bootstrap_p')}</td>"
        f"<td class=\"{'ok' if r.get('accepted') else 'fail'}\">{'YES' if r.get('accepted') else 'NO'}</td></tr>"
        for r in ranking
    )
    ds = report.get("data_summary", {})
    html = f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>Phase 2 Research</title>
<style>
body{{font-family:system-ui;background:#0a0e17;color:#e8e8e8;margin:2rem;max-width:1200px}}
h1,h2{{color:#a78bfa}} table{{border-collapse:collapse;width:100%;font-size:13px}}
td,th{{border:1px solid #333;padding:6px}} .ok{{color:#4ade80}} .fail{{color:#f87171}}
</style></head><body>
<h1>Phase 2 — Market Microstructure Research</h1>
<p>{report.get('generated_at')}</p>
<p>Accepted: <b>{report.get('accepted_count', 0)}</b> · Events tested: {report.get('event_keys_tested', 0)}</p>
<p>Data: OB {ds.get('orderbook_rows',0)} · Trades {ds.get('trade_rows',0)} · Hourly stats {ds.get('stats_rows',0)}</p>
<h2>Alpha Ranking</h2>
<table><tr><th>#</th><th>Event</th><th>Hz</th><th>EV%</th><th>PF</th><th>Boot p</th><th>Pass</th></tr>{rows}</table>
<footer>Research only — not integrated into trading bot</footer>
</body></html>"""
    html_path.write_text(html, encoding="utf-8")
    return html_path

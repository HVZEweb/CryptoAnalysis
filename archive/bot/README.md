# OKX Quant Bot (Python)

Professional spread + scalping bot for OKX. Runs **separately** from the Next.js spread page.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full design.

## Quick Start

**Python 3.10–3.14** (рекомендуется 3.12). Зависимости без `pandas-ta`/`numba`.

```bash
cd bot
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m database.init_db
python main.py
```

Uses `.env` from project root (OKX keys + MySQL).

## Modes

| Mode | How |
|------|-----|
| Paper (default) | OKX keys set, `BOT_TRADING` not set |
| Live | `BOT_TRADING=true` |
| Simulation | `BOT_SIMULATION=true` |

## Backtest

```bash
python -m backtest.engine --symbol BTC/USDT --days 30
```

## Telegram

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`.

## Disclaimer

No guaranteed profit. For educational and research purposes. Test in paper mode first.

## Maintenance Mode

The platform is **complete**. Ongoing work is support-only (bugs, reliability, data archive, reports).

**UI:** open [/maintenance](http://localhost:3000/maintenance) — plan, run archive/Phase X, view reports.

See **[MAINTENANCE.md](./MAINTENANCE.md)** for the daily/periodic workflow and restrictions.

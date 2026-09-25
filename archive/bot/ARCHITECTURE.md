# Unified OKX Futures Trading Bot

Single-process algorithmic trading engine with pluggable strategies.

## Architecture

```
main.py
├── MarketDataHub (REST ↔ WS sync)
├── OrderManager (paper / live)
│   └── LiveEngine → BracketManager (OCO SL/TP)
├── AccountRisk
├── MetaStrategy + plugins
└── trading_trades (MySQL)
```

## Production Features (Stage 1)

- **Retry**: exponential backoff on network/rate-limit errors
- **Rate limits**: throttling + cooldown tracking
- **WebSocket**: auto-reconnect with backoff, dynamic resubscribe
- **Desync control**: WS vs REST mid-price comparison, REST fallback
- **Live execution**: reduce-only closes, OCO brackets (attachAlgoOrds), amend SL, partial 50% TP
- **Liquidation guard**: emergency close + stop trading

## Commands

```bash
npm run trading:init
npm run trading:start
npm run trading:backtest
npm run trading:backtest:all
npm run trading:optimize
```

## Roadmap

| Stage | Status | Focus |
|-------|--------|-------|
| 1 Production engine | Done | Retry, WS, live brackets |
| 2 Analytics | Next | Per-trade journal, PF/Sharpe/EV |
| 3 Auto-optimization | Planned | Grid/Bayesian/walk-forward |
| 4 Market Regime | Planned | Full classifier |
| 5 ML models | Planned | XGBoost/LSTM, not LLM |
| 6 Portfolio | Planned | Multi-asset capital allocation |
| 7 Self-learning | Planned | Post-trade factor weighting |
| 8 Dashboard | Planned | Mini terminal UI |

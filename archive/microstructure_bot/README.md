# Market Microstructure Alpha Bot

Отдельный исследовательский проект для OKX USDT-M Futures.
**Не использует код Unified Trading Bot.**

## Режим: Phase 3 — Quantitative Market Research

**Роль: Quant Researcher, не Software Engineer.**

Один цикл = одна гипотеза. Новые модули не добавляются.

```bash
python main.py study --list                    # список гипотез
python main.py study --hypothesis imbalance    # один цикл
python main.py collect                         # накопление данных (недели)
```

### Гипотезы (по одной за цикл)

| ID | Вопрос |
|----|--------|
| `imbalance` | После сильного imbalance? |
| `sweep` | После серии sweep? |
| `liquidity_vanish` | После исчезновения ликвидности? |
| `absorption` | После absorption? |
| `replenishment` | После восстановления ликвидности? |
| `cumulative_delta` | После экстремального delta? |
| `spread_expand` | После расширения spread? |
| `book_flow_combo` | Стакан + поток сделок? |

### Отчёты Phase 3

- `results/report_no_edge.md` — гипотеза отвергнута
- `results/report_alpha_candidate.md` — edge найден (не автовнедрение)
- `results/study_{hypothesis}_{timestamp}.json` — полный JSON цикла

### Критерии (все обязательны)

Train/Test · Walk-forward · OOS · Bootstrap · Independent days · BTC+ETH+SOL · Net returns после fees+slippage · Экономическое объяснение

## Цель

Найти статистически воспроизводимую закономерность в L2 + trades.
**Торговый алгоритм не создаётся** до подтверждённого edge.

## Команды

```bash
cd microstructure_bot
.venv\Scripts\activate

python main.py collect              # WS сбор + почасовая статистика
python main.py collect --duration 120
python main.py status               # orderbook / trades / statistics
python main.py research             # Phase 2 полный pipeline
```

## Phase 2 Pipeline (`research`)

1. **Почасовая статистика** — imbalance, spread, depth, trade size, aggression, delta, sweeps, absorption, iceberg
2. **Event Explorer** — что после события на горизонтах 1/3/5/10/30/60 сек
3. **Anomaly detection** — квантили 1%/5%/10% (без фиксированных порогов)
4. **Validation** — train/test, walk-forward, bootstrap, independent days, BTC+ETH+SOL
5. **Alpha Ranking** — сортировка по EV, PF, OOS, bootstrap, cross-symbol
6. **Результат:**
   - `results/alpha_candidate.md` — если edge найден
   - `results/no_edge_report.md` — если нет

## Данные

```
data/
├── orderbook/
├── trades/
├── ticker/
└── statistics/    # почасовая база (append-only Parquet)
```

## Символы по умолчанию

BTC-USDT-SWAP, ETH-USDT-SWAP, SOL-USDT-SWAP

## Запрещено

RSI, EMA, MACD, Bollinger, ML, LLM, подбор параметров, автовнедрение в бота.

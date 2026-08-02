# Execution Intelligence Lab

Независимая исследовательская лаборатория поведения крупных участников и исполнения ордеров на OKX USDT-M Futures.

**Не торговый бот.** **Не генератор сигналов.** **Не использует код Unified Trading Bot и Microstructure Lab.**

## Цель

Найти статистически подтверждённые закономерности исполнения (TWAP, VWAP, iceberg, passive/aggressive execution, liquidity dynamics, MM behavior).

Все события определяются **статистически** (квантили распределения) — без фиксированных порогов.

## Экосистема

```
Execution Intelligence Lab
        ↓
Microstructure Lab
        ↓
Research Validation
        ↓
Alpha Proposal
        ↓
Manual Review
        ↓
Unified Trading Bot   ← стратегии только вручную
```

## Архитектура

```
execution_intelligence_lab/
├── collector/          # L2, trades, ticker, funding, OI
├── features/           # book + flow features
├── execution_patterns/ # statistical pattern registry
├── research/           # event study, pipeline
├── validation/         # bootstrap, walk-forward, cross checks
└── reports/            # execution_alpha_candidate.md
```

## Установка

```bash
cd execution_intelligence_lab
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Команды

```bash
python main.py collect              # сбор 24/7
python main.py collect --duration 120
python main.py status
python main.py study --list
python main.py study --pattern twap_signature   # один паттерн за цикл
python main.py scan                   # все паттерны, без подгонки
```

## Паттерны (20)

| ID | Тема |
|----|------|
| `level_defense` | Защита уровня |
| `liquidity_pull` | Снятие ликвидности |
| `fake_liquidity` | Ложная ликвидность |
| `aggressive_absorption` | Поглощение агрессии |
| `spread_hold` / `spread_widen` | MM и спред |
| `post_impulse_shift` | После импульса |
| `support_vanish` / `new_defense` | Поддержка / защита |
| `execution_completion` | Завершение крупного ордера |
| `twap_signature` / `vwap_signature` | TWAP / VWAP |
| `iceberg_refill` | Iceberg |
| `passive_execution` / `aggressive_execution` | Passive / Aggressive |
| `liquidity_refill` | Восстановление ликвидности |
| `queue_dynamics` | Очередь |
| `large_footprint` | След крупного участника |
| `inventory_unwind` | Разгрузка инвентаря |
| `mm_spread_management` | Поведение MM |

## Валидация (все обязательны для acceptance)

Event Study · Expectancy · Profit Factor · MAE · MFE · Information Coefficient · Bootstrap · Walk-forward · OOS · Cross-symbol · Cross-session · Cross-day · Net returns после fees

## Отчёты

- `results/execution_alpha_candidate.md` — паттерн прошёл все критерии
- `results/execution_no_edge.md` — отклонён (без оптимизации параметров)
- `results/study_{pattern}_{timestamp}.json` — полный JSON цикла

## Переменные окружения

`EIL_SYMBOLS`, `EIL_DATA_DIR`, `EIL_WS_URL`, `EIL_TAKER_FEE_BPS`, `EIL_SLIPPAGE_BPS`

## Принцип

Приоритет — объективное исследование. Отрицательный результат фиксируется честно. Интеграция в Unified Trading Bot — только после ручного утверждения.

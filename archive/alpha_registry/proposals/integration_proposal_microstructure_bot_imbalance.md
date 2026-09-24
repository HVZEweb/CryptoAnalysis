# Integration Proposal

**Generated:** 2026-07-11T18:45:21.500979+00:00
**Registry ID:** microstructure_bot:imbalance
**Source Lab:** microstructure_bot
**Status:** validated (manual review completed)

> Документ для рассмотрения. **Интеграция в Unified Trading Bot не выполняется автоматически.**
> Требуется отдельный pull request после вашего решения.

## Описание идеи

**Что происходит после сильного imbalance стакана?**

Экстремальный дисбаланс bid/ask depth (верхний 1% квантиль imb_10).

## Статистика

| Метрика | Значение |
|---------|----------|
| Expectancy (net) | -0.05233631805352586% |
| Profit Factor (net) | 0.0 |
| Horizon | 10s |
| Information Coefficient | None |
| MAE | 0.0677% |
| MFE | 0.0677% |
| Events | 3 |
| Orderbook rows | 1,012 |
| OOS pass | False |
| Walk-forward stable | False |
| Bootstrap p (min) | 1.0 |
| Cross-symbol | False |

## Экономическое объяснение

Преобладание лимитной ликвидности с одной стороны создаёт краткосрочное давление; возможен импульс по направлению дисбаланса или mean-reversion после поглощения.

## Ограничения

- Cross-symbol fail — нет данных/валидации: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']
- Закономерность не воспроизведена на BTC+ETH+SOL
- BTC-USDT-SWAP: insufficient events (1 < 10)
- ETH-USDT-SWAP: insufficient events (1 < 10)
- SOL-USDT-SWAP: insufficient events (1 < 10)

**Риск переобучения:** Пороги — квантили на накопленном сэмпле; риск data-snooping при малом N

## Ожидаемый риск

- Квантили и критерии определены на накопленном сэмпле — возможна деградация out-of-time
- Исполнение на live: проскальзывание, latency, funding
- Round-trip cost model: 0.12%
- Режим рынка может измениться после периода исследования

## Необходимые изменения в Unified Trading Bot

1. **Отдельный PR** — не автоматический merge
2. Модуль сигнала для `imbalance` из `microstructure_bot`
3. Paper execution path с latency simulation
4. Логирование и мониторинг отклонения от исследовательских метрик
5. Feature flag / kill switch до подтверждения live

## Влияние на риск-менеджмент

- Оценить max position size относительно глубины стакана на момент события
- Добавить лимит частоты сделок по типу события
- Correlation с существующими стратегиями бота (spread, etc.)
- Стресс-тест при расширении spread и падении ликвидности

## План paper trading

1. Запуск на новых данных (out-of-time), минимум 2–4 недели
2. Сравнение live paper EV/PF с registry metrics
3. Журнал отклонений и false positives
4. Review после paper — решение о live или retired

## Критерии перехода в live

- Paper EV > 0 после fees на N ≥ 30 событий
- PF ≥ 1.2 на paper
- Нет деградации vs registry OOS > 50%
- Явное ручное утверждение
- Risk limits настроены и протестированы

## Workflow

```
Execution Intelligence Lab → Microstructure Lab → Alpha Registry
→ Manual Review (validated) → THIS PROPOSAL → PR → Unified Trading Bot
```
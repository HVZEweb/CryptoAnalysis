# Итоговый отчёт — Edge не обнаружен

**Generated:** 2026-07-12T08:08:14.440711+00:00

## Вердикт

На доступном объёме данных микроструктуры **не найдено ни одного события**, которое прошло все проверки:

- train/test split с положительным OOS
- walk-forward stability
- bootstrap significance (p < 0.05)
- independent days
- воспроизведение на BTC, ETH и SOL

## Данные

- Symbols: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']
- Orderbook rows: 165980
- Trade rows: 53116
- Hourly stats rows: 9

## Протестировано событий

Всего кандидатов в рейтинге: **30**

| Rank | Event | Horizon | EV% | PF | Cross |
|------|-------|---------|-----|-----|-------|
| 1 | spread_expand_q99 | 300s | 0.0655 | 3.579 | N |
| 2 | spread_expand_q90 | 300s | 0.0553 | 2.882 | N |
| 3 | delta_dump_q9 | 300s | 0.028 | 1.58 | N |
| 4 | absorption_strong_flag | 300s | 0.0182 | 1.304 | N |
| 5 | delta_surge_q99 | 300s | 0.0143 | 1.529 | N |
| 6 | depth_vanish_q1 | 300s | 0.0121 | 1.329 | N |
| 7 | aggressive_buy_surge_q99 | 300s | 0.0112 | 1.779 | N |
| 8 | replenishment_fast_flag | 300s | 0.0097 | 1.266 | N |
| 9 | sweep_series_flag | 300s | 0.0086 | 1.22 | N |
| 10 | spread_expand_q95 | 30s | 0.0079 | 1.263 | N |
| 11 | extreme_imbalance_high_q90 | 30s | 0.0078 | 2.708 | N |
| 12 | delta_surge_q95 | 300s | 0.0072 | 1.406 | N |
| 13 | extreme_imbalance_high_q99 | 30s | 0.0067 | 2.925 | N |
| 14 | extreme_imbalance_high_q95 | 30s | 0.006 | 3.352 | N |
| 15 | extreme_imbalance_low_q9 | 300s | 0.0042 | 1.377 | N |

## Что может изменить вывод

- Накопление недель/месяцев непрерывного `collect`
- Более глубокий L2 (books-l2-tbt)
- Кросс-биржевой basis
- Режимы высокой волатильности (отдельная выборка)

**Торговый алгоритм не создавался** — только исследование.
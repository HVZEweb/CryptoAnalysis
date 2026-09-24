# Report — No Edge (Phase 3)

**Generated:** 2026-07-12T08:07:18.178204+00:00
**Hypothesis:** book_flow_combo
**Question:** Что происходит после одновременного изменения стакана и потока сделок?

## Вердикт

Статистически воспроизводимое преимущество **не обнаружено** для данной гипотезы.

## Что исследовали

Absorption при экстремальном imbalance — комбинация стакана и tape.

## Выборка

- Events detected: **142**
- Orderbook rows: 165980
- Trade rows: 53116
- Symbols with data: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']

## Проверки выполнены

- Train/Test split
- Walk-forward
- Out-of-sample
- Bootstrap significance
- Independent days
- Cross-symbol (BTC, ETH, SOL)
- Net returns after fees + slippage

## Почему гипотеза отвергнута

- Cross-symbol fail — нет данных/валидации: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']
- Закономерность не воспроизведена на BTC+ETH+SOL
- BTC-USDT-SWAP: negative train EV; OOS fail; walk-forward unstable; bootstrap p=0.492; independent days fail; net EV after fees negative on train
- ETH-USDT-SWAP: negative train EV; OOS fail; walk-forward unstable; bootstrap p=0.500; independent days fail; net EV after fees negative on train
- SOL-USDT-SWAP: negative train EV; OOS fail; walk-forward unstable; bootstrap p=0.510; independent days fail; net EV after fees negative on train

### Per-symbol validation
- BTC-USDT-SWAP: negative train EV; OOS fail; walk-forward unstable; bootstrap p=0.492; independent days fail; net EV after fees negative on train
- ETH-USDT-SWAP: negative train EV; OOS fail; walk-forward unstable; bootstrap p=0.500; independent days fail; net EV after fees negative on train
- SOL-USDT-SWAP: negative train EV; OOS fail; walk-forward unstable; bootstrap p=0.510; independent days fail; net EV after fees negative on train

## Экономическое объяснение (ожидаемое)

Согласованный сигнал стакана и потока — более сильный, чем каждый по отдельности.

**Торговая стратегия не создавалась.**
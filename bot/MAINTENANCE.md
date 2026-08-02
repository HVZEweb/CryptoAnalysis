# Maintenance Mode

**Статус:** платформа завершена. Режим — только сопровождение.

Компоненты считаются закрытыми:

- Unified Trading Bot (`bot/`)
- Research Framework (`bot/research/`)
- Alpha Research Platform (`bot/alpha/`)
- Phase X — Alpha Discovery 2.0 (`bot/alpha/phase_x.py`)

---

## Разрешено

| Категория | Примеры |
|-----------|---------|
| Исправление ошибок | API 400, падения загрузки, краши CLI |
| Производительность | Медленный discovery, лишние I/O |
| Надёжность | Retry, dedup, append-archive |
| Логирование | Структура логов, уровни, контекст |
| OKX API | Изменения эндпоинтов, параметров |
| Качество данных | Coverage, quality checks, incremental fetch |
| Качество отчётов | HTML/JSON, читаемость, сравнение прогонов |

## Запрещено

- Новые стратегии, индикаторы, гипотезы, исследовательские модули
- Архитектурные изменения
- Изменение торговой логики бота
- Оптимизация / подбор параметров
- ML и новые признаки
- Автоматическая интеграция результатов исследований в бота

---

## UI — панель сопровождения

Откройте в браузере: **`/maintenance`** (или Dev Tools → Maintenance Mode на главной).

| Вкладка | Содержание |
|---------|------------|
| **План** | Дорожная карта, прогресс funding/OI, когда завершать |
| **Действия** | Кнопки запуска архива / coverage / Phase X + лог |
| **Отчёты** | Список `bot/alpha/results/`, просмотр JSON/HTML |
| **Сравнение** | Baseline vs последний Phase X |

Запуск задач из UI требует `ADMIN_SECRET` в `.env` (заголовок вводится на вкладке «Действия»). В local dev без секрета — работает автоматически.

---

```bash
# Из корня проекта — накопление данных (append-only, история не удаляется)
npm run trading:archive
```

Рекомендуется планировать через **Windows Task Scheduler** (ежедневно, например 03:00 UTC).

С L2-снимками (дольше, ~6 мин на 3 символа):

```bash
cd bot
.venv\Scripts\python.exe -m alpha.run_archive --l2-duration 120
```

---

## Периодический цикл (Phase X)

```bash
# Полный цикл: coverage → quality → discovery (~30+ мин на полной истории)
npm run trading:phase-x

# Только аудит данных (быстро, ~3 с)
npm run trading:coverage
```

**Рекомендуемая частота:** раз в 1–2 недели, или после 30+ дней накопления funding/OI.

---

## Сравнение отчётов

Отчёты сохраняются в `bot/alpha/results/`:

| Тип | Шаблон имени |
|-----|----------------|
| Phase X | `phase_x_report_YYYYMMDD_HHMMSS.html` + `.json` |
| Discovery | `discovery_report_*.html` + `.json` |
| Coverage | `coverage_report_*.json` |
| Archive run | `archive_last.json` |
| Alpha modules | `alpha_report_*.html` |

**Что сравнивать:**

1. `coverage.summary.discovery_ready` и `present` / `missing`
2. `quality.passed` / `quality.failed`
3. `discovery.accepted` — должен оставаться пустым до появления реального edge
4. `discovery.conclusions.rejection_reasons` — стабильность причин отклонения
5. `final_verdict` в Phase X JSON

Предыдущий baseline (2026-07-11): **0 accepted**, funding/OI короткие, liquidations API 400.

---

## Если появится подтверждённая закономерность

Условия (все одновременно, уже реализованы в discovery):

- Положительный expectancy, PF > 1
- Положительный OOS и walk-forward
- Bootstrap p-value значим
- Нет признаков переобучения
- Воспроизведение на ≥ 2 инструментах

**Действия:**

1. Зафиксировать в отдельном файле `bot/alpha/results/proposal_YYYYMMDD.md`
2. Указать: правило, символы, метрики, отчёт-источник
3. Предложить к **ручному** рассмотрению
4. **Не** внедрять в `main.py` / стратегии автоматически

---

## Справочник команд

| Команда | Назначение |
|---------|------------|
| `npm run trading:archive` | Ежедневный архив данных |
| `npm run trading:coverage` | Coverage + quality |
| `npm run trading:phase-x` | Полный Phase X |
| `npm run trading:discovery` | Только discovery |
| `npm run trading:alpha` | 31 hypothesis modules |
| `npm run trading:alpha-download` | Разовая загрузка alpha CSV |
| `npm run trading:download-data` | OHLCV 12 мес |
| `npm run trading:start` | Торговый бот (логику не менять) |

---

## Когда можно выйти из Maintenance Mode

Только при явном решении владельца проекта:

- Накоплены новые качественные данные (30+ дней funding, 7+ дней OI, L2 archive), **и** нужен повторный Phase X
- Или одобрена **новая** исследовательская гипотеза (отдельное решение, не автоматически)

До этого момента архитектура считается **стабильной и завершённой**.

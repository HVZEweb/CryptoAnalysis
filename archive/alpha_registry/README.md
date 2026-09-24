# Alpha Registry

Общий слой результатов исследований из независимых лабораторий.

## Процесс

```
Исследование → Доказательство → Регистрация → Ручное решение → Интеграция (только validated)
```

## Статусы

| Статус | Значение |
|--------|----------|
| `candidate` | Прошла критерии лаборатории, ждёт ручной проверки |
| `validated` | **Единственный статус для рассмотрения переноса в Unified Trading Bot** |
| `rejected` | Не подтверждена |
| `retired` | Снята с рассмотрения |

## Поля записи

- `registry_id` — уникальный ID (`{lab}:{hypothesis_id}`)
- описание, экономическое объяснение
- данные проверки (symbols, rows, events, study file)
- OOS, walk-forward, bootstrap, cross-symbol
- ограничения, риск переобучения
- история изменений

## CLI

```bash
python -m alpha_registry ingest --lab all
python -m alpha_registry list
python -m alpha_registry show microstructure_bot:imbalance
python -m alpha_registry set-status microstructure_bot:imbalance validated --note "Manual review OK"
python -m alpha_registry summary
```

## Документы (финальный этап)

При **validated** (ручной перевод статуса):
- `proposals/integration_proposal_{registry_id}.md`
- `proposals/integration_proposal.md` (последний)

После **≥90 дней** наблюдений без validated (автоматически при ingest):
- `proposals/final_research_conclusion.md`

Переменные: `REGISTRY_FINAL_MIN_DAYS` (default 90), `REGISTRY_FINAL_MIN_RECORDS` (default 8)

Интеграция в Unified Trading Bot — **только отдельный PR**, никогда автоматически.

## Правила

- Лаборатории **не изменяются** — ingest читает `study_*.json` из results/
- `validated` **никогда не понижается** автоматически при новом неудачном study
- Unified Trading Bot **не получает** записи автоматически

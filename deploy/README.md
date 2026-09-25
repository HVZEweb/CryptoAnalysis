# Установка на VPS

Первая установка — на сервере от root:

```bash
curl -fsSL https://raw.githubusercontent.com/HVZEweb/CryptoAnalysis/main/deploy/update.sh | bash
```

Код ставится в `/opt/cryptoanalysis`, сайт — сервис `cryptoanalysis`. Повторный запуск — это
обновление: `.env`, база и переобученные модели (`/opt/cryptoanalysis-data`) сохраняются.
Соседние сервисы не трогаются.

| | |
|---|---|
| Настройки | `/opt/cryptoanalysis/.env` → после правки `systemctl restart cryptoanalysis` |
| Логи | `journalctl -u cryptoanalysis -f` |
| Переобучение модели | `cryptoanalysis-train.timer` (вс 04:00), `journalctl -u cryptoanalysis-train -f`; при выкладке — только если изменился код обучения |
| Сбор рыночных данных | `cryptoanalysis-market-data.timer` (каждые 5 минут), `journalctl -u cryptoanalysis-market-data -f` |

## Доступ к Binance/OpenRouter из РФ

Установщик сам проверяет доступ и выбирает способ:

- **IPsec-VPN (strongSwan и т.п.)** — туннель пропускает трафик только с «своего» адреса.
  Установщик находит этот адрес (`OUTBOUND_SOURCE_IP` в `.env`), а приложение привязывает к нему
  только соединения с заблокированными хостами (`OUTBOUND_VPN_HOSTS`, по умолчанию `openrouter.ai`).
  Binance и остальное идут напрямую — через туннель каждый запрос в несколько раз медленнее.
- **VPN-клиент с локальным прокси** — `OUTBOUND_PROXY=http://127.0.0.1:ПОРТ` (или `socks5h://…`).

## Как сайт открывается снаружи

Если на сервере есть Caddy, сайт слушает только `127.0.0.1`, а наружу выходит по
`https://PUBLIC_HOST:PUBLIC_PORT` (по умолчанию порт 8443) в закрытом режиме (`SITE_PRIVATE=true`):
всё доступно только после входа, новых пользователей добавляет администратор в `/admin`.

Первая зарегистрированная учётная запись становится администратором. Пока администратора нет,
сайт дополнительно закрыт паролем Caddy (`SITE_USER` / `SITE_PASSWORD` из `.env`); после
регистрации пароль Caddy снимается при следующем запуске установщика.

Без Caddy — `http://IP:порт` без шифрования.

## Автоматическая публикация

После каждого изменения в `main` (когда CI зелёный) GitHub заходит на сервер по SSH как
пользователь `deploy`. Его ключ на сервере привязан к одной команде — обновить сайт из `main`
(`/usr/local/sbin/cryptoanalysis-deploy`); ничего другого с этим ключом сделать нельзя.

Секреты репозитория:

- `VPS_HOST` — IP сервера;
- `VPS_SSH_KEY` — закрытый ключ; его открытую часть добавить строкой в
  `/var/lib/cryptoanalysis-deploy/.ssh/authorized_keys` (ограничение команды установщик допишет сам);
- `VPS_USER` — необязательно, по умолчанию `deploy`;
- `OPENROUTER_API_KEY` — при каждой публикации записывается в `.env`.

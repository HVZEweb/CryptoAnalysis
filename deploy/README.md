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
| Сбор рыночных данных | `cryptoanalysis-market-data.timer` (каждые 5 минут), `journalctl -u cryptoanalysis-market-data -f` |
| Модели | обучаются в GitHub Actions по субботам (`.github/workflows/train-models.yml`) → релиз `models`; сервер забирает их каждый день в 06:00 (`cryptoanalysis-models-sync.timer`), вручную: `systemctl start cryptoanalysis-models-sync`. На сервере обучение не запускается |

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

## Сайт на закрытом сервере, вход через другой

Сайт может работать на сервере, закрытом для интернета (бэкенд), а посетители — заходить через другой
сервер (фронт), чей Caddy пересылает запросы на бэкенд по TLS.

- На бэкенде в `.env`: `FRONT_PROXY_IP=<адрес фронта>` и `AUTO_UPDATE=true`. Установщик ставит Caddy-блок
  `https://cryptoanalysis.internal:PORT` со своим сертификатом (`tls internal`), пускает только
  `FRONT_PROXY_IP`, берёт адрес посетителя из `X-Real-IP` и ничего не открывает наружу.
- На фронте `bash deploy/front-proxy.sh <адрес бэкенда> <PORT> <root.crt>` ставит пересылку с проверкой
  сертификата (корень внутреннего CA Caddy бэкенда:
  `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`) и выключает свою копию сайта.
- Сборка идёт в группе памяти до 1,3 ГБ (`systemd-run --scope`): при нехватке останавливается она, а не
  соседние сервисы. Если подкачки нет, установщик заводит 2 ГБ.

## Автоматическая публикация

GitHub не может зайти на закрытый сервер, поэтому сервер обновляется сам: таймер
`cryptoanalysis-autoupdate` (каждые 5 минут) сверяет `main` с установленной версией и запускает
`deploy/update.sh`, только если проверка CI `test` по новому коммиту зелёная.
Журнал: `journalctl -u cryptoanalysis-autoupdate`. OpenRouter-ключ живёт в `.env` сервера.

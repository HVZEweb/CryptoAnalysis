# Установка на VPS

1. Скопировать архив на сервер (с компьютера, где лежит SSH-ключ):
   `scp cryptoanalysis.tar.gz root@<IP>:/root/`
2. На сервере:
   ```bash
   mkdir -p /opt/cryptoanalysis && tar xzf /root/cryptoanalysis.tar.gz -C /opt/cryptoanalysis
   bash /opt/cryptoanalysis/deploy/install.sh
   ```
3. Скрипт спросит OpenRouter API-ключ (ввод скрыт) и, если нужно, пароль root от MySQL.

Сайт запускается как сервис `cryptoanalysis` на первом свободном порту начиная с 3100 и не трогает
другие сервисы. Настройки — `/opt/cryptoanalysis/.env`; после правки: `systemctl restart cryptoanalysis`.

- Логи: `journalctl -u cryptoanalysis -f`
- VPN-прокси для Binance/OpenRouter: `OUTBOUND_PROXY=http://127.0.0.1:ПОРТ` (или `socks5h://...`) в `.env`
- Обновление: распаковать новый архив поверх и снова запустить `install.sh` (`.env` и база сохраняются)

## Автоматическая публикация

После каждого изменения в `main` (когда CI зелёный) GitHub заходит на сервер по SSH и запускает
`deploy/update.sh`: забирает свежий код и перезапускает сайт. Нужны секреты репозитория
`VPS_HOST` (IP сервера) и `VPS_SSH_KEY` (закрытый ключ, чья открытая часть есть в
`/root/.ssh/authorized_keys` на сервере). Пока секретов нет, шаг публикации пропускается.
Если задан секрет `OPENROUTER_API_KEY`, он при каждой публикации записывается в `.env` на сервере.

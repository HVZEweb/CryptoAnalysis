#!/usr/bin/env bash
# Установка или обновление CryptoAnalysis на VPS (Ubuntu/Debian), рядом с уже работающими сервисами.
#
#   bash deploy/install.sh
#
# Что делает (повторный запуск безопасен — это и есть обновление):
#   - свой Node.js в /opt/cryptoanalysis-node (системный Node и другие сервисы не трогаются)
#   - отдельная база и пользователь MySQL/MariaDB `cryptoanalysis`
#   - проверяет доступ к Binance/OpenRouter напрямую и через локальный VPN-прокси
#   - .env (существующие значения не перезаписываются), сборка, systemd-сервис на свободном порту
#   - еженедельное переобучение модели прогнозов
set -euo pipefail

APP=cryptoanalysis
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
# Server-trained models live outside the checkout, so a code update never overwrites them.
DATA_DIR=/opt/$APP-data
NODE_VERSION=v22.22.2
NODE_DIR=/opt/$APP-node

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "запустите от root"
command -v apt-get >/dev/null || die "скрипт рассчитан на Ubuntu/Debian (нужен apt-get)"
[ -f "$APP_DIR/package.json" ] || die "не найден package.json в $APP_DIR"

env_get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
env_set() { # добавляет ключ, только если его ещё нет
  touch "$ENV_FILE"
  grep -qE "^$1=" "$ENV_FILE" || printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
}
rand() { openssl rand -hex "${1:-24}"; }

# ---------------------------------------------------------------------------
say "Системные пакеты"
missing=()
for pkg in curl ca-certificates xz-utils openssl iproute2 git; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if [ ${#missing[@]} -gt 0 ]; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}" >/dev/null
fi
ok "curl, openssl, xz готовы"

# ---------------------------------------------------------------------------
say "Проверка доступа в интернет (Binance, OpenRouter)"
# code <url> [proxy] -> HTTP-код (000 — нет соединения)
code() {
  local args=(-s -o /dev/null -m 12 -w '%{http_code}')
  [ -n "${2:-}" ] && args+=(-x "$2")
  curl "${args[@]}" "$1" 2>/dev/null
  true
}
reachable() { [[ "$(code "$@")" == 2* ]]; }
reach_all() { # все ключевые хосты отвечают 2xx?
  local p="${1:-}"
  for u in https://api.binance.com/api/v3/ping https://fapi.binance.com/fapi/v1/ping https://openrouter.ai/api/v1/models; do
    reachable "$u" "$p" || return 1
  done
}
report() {
  local p="${1:-}"
  for u in https://api.binance.com/api/v3/ping https://fapi.binance.com/fapi/v1/ping https://openrouter.ai/api/v1/models https://api.coingecko.com/api/v3/ping; do
    printf '   %-45s %s\n' "$u" "$(code "$u" "$p")"
  done
}

PROXY="$(env_get OUTBOUND_PROXY)"
if [ -n "$PROXY" ]; then
  ok "используется прокси из .env: $PROXY"
elif reach_all; then
  ok "все сервисы доступны напрямую (или через системный VPN)"
else
  warn "напрямую доступно не всё — ищу локальный VPN-прокси"
  report
  candidates=()
  for v in "${https_proxy:-}" "${HTTPS_PROXY:-}" "${all_proxy:-}" "${ALL_PROXY:-}"; do [ -n "$v" ] && candidates+=("$v"); done
  # любые слушающие порты, кроме заведомо не-прокси (ssh, почта, базы)
  ports=$(ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | grep -vxE '22|25|53|3306|5432|6379|27017' | sort -un)
  for port in $ports; do
    candidates+=("http://127.0.0.1:$port" "socks5h://127.0.0.1:$port")
  done
  for c in "${candidates[@]}"; do
    if reach_all "$c"; then PROXY="$c"; break; fi
  done
  if [ -n "$PROXY" ]; then
    ok "найден рабочий прокси: $PROXY"
    env_set OUTBOUND_PROXY "$PROXY"
  else
    warn "рабочий прокси не найден. Сайт запустится, но без доступа к бирже/AI прогнозы работать не будут."
    warn "Если VPN даёт прокси, впишите его в $ENV_FILE строкой OUTBOUND_PROXY=http://127.0.0.1:ПОРТ и запустите скрипт снова."
  fi
fi
[ -n "$PROXY" ] && report "$PROXY"

# npm/nodejs.org: напрямую, а если не выходит и прокси http — через него
NPM_PROXY_ARGS=()
if ! reachable https://registry.npmjs.org/ && [[ "$PROXY" == http* ]]; then
  export https_proxy="$PROXY" HTTPS_PROXY="$PROXY"
  NPM_PROXY_ARGS=(--https-proxy "$PROXY")
  warn "npm будет работать через прокси"
fi

# ---------------------------------------------------------------------------
say "Node.js $NODE_VERSION (отдельная копия в $NODE_DIR)"
if [ "$("$NODE_DIR/bin/node" -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "неподдерживаемая архитектура $(uname -m)" ;;
  esac
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$arch.tar.xz" -o "$tmp/node.tar.xz" \
    || die "не удалось скачать Node.js"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/node.tar.xz" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
fi
export PATH="$NODE_DIR/bin:$PATH"
ok "node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------------------
say "База данных"
MYSQL_ROOT=(mysql -uroot)
mysql_root_ok() { "${MYSQL_ROOT[@]}" -e 'SELECT 1' >/dev/null 2>&1; }
if ! command -v mysql >/dev/null; then
  if ss -ltnH | awk '{print $4}' | grep -qE ':3306$'; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mariadb-client >/dev/null
  else
    say "Устанавливаю MariaDB"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mariadb-server >/dev/null
    systemctl enable --now mariadb >/dev/null 2>&1 || true
  fi
fi
if ! mysql_root_ok; then
  if [ -t 0 ]; then
    read -rsp "   Пароль root для MySQL/MariaDB: " MYSQL_ROOT_PASSWORD; echo
    export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
    MYSQL_ROOT=(mysql -uroot -h127.0.0.1)
  fi
  mysql_root_ok || die "нет доступа к MySQL под root. Запустите скрипт в терминале, чтобы ввести пароль."
fi
DB_PASSWORD="$(env_get DB_PASSWORD)"
[ -n "$DB_PASSWORD" ] || DB_PASSWORD=$(rand 16)
"${MYSQL_ROOT[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`$APP\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$APP'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$APP'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$APP'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$APP'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$APP\`.* TO '$APP'@'localhost';
GRANT ALL PRIVILEGES ON \`$APP\`.* TO '$APP'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
unset MYSQL_PWD
ok "база '$APP' и пользователь '$APP' готовы (другие базы не затронуты)"

# ---------------------------------------------------------------------------
say "Настройки (.env)"
port_busy() { ss -ltnH | awk '{print $4}' | grep -qE ":$1\$"; }
PORT="$(env_get APP_PORT)"
if [ -z "$PORT" ]; then
  PORT=3100
  while port_busy "$PORT"; do PORT=$((PORT + 1)); done
fi
env_set APP_PORT "$PORT"
env_set DB_HOST 127.0.0.1
env_set DB_PORT 3306
env_set DB_USER "$APP"
env_set DB_PASSWORD "$DB_PASSWORD"
env_set DB_NAME "$APP"
env_set OPENROUTER_URL https://openrouter.ai/api/v1
env_set OPENROUTER_MODEL deepseek/deepseek-chat
env_set OPENROUTER_FALLBACK_MODELS google/gemini-2.5-flash
env_set ADMIN_SECRET "$(rand 16)"
env_set PAYMENT_WEBHOOK_SECRET "$(rand 24)"
# Сайт открывается по http://IP:порт — без https браузер не сохранит secure-cookie
env_set COOKIE_SECURE false
env_set PREDICTOR_MODELS_DIR "$DATA_DIR/models"
if [ -z "$(env_get OPENROUTER_API_KEY)" ]; then
  if [ -t 0 ]; then
    read -rsp "   OpenRouter API-ключ (sk-or-..., Enter — пропустить): " key; echo
    [ -n "$key" ] && env_set OPENROUTER_API_KEY "$key"
  fi
  [ -n "$(env_get OPENROUTER_API_KEY)" ] || warn "OPENROUTER_API_KEY не задан — впишите его в $ENV_FILE и перезапустите: systemctl restart $APP"
fi
chmod 600 "$ENV_FILE"
ok "порт $PORT, файл $ENV_FILE"

# ---------------------------------------------------------------------------
say "Установка зависимостей и сборка (несколько минут)"
cd "$APP_DIR"
npm ci --no-audit --no-fund --loglevel=error "${NPM_PROXY_ARGS[@]}"
NODE_ENV=production npm run build --silent >/tmp/$APP-build.log 2>&1 || { tail -40 /tmp/$APP-build.log; die "сборка не удалась (лог: /tmp/$APP-build.log)"; }
ok "сборка готова"

id -u "$APP" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP"
MODELS_DIR="$(env_get PREDICTOR_MODELS_DIR)"
mkdir -p "$MODELS_DIR"
# First install: start from the models shipped in the repo; afterwards the weekly retrain owns them.
[ -n "$(ls -A "$MODELS_DIR" 2>/dev/null)" ] || cp "$APP_DIR"/models/predictor/*.json "$MODELS_DIR"/
chown -R "$APP:$APP" "$APP_DIR" "$DATA_DIR"

# ---------------------------------------------------------------------------
say "Сервис systemd"
cat > /etc/systemd/system/$APP.service <<UNIT
[Unit]
Description=CryptoAnalysis (Next.js) on port $PORT
After=network-online.target mariadb.service mysql.service
Wants=network-online.target

[Service]
User=$APP
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
ExecStart=$NODE_DIR/bin/node $APP_DIR/node_modules/next/dist/bin/next start -p $PORT -H 0.0.0.0
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/$APP-train.service <<UNIT
[Unit]
Description=CryptoAnalysis: переобучение модели прогнозов

[Service]
Type=oneshot
User=$APP
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
ExecStart=$NODE_DIR/bin/node $APP_DIR/node_modules/tsx/dist/cli.mjs scripts/train-predictor.ts
UNIT

cat > /etc/systemd/system/$APP-train.timer <<UNIT
[Unit]
Description=CryptoAnalysis: еженедельное переобучение модели

[Timer]
OnCalendar=Sun 04:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now $APP-train.timer >/dev/null 2>&1
systemctl enable $APP >/dev/null 2>&1
systemctl restart $APP
ok "сервис $APP запущен"

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null && ok "порт $PORT открыт в ufw"
fi

# ---------------------------------------------------------------------------
say "Проверка"
for _ in $(seq 1 30); do
  c=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)
  [ "$c" = 200 ] && break
  sleep 2
done
[ "$c" = 200 ] && ok "сайт отвечает на порту $PORT" || { journalctl -u $APP -n 30 --no-pager; die "сайт не отвечает — лог выше"; }

# Модель переобучается на свежих данных Binance в фоне (5–15 минут), сайт тем временем работает
systemctl start --no-block $APP-train.service

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
cat <<DONE

$(printf '\033[1;32m')Готово!$(printf '\033[0m')
  Сайт:            http://$IP:$PORT
  Админка:         http://$IP:$PORT/admin  (пароль: ADMIN_SECRET в $ENV_FILE)
  Логи:            journalctl -u $APP -f
  Перезапуск:      systemctl restart $APP
  Переобучение:    journalctl -u $APP-train -f   (идёт сейчас, дальше — по воскресеньям)
  Обновление:      bash $APP_DIR/deploy/update.sh   (или автоматически после каждого изменения в main)
DONE

#!/usr/bin/env bash
# Установка или обновление CryptoAnalysis на VPS (Ubuntu/Debian), рядом с уже работающими сервисами.
#
#   bash deploy/install.sh
#
# Что делает (повторный запуск безопасен — это и есть обновление):
#   - свой Node.js в /opt/cryptoanalysis-node (системный Node и другие сервисы не трогаются)
#   - отдельная база и пользователь MySQL/MariaDB `cryptoanalysis`
#   - проверяет доступ к Binance/OpenRouter напрямую, через IPsec-VPN (адрес-источник) или прокси
#   - при наличии Caddy: сайт только на 127.0.0.1, снаружи https с паролем
#   - пользователь deploy для автопубликации из GitHub (может только запустить обновление)
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
env_put() { # задаёт ключ, заменяя старое значение
  touch "$ENV_FILE"
  local tmp; tmp=$(mktemp)
  grep -vE "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
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
id -u "$APP" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP"

# ---------------------------------------------------------------------------
say "Проверка доступа в интернет (Binance, OpenRouter)"
# code <url> [route] -> HTTP-код (000 — нет соединения).
# route: пусто — напрямую, src:IP — с адреса-источника (IPsec-VPN), иначе — URL прокси.
code() {
  local args=(-s -o /dev/null -m 12 -w '%{http_code}')
  case "${2:-}" in
    "") ;;
    src:*) args+=(--interface "${2#src:}") ;;
    *) args+=(-x "$2") ;;
  esac
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
VPN_SRC="$(env_get OUTBOUND_SOURCE_IP)"
# Адрес, с которого сервер ходит в интернет по умолчанию; остальные глобальные адреса —
# кандидаты в адрес IPsec-туннеля (policy-based VPN пропускает только трафик с этого адреса).
MAIN_SRC=$(ip -4 route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | cut -d' ' -f2)
if [ -n "$PROXY" ]; then
  ok "используется прокси из .env: $PROXY"
elif [ -n "$VPN_SRC" ]; then
  ok "используется VPN-адрес из .env: $VPN_SRC"
elif reach_all; then
  ok "все сервисы доступны напрямую (или через системный VPN)"
else
  warn "напрямую доступно не всё — ищу VPN"
  report
  for ip in $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1); do
    [ "$ip" = "$MAIN_SRC" ] && continue
    if reach_all "src:$ip"; then VPN_SRC="$ip"; break; fi
  done
  if [ -n "$VPN_SRC" ]; then
    ok "найден IPsec-VPN: трафик с адреса $VPN_SRC проходит"
    env_set OUTBOUND_SOURCE_IP "$VPN_SRC"
  fi
fi
if [ -z "$PROXY" ] && [ -z "$VPN_SRC" ] && ! reach_all; then
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

# IPsec-VPN: весь исходящий трафик пользователя $APP уходит с адреса $VPN_SRC (в туннель),
# остальные процессы сервера не затрагиваются.
if [ -n "$VPN_SRC" ]; then
  read -r GW DEV < <(ip -4 route show default | awk '{for(i=1;i<NF;i++){if($i=="via")g=$(i+1);if($i=="dev")d=$(i+1)}} END{print g, d}')
  [ -n "$GW" ] && [ -n "$DEV" ] || die "не удалось определить шлюз по умолчанию"
  APP_UID=$(id -u "$APP")
  cat > /usr/local/sbin/$APP-vpn-route <<EOF
#!/bin/sh
ip route replace default via $GW dev $DEV onlink src $VPN_SRC table 7077
ip rule del priority 1078 2>/dev/null || true
ip rule add uidrange $APP_UID-$APP_UID lookup 7077 priority 1078
EOF
  chmod 755 /usr/local/sbin/$APP-vpn-route
  cat > /etc/systemd/system/$APP-vpn-route.service <<UNIT
[Unit]
Description=CryptoAnalysis: исходящий трафик через VPN (src $VPN_SRC)
After=network-online.target strongswan.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/$APP-vpn-route

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable $APP-vpn-route >/dev/null 2>&1
  systemctl restart $APP-vpn-route
  printf '   от имени %s: openrouter.ai → %s\n' "$APP" \
    "$(sudo -u "$APP" curl -s -o /dev/null -m 12 -w '%{http_code}' https://openrouter.ai/api/v1/models || true)"
fi

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
if [ "$PORT" != 3100 ]; then
  holder=$(ss -ltnpH 2>/dev/null | awk '$4 ~ /:3100$/' | grep -o 'users:(("[^"]*"' | head -1 | cut -d'"' -f2)
  warn "порт 3100 занят${holder:+ процессом '$holder'} — сайт будет на порту $PORT"
fi
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
env_set PREDICTOR_MODELS_DIR "$DATA_DIR/models"
# Ключ из секрета GitHub (передаётся автопубликацией) всегда главнее того, что в .env.
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  env_put OPENROUTER_API_KEY "$OPENROUTER_API_KEY"
  ok "OpenRouter-ключ взят из секрета GitHub"
elif [ -z "$(env_get OPENROUTER_API_KEY)" ]; then
  if [ -t 0 ]; then
    read -rsp "   OpenRouter API-ключ (sk-or-..., Enter — пропустить): " key; echo
    [ -n "$key" ] && env_set OPENROUTER_API_KEY "$key"
  fi
  [ -n "$(env_get OPENROUTER_API_KEY)" ] || warn "OPENROUTER_API_KEY не задан — добавьте секрет OPENROUTER_API_KEY в GitHub или впишите его в $ENV_FILE"
fi

# Если на сервере есть Caddy — сайт слушает только 127.0.0.1, а наружу выходит по https
# через Caddy (порт PUBLIC_PORT) с паролем. Без Caddy — как раньше, http://IP:порт.
CADDYFILE=/etc/caddy/Caddyfile
if command -v caddy >/dev/null && [ -f "$CADDYFILE" ]; then
  USE_CADDY=1
  BIND=127.0.0.1
  env_set PUBLIC_PORT 8443
  env_set PUBLIC_HOST "$MAIN_SRC"
  env_set SITE_USER admin
  env_set SITE_PASSWORD "$(rand 9)"
  env_put COOKIE_SECURE true
else
  USE_CADDY=0
  BIND=0.0.0.0
  # Сайт открывается по http://IP:порт — без https браузер не сохранит secure-cookie
  env_put COOKIE_SECURE false
fi
chown root:"$APP" "$ENV_FILE"
chmod 640 "$ENV_FILE"
ok "порт $PORT, файл $ENV_FILE"

# ---------------------------------------------------------------------------
say "Установка зависимостей и сборка (несколько минут)"
cd "$APP_DIR"
# Build caches left by running Next.js from a subfolder confuse the type check — they are safe to drop.
find "$APP_DIR" -mindepth 2 -maxdepth 3 -type d -name .next -not -path "*/node_modules/*" -prune -exec rm -rf {} +
npm ci --no-audit --no-fund --loglevel=error "${NPM_PROXY_ARGS[@]}"
NODE_ENV=production npm run build --silent >/tmp/$APP-build.log 2>&1 || { tail -40 /tmp/$APP-build.log; die "сборка не удалась (лог: /tmp/$APP-build.log)"; }
ok "сборка готова"

MODELS_DIR="$(env_get PREDICTOR_MODELS_DIR)"
mkdir -p "$MODELS_DIR"
# First install: start from the models shipped in the repo; afterwards the weekly retrain owns them.
[ -n "$(ls -A "$MODELS_DIR" 2>/dev/null)" ] || cp "$APP_DIR"/models/predictor/*.json "$MODELS_DIR"/
# Код принадлежит root: root запускает из этой папки скрипты обновления, поэтому сервис
# (если его взломают) не должен иметь права их менять. Писать сайт может только в кэши и данные.
chown -R root:root "$APP_DIR"
mkdir -p "$APP_DIR/.cache" "$APP_DIR/data"
chown -R "$APP:$APP" "$APP_DIR/.next" "$APP_DIR/.cache" "$APP_DIR/data" "$DATA_DIR"
chown root:"$APP" "$ENV_FILE"

# ---------------------------------------------------------------------------
say "Сервис systemd"
VPN_DEPS=""
[ -n "$VPN_SRC" ] && VPN_DEPS="Requires=$APP-vpn-route.service
After=$APP-vpn-route.service"
cat > /etc/systemd/system/$APP.service <<UNIT
[Unit]
Description=CryptoAnalysis (Next.js) on port $PORT
After=network-online.target mariadb.service mysql.service
Wants=network-online.target
$VPN_DEPS

[Service]
User=$APP
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
ExecStart=$NODE_DIR/bin/node $APP_DIR/node_modules/next/dist/bin/next start -p $PORT -H $BIND
Restart=always
RestartSec=5
TimeoutStopSec=20
MemoryMax=700M

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/$APP-train.service <<UNIT
[Unit]
Description=CryptoAnalysis: переобучение модели прогнозов
$VPN_DEPS

[Service]
Nice=10
MemoryMax=700M
# после переобучения сайт перечитывает модели
ExecStartPost=+/bin/systemctl try-restart $APP.service
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

UFW=0
command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active" && UFW=1

if [ "$USE_CADDY" = 1 ]; then
  say "Caddy: https://$(env_get PUBLIC_HOST):$(env_get PUBLIC_PORT)"
  HASH=$(caddy hash-password --plaintext "$(env_get SITE_PASSWORD)")
  BEGIN="# >>> $APP (управляется deploy/install.sh) >>>"
  END="# <<< $APP <<<"
  cp "$CADDYFILE" "$CADDYFILE.bak-$APP"
  # Убираем прежний блок (и старый блок ручной установки '# --- cryptoanalysis ---', он стоял в конце файла)
  awk -v b="$BEGIN" -v e="$END" '
    $0 == b {skip=1; next}
    $0 == e {skip=0; next}
    $0 == "# --- cryptoanalysis ---" {legacy=1}
    !skip && !legacy' "$CADDYFILE.bak-$APP" > "$CADDYFILE"
  cat >> "$CADDYFILE" <<EOF
$BEGIN
https://$(env_get PUBLIC_HOST):$(env_get PUBLIC_PORT) {
	tls {
		issuer acme {
			profile shortlived
		}
	}
	encode zstd gzip
	basic_auth {
		$(env_get SITE_USER) $HASH
	}
	reverse_proxy 127.0.0.1:$PORT
}
$END
EOF
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    ok "Caddy обновлён"
  else
    cp "$CADDYFILE.bak-$APP" "$CADDYFILE"
    die "новый Caddyfile не прошёл проверку — возвращён прежний"
  fi
  if [ "$UFW" = 1 ]; then
    ufw allow "$(env_get PUBLIC_PORT)/tcp" >/dev/null
    ufw delete allow "$PORT/tcp" >/dev/null 2>&1 || true
    ok "ufw: открыт $(env_get PUBLIC_PORT), порт $PORT закрыт снаружи"
  fi
elif [ "$UFW" = 1 ]; then
  ufw allow "$PORT/tcp" >/dev/null && ok "порт $PORT открыт в ufw"
fi

# ---------------------------------------------------------------------------
# Автопубликация из GitHub заходит как пользователь deploy, которому разрешено ровно одно:
# запустить обновление сайта из main. Ключ в authorized_keys привязывается к этой команде.
say "Доступ для автопубликации (пользователь deploy)"
DEPLOY_USER=deploy
DEPLOY_HOME=/var/lib/$APP-deploy
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$DEPLOY_HOME" --shell /bin/sh "$DEPLOY_USER"
cat > /usr/local/sbin/$APP-deploy <<EOF
#!/bin/bash
# Вызывается по SSH от GitHub Actions (через sudo). На stdin может прийти одна строка
# OPENROUTER_API_KEY=... — ключ из секрета GitHub.
set -euo pipefail
line=""
IFS= read -r line || true
case "\$line" in OPENROUTER_API_KEY=?*) export OPENROUTER_API_KEY="\${line#OPENROUTER_API_KEY=}" ;; esac
exec bash $APP_DIR/deploy/update.sh
EOF
chmod 755 /usr/local/sbin/$APP-deploy
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/sbin/$APP-deploy" > /etc/sudoers.d/$APP-deploy
chmod 440 /etc/sudoers.d/$APP-deploy
visudo -cf /etc/sudoers.d/$APP-deploy >/dev/null || { rm -f /etc/sudoers.d/$APP-deploy; die "ошибка в sudoers"; }
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
AK="$DEPLOY_HOME/.ssh/authorized_keys"
touch "$AK"
FORCED="command=\"sudo /usr/local/sbin/$APP-deploy\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty"
# любая строка ключа без ограничения получает принудительную команду
sed -i -E "/^(ssh-|ecdsa-|sk-)/s|^|$FORCED |" "$AK"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AK"
chmod 600 "$AK"
ok "ключей автопубликации: $(grep -c . "$AK" || true)"

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

if [ "$USE_CADDY" = 1 ]; then
  URL="https://$(env_get PUBLIC_HOST):$(env_get PUBLIC_PORT)"
  LOGIN="  Вход на сайт:    логин $(env_get SITE_USER), пароль SITE_PASSWORD в $ENV_FILE"
else
  URL="http://$MAIN_SRC:$PORT"
  LOGIN=""
fi
cat <<DONE

$(printf '\033[1;32m')Готово!$(printf '\033[0m')
  Сайт:            $URL
$LOGIN
  Админка:         $URL/admin  (пароль: ADMIN_SECRET в $ENV_FILE)
  Логи:            journalctl -u $APP -f
  Перезапуск:      systemctl restart $APP
  Переобучение:    journalctl -u $APP-train -f   (идёт сейчас, дальше — по воскресеньям)
  Обновление:      bash $APP_DIR/deploy/update.sh   (или автоматически после каждого изменения в main)
DONE

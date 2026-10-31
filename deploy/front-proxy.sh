#!/usr/bin/env bash
# Turn this server into the public entrance of a site that runs on another server (the backend).
#
#   bash deploy/front-proxy.sh <backend-ip> <backend-port> <backend-ca.crt>
#
# Visitors keep the same address (https://PUBLIC_HOST:PUBLIC_PORT from this server's .env); Caddy
# forwards to https://<backend-ip>:<backend-port>, checking the backend's certificate against
# <backend-ca.crt> (the root of the backend Caddy's internal CA), and passes the visitor's address in
# X-Real-IP. The backend accepts only this server (see FRONT_PROXY_IP in deploy/install.sh).
#
# The local copy of the site stops: its service and timers are disabled, its files and database stay
# as a backup until removed by hand.
set -euo pipefail

APP=cryptoanalysis
APP_DIR=/opt/$APP
ENV_FILE=$APP_DIR/.env
CADDYFILE=/etc/caddy/Caddyfile
CA=/etc/caddy/$APP-backend-ca.crt

[ "$(id -u)" = 0 ] || { echo "запустите от root" >&2; exit 1; }
BACKEND_IP=${1:?адрес сервера, где работает сайт}
BACKEND_PORT=${2:?порт Caddy на нём}
BACKEND_CA=${3:?файл корневого сертификата его Caddy}

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }
HOST=$(env_get PUBLIC_HOST)
PORT=$(env_get PUBLIC_PORT)
[ -n "$HOST" ] && [ -n "$PORT" ] || { echo "в $ENV_FILE нет PUBLIC_HOST/PUBLIC_PORT" >&2; exit 1; }

install -m 644 "$BACKEND_CA" "$CA"
# Before switching: the backend must answer through the pinned certificate.
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' --cacert "$CA" --resolve "$APP.internal:$BACKEND_PORT:$BACKEND_IP" "https://$APP.internal:$BACKEND_PORT/login" || true)
[ "$code" = 200 ] || { echo "сайт на $BACKEND_IP:$BACKEND_PORT не отвечает (HTTP $code) — ничего не меняю" >&2; exit 1; }

BEGIN="# >>> $APP (управляется deploy/install.sh) >>>"
END="# <<< $APP <<<"
cp "$CADDYFILE" "$CADDYFILE.bak-$APP-front"
awk -v b="$BEGIN" -v e="$END" '$0 == b {skip=1; next} $0 == e {skip=0; next} !skip' "$CADDYFILE.bak-$APP-front" > "$CADDYFILE"
cat >> "$CADDYFILE" <<EOF
$BEGIN
https://$HOST:$PORT {
	tls {
		issuer acme {
			profile shortlived
		}
	}
	encode zstd gzip
	reverse_proxy https://$BACKEND_IP:$BACKEND_PORT {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
		transport http {
			tls_trust_pool file $CA
			tls_server_name $APP.internal
		}
	}
}
$END
EOF
if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  cp "$CADDYFILE.bak-$APP-front" "$CADDYFILE"
  echo "новый Caddyfile не прошёл проверку — возвращён прежний" >&2
  exit 1
fi
systemctl reload caddy
echo "==> https://$HOST:$PORT теперь ведёт на $BACKEND_IP:$BACKEND_PORT"

# The local copy stops so that only one bot, scanner and collector run.
for unit in $APP.service $APP-market-data.timer $APP-models-sync.timer; do
  systemctl disable --now "$unit" >/dev/null 2>&1 || true
done
echo "==> локальная копия сайта остановлена (файлы и база остались как резервная копия)"

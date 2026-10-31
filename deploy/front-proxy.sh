#!/usr/bin/env bash
# Turn this server into the public entrance of a site that runs on another server (the backend).
#
#   bash deploy/front-proxy.sh <backend-ip> <backend-port> <backend-ca.crt>
#
# Visitors keep the same address (https://PUBLIC_HOST:PUBLIC_PORT from this server's .env) and, if
# PUBLIC_DOMAIN is set there, also https://PUBLIC_DOMAIN on the standard port with its own certificate.
# Caddy forwards to https://<backend-ip>:<backend-port> under the name cryptoanalysis.internal (the
# backend's Caddy picks its site by that name), checking the backend's certificate against
# <backend-ca.crt> (the root of the backend Caddy's internal CA), and passes the visitor's address in
# X-Real-IP and the site's own name in X-Forwarded-Host. The backend accepts only this server
# (see FRONT_PROXY_IP in deploy/install.sh).
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
DOMAIN=$(env_get PUBLIC_DOMAIN || true)
[ -n "$HOST" ] && [ -n "$PORT" ] || { echo "в $ENV_FILE нет PUBLIC_HOST/PUBLIC_PORT" >&2; exit 1; }

install -m 644 "$BACKEND_CA" "$CA"
# Before switching: the backend must serve the login page through the pinned certificate, with the
# headers this proxy will send (an empty 200 means its Caddy found no site for the request).
read -r code size < <(curl -s -o /dev/null -m 15 -w '%{http_code} %{size_download}
' --cacert "$CA"   --resolve "$APP.internal:$BACKEND_PORT:$BACKEND_IP" -H "X-Forwarded-Host: $HOST:$PORT"   "https://$APP.internal:$BACKEND_PORT/login" || echo "000 0")
[ "$code" = 200 ] && [ "${size:-0}" -gt 1000 ]   || { echo "сайт на $BACKEND_IP:$BACKEND_PORT не отдаёт страницу входа (HTTP $code, $size байт) — ничего не меняю" >&2; exit 1; }

BEGIN="# >>> $APP (управляется deploy/install.sh) >>>"
END="# <<< $APP <<<"
cp "$CADDYFILE" "$CADDYFILE.bak-$APP-front"
awk -v b="$BEGIN" -v e="$END" '$0 == b {skip=1; next} $0 == e {skip=0; next} !skip' "$CADDYFILE.bak-$APP-front" > "$CADDYFILE"
proxy() {
	cat <<EOF
	encode zstd gzip
	reverse_proxy https://$BACKEND_IP:$BACKEND_PORT {
		header_up Host $APP.internal
		header_up X-Forwarded-Host {hostport}
		header_up X-Real-IP {remote_host}
		transport http {
			tls_trust_pool file $CA
			tls_server_name $APP.internal
		}
	}
EOF
}
{
	echo "$BEGIN"
	printf 'https://%s:%s {
	tls {
		issuer acme {
			profile shortlived
		}
	}
' "$HOST" "$PORT"
	proxy
	echo "}"
	if [ -n "$DOMAIN" ]; then
		echo "$DOMAIN {"
		proxy
		echo "}"
	fi
	echo "$END"
} >> "$CADDYFILE"
if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  cp "$CADDYFILE.bak-$APP-front" "$CADDYFILE"
  echo "новый Caddyfile не прошёл проверку — возвращён прежний" >&2
  exit 1
fi
systemctl reload caddy
echo "==> https://$HOST:$PORT${DOMAIN:+ и https://$DOMAIN} теперь ведут на $BACKEND_IP:$BACKEND_PORT"

# The local copy stops so that only one bot, scanner and collector run.
for unit in $APP.service $APP-market-data.timer $APP-models-sync.timer; do
  systemctl disable --now "$unit" >/dev/null 2>&1 || true
done
echo "==> локальная копия сайта остановлена (файлы и база остались как резервная копия)"

#!/usr/bin/env bash
# Bring /opt/cryptoanalysis to the latest main and (re)install. Works for the first install too;
# .env, node_modules and server-trained models are kept.
#
#   bash deploy/update.sh            # on the server, or piped over SSH by the GitHub deploy workflow
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/cryptoanalysis}
REPO=${REPO:-https://github.com/HVZEweb/CryptoAnalysis.git}
BRANCH=${BRANCH:-main}

[ "$(id -u)" = 0 ] || { echo "запустите от root" >&2; exit 1; }
if ! command -v git >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null
fi
# The checkout is owned by the service user; let root operate on it.
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" \
  || git config --global --add safe.directory "$APP_DIR"

mkdir -p "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" init -q
  git -C "$APP_DIR" remote add origin "$REPO"
fi
# Always the explicit URL, never whatever remote .git/config happens to name.
git -C "$APP_DIR" fetch -q --depth 1 "$REPO" "$BRANCH"
git -C "$APP_DIR" reset -q --hard FETCH_HEAD
echo "==> код обновлён до $(git -C "$APP_DIR" log -1 --format='%h %s')"

# Files that aren't in the repo (e.g. an old copy unpacked into a subfolder) break the build.
# Move them aside rather than delete; .env, node_modules and other ignored files stay.
stray=$(git -C "$APP_DIR" ls-files --others --exclude-standard --directory)
if [ -n "$stray" ]; then
  backup="/opt/$(basename "$APP_DIR")-stray-$(date +%Y%m%d-%H%M%S)"
  while IFS= read -r p; do
    p="${p%/}"
    mkdir -p "$backup/$(dirname "$p")"
    mv "$APP_DIR/$p" "$backup/$p"
  done <<< "$stray"
  echo "==> лишние файлы ($(wc -l <<< "$stray") шт.) перенесены в $backup"
fi

bash "$APP_DIR/deploy/install.sh" < /dev/null

#!/usr/bin/env bash
# Weekly off-server copy of the site's database, kept on the front server.
#
#   bash deploy/front-backup.sh <backend-ip>
#
# Creates this server's own key (/root/.ssh/cryptoanalysis-backup) if there is none and prints its public
# half: put it on the backend as BACKUP_PULL_KEY in .env and rerun its installer. The backend lets that key
# do exactly one thing — print the latest daily dump (user cabackup, see deploy/install.sh). A timer here
# fetches it every Sunday into /var/backups/cryptoanalysis and keeps the newest 8.
set -euo pipefail

APP=cryptoanalysis
BACKEND_IP=${1:?адрес сервера, где работает сайт}
KEY=/root/.ssh/$APP-backup
DIR=/var/backups/$APP

[ "$(id -u)" = 0 ] || { echo "запустите от root" >&2; exit 1; }
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "$APP-backup@$(hostname)" -f "$KEY"
install -d -m 700 "$DIR"

cat > /usr/local/sbin/$APP-backup-pull <<SCRIPT
#!/bin/bash
set -euo pipefail
out="$DIR/weekly-\$(date -u +%Y%m%d).sql.gz"
ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new cabackup@$BACKEND_IP > "\$out.part"
gzip -t "\$out.part" && zcat "\$out.part" | tail -1 | grep -q "Dump completed" || { rm -f "\$out.part"; echo "копия повреждена" >&2; exit 1; }
mv "\$out.part" "\$out" && chmod 600 "\$out"
ls -1t "$DIR"/weekly-*.sql.gz | tail -n +9 | xargs -r rm -f
echo "копия \$out (\$(du -h "\$out" | cut -f1))"
SCRIPT
chmod 700 /usr/local/sbin/$APP-backup-pull

cat > /etc/systemd/system/$APP-backup-pull.service <<UNIT
[Unit]
Description=CryptoAnalysis: недельная копия базы с основного сервера
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/$APP-backup-pull
UNIT
cat > /etc/systemd/system/$APP-backup-pull.timer <<UNIT
[Unit]
Description=CryptoAnalysis: недельная копия базы по воскресеньям

[Timer]
OnCalendar=Sun *-*-* 04:30
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now $APP-backup-pull.timer >/dev/null

echo "==> таймер $APP-backup-pull включён (воскресенье 04:30, копии в $DIR)"
echo "==> открытый ключ для BACKUP_PULL_KEY на основном сервере:"
cat "$KEY.pub"

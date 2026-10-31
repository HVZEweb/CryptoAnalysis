#!/usr/bin/env bash
# Daily database backup on the server that runs the site (installed as /usr/local/sbin/cryptoanalysis-backup
# by deploy/install.sh, timer cryptoanalysis-backup.timer).
#
# A consistent dump (single transaction, no locks) goes to /opt/cryptoanalysis-data/backups as
# db-YYYYmmdd-HHMM.sql.gz; the newest 14 are kept and latest.sql.gz points to the newest. The front server
# copies latest.sql.gz once a week (deploy/front-proxy.sh), so one disk failure loses at most a week.
set -euo pipefail

DIR=/opt/cryptoanalysis-data/backups
KEEP=14
mkdir -p "$DIR"
chmod 750 "$DIR"

stamp=$(date -u +%Y%m%d-%H%M)
tmp="$DIR/.db-$stamp.sql.gz.part"
mysqldump --single-transaction --quick --routines --default-character-set=utf8mb4 cryptoanalysis | gzip -6 > "$tmp"
# A dump that ends without mysqldump's completion line is broken: keep the previous ones.
zcat "$tmp" | tail -1 | grep -q "Dump completed" || { rm -f "$tmp"; echo "дамп не завершён" >&2; exit 1; }
mv "$tmp" "$DIR/db-$stamp.sql.gz"
ln -sfn "db-$stamp.sql.gz" "$DIR/latest.sql.gz"
chmod 640 "$DIR/db-$stamp.sql.gz"
# The weekly copy is pulled by the cabackup user (see deploy/install.sh), if it exists.
id -u cabackup >/dev/null 2>&1 && chgrp cabackup "$DIR" "$DIR/db-$stamp.sql.gz"

ls -1t "$DIR"/db-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "резервная копия $DIR/db-$stamp.sql.gz ($(du -h "$DIR/db-$stamp.sql.gz" | cut -f1)), хранится $(ls -1 "$DIR"/db-*.sql.gz | wc -l)"

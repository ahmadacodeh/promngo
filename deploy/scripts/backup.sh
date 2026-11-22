#!/usr/bin/env sh
# نسخة احتياطية: قاعدة البيانات (pg_dump بصيغة custom) + مرفقات التسليم، في deploy/backups/<التاريخ>.
# جدوِله يوميًا (cron على الخادم) وانقل الملفات خارج الخادم.
set -eu
cd "$(dirname "$0")/.."
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR=backups/$STAMP
mkdir -p "$DIR" && chmod 700 backups "$DIR"
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d promango -Fc' > "$DIR/db.dump"
docker compose -f docker-compose.prod.yml exec -T api tar -C /data -czf - uploads > "$DIR/uploads.tgz"
( cd "$DIR" && sha256sum db.dump uploads.tgz > SHA256SUMS )
test -s "$DIR/db.dump" || { echo "فشل: ملف القاعدة فارغ"; exit 1; }
echo "تمت النسخة: $DIR"
# الاحتفاظ بآخر 14 نسخة محليًا
ls -1d backups/*/ 2>/dev/null | sort | head -n -14 | xargs -r rm -rf

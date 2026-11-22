#!/usr/bin/env sh
# استعادة نسخة: ./scripts/restore.sh backups/<التاريخ>
# تحذير: يستبدل محتوى القاعدة والمرفقات الحاليين. أوقف المستخدمين قبلها.
set -eu
cd "$(dirname "$0")/.."
DIR=${1:?الاستخدام: restore.sh backups/<التاريخ>}
( cd "$DIR" && sha256sum -c SHA256SUMS )
C="docker compose -f docker-compose.prod.yml"
$C stop api
$C exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d promango --clean --if-exists --no-owner' < "$DIR/db.dump"
$C run --rm --no-deps --entrypoint sh api -c 'rm -rf /data/uploads/* && tar -C /data -xzf -' < "$DIR/uploads.tgz"
$C start api
echo "تمت الاستعادة من $DIR"

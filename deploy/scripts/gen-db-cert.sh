#!/usr/bin/env sh
# يولّد CA خاصًّا وشهادة لخادم PostgreSQL (اسم المضيف: db) في deploy/secrets/db.
# يُشغَّل مرة واحدة قبل أول نشر. الخادم يتحقق من الشهادة (DATABASE_SSL=true + CA).
set -eu
cd "$(dirname "$0")/.."
OUT=secrets/db
if [ -f "$OUT/server.key" ]; then echo "الشهادات موجودة في $OUT (احذفها يدويًا لإعادة التوليد)."; exit 0; fi
mkdir -p "$OUT" && chmod 700 secrets "$OUT"
openssl req -new -x509 -days 3650 -nodes -subj "/CN=promango-db-ca" -keyout "$OUT/ca.key" -out "$OUT/ca.crt" 2>/dev/null
openssl req -new -nodes -subj "/CN=db" -keyout "$OUT/server.key" -out "$OUT/server.csr" 2>/dev/null
printf 'subjectAltName=DNS:db\nextendedKeyUsage=serverAuth\n' > "$OUT/ext.cnf"
openssl x509 -req -days 825 -in "$OUT/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" -CAcreateserial -extfile "$OUT/ext.cnf" -out "$OUT/server.crt" 2>/dev/null
rm -f "$OUT/server.csr" "$OUT/ext.cnf" "$OUT/ca.srl"
chmod 600 "$OUT"/*.key
echo "تم: $OUT/{ca.crt,server.crt,server.key}. احفظ ca.key خارج الخادم أو احذفه."

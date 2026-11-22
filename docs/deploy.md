# النشر والتشغيل (T13 + T14 + T21)

> الحالة 2026-11-22. ما هو **مُتحقَّق** وما **ينتظر** مذكور صراحة في كل قسم.

## 1. الشكل المعتمد
خادم واحد (VPS، Linux، Docker + Docker Compose v2) يشغّل ثلاث حاويات على شبكة داخلية:

| الحاوية | الصورة | الدور |
|---|---|---|
| `db` | `postgres:16.6` | قاعدة البيانات. **TLS إلزامي** (الخادم يرفض `DATABASE_SSL=false` في الإنتاج) بشهادة من CA خاص، والتحقق كامل (`DATABASE_SSL=true` + CA). غير مكشوفة للخارج. |
| `api` | `apps/api/Dockerfile` | NestJS. مستخدم غير جذري، يطبّق الـ migrations قبل الإقلاع في كل نشر، فحص صحة على `/health`. المرفقات في volume `uploads`. |
| `web` | `apps/web/Dockerfile` | Caddy: يقدّم بناء Vue، ويمرّر `/api/*` إلى `api:3000` (بلا CORS)، وشهادة Let's Encrypt تلقائية، وترويسات أمان (HSTS، CSP، منع التأطير). المنفذان 80/443 فقط. |

## 2. أول نشر
```sh
git clone https://github.com/ahmadacodeh/promngo.git && cd promngo/deploy
cp .env.example .env            # املأ النطاق والبريد وكلمة مرور القاعدة و3 أسرار: openssl rand -hex 32
./scripts/gen-db-cert.sh        # CA + شهادة PostgreSQL في deploy/secrets/db (احفظ ca.key خارج الخادم)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps   # الثلاثة healthy
```
شرط مسبق: سجل DNS من نوع A للنطاق يشير إلى الخادم، والمنفذان 80 و443 مفتوحان.

## 3. إنشاء شركة (T21 — قرار المالك: أمر المشغّل)
لا تسجيل ذاتي في الواجهة. المشغّل ينشئ كل شركة وأول مدير تنفيذي لها:
```sh
docker compose -f docker-compose.prod.yml exec api \
  node dist/database/ops/company-create.js --name "شركة النور" --slug al-noor \
  --admin-name "سارة أحمد" --admin-email sara@alnoor.example
```
- يطبع كلمة مرور مؤقتة **مرة واحدة**؛ سلّمها للمدير بقناة آمنة. عند أول دخول يُلزم بتغييرها.
- معاملة واحدة: الشركة + المدير + تجزئة كلمة المرور داخل PostgreSQL + حدث تدقيق `COMPANY_CREATED` (الفاعل فارغ والمصدر `operator-cli`).
- رموز الخروج: `0` نجاح، `2` مدخلات غير صالحة (تُطبع كل المشكلات معًا)، `3` تعارض (slug أو بريد مستخدم؛ لا تبقى شركة يتيمة)، `1` غير ذلك.
- محليًا (تطوير): `cd apps/api && npm run build && npm run company:create -- --name … --slug … --admin-name … --admin-email …`.

## 4. التحديث
```sh
git pull && cd deploy && docker compose -f docker-compose.prod.yml up -d --build
```
الـ migrations تُطبَّق تلقائيًا عند إقلاع `api` (لا تعيد ما طُبّق). خذ نسخة احتياطية قبل أي تحديث فيه migration جديدة.

## 5. النسخ الاحتياطي والاستعادة
- `./scripts/backup.sh` ← `deploy/backups/<UTC>/{db.dump,uploads.tgz,SHA256SUMS}`؛ يحتفظ بآخر 14 محليًا. جدوله يوميًا: `17 3 * * * cd /path/promngo/deploy && ./scripts/backup.sh` وانقل النسخ خارج الخادم.
- `./scripts/restore.sh backups/<UTC>` ← يتحقق من البصمات، يوقف `api`، يستعيد القاعدة (`pg_restore --clean`) والمرفقات، ثم يعيد التشغيل.
- جرّب الاستعادة على خادم آخر مرة شهريًا: النسخة التي لم تُستعد لا يُعتمد عليها.

## 6. CI (`.github/workflows/`)
| سير العمل | متى | ما يفعل |
|---|---|---|
| `ci.yml` | كل دفع إلى main وكل طلب دمج | الخادم `npm run verify` على PostgreSQL 16 حقيقي · الواجهة `npm run verify` · Playwright (سطح مكتب + جوال) على API حقيقي بعد migrations وseed · بناء صورتي Docker والتحقق من Caddyfile وcompose وأن الصورة لا تعمل بالجذر ولا تحوي `.env` |
| `mutation.yml` | أسبوعيًا (الاثنين) وعند الطلب | `npm run mutation:b2` (52 طفرة) |

لا أسرار مخزّنة في GitHub: أسرار JWT وكلمة مرور seed تُولَّد عشوائيًا لكل تشغيل وتُخفى من السجل.

## 7. ما تحقّق فعليًا وما ينتظر
**مُتحقَّق في بيئة العمل (2026-11-22):**
- الخادم بإعدادات الإنتاج الحرفية (`NODE_ENV=production`، `TRUST_PROXY=1`، أسرار عشوائية، بلا `.env`) على عنقود PostgreSQL 16 يقبل **TLS فقط** (`hostssl`) بالشهادات التي يولّدها `gen-db-cert.sh`: رفض `DATABASE_SSL=false`، الاتصال غير المشفّر مرفوض، migrations من الصفر، `company:create`، `/health` = `{"status":"ok","db":"up"}`، الدخول بالكلمة المؤقتة مع إلزام التغيير، وكل اتصالات الخادم بالقاعدة مشفّرة (TLSv1.3) مع تحقق كامل من الشهادة واسم المضيف `db`.
- دورة `pg_dump -Fc` ← حذف ← `pg_restore --clean --if-exists` تعيد البيانات (الأوامر نفسها في السكربتين).
- `docker compose config` صالح، وYAML لسير العمل صالح، و`npm run verify` للخادم ينجح بلا `.env` (كما في CI).

**لم يُتحقَّق هنا (بيئة العمل تحجب Docker Hub):** بناء الصورتين وتشغيل الحاويات وصياغة Caddyfile — مهمة `docker` في CI تتحقق منها على GitHub. **وينتظر قرار المالك:** مزوّد الاستضافة والنطاق (لا خادم حقيقي بعد)، وجدولة النسخ خارج الخادم.

# PROMANGO API (NestJS + TypeORM + PostgreSQL)

## التشغيل المحلي
```bash
service postgresql start                 # Linux/WSL؛ على Windows: خدمة PostgreSQL
cp .env.example .env                     # ثم ضع الأسرار (openssl rand -hex 32 لكل سر)
npm install                              # إن فشل npm 10 (edgesOut): npx --yes npm@11 install
npm run build
npm run migration:run                    # من قاعدة نظيفة
npm run start:dev                        # http://localhost:3000/health
```
`DATABASE_URL` لقاعدة التطوير، و`TEST_DATABASE_URL` لقاعدة اسمها ينتهي بـ `_test`. الخادم يرفض الإقلاع إن غابت الأسرار أو ضعفت.

## بيانات التطوير والمرفقات
```bash
SEED_PASSWORD='<كلمة مرور قوية>' npm run seed:dev            # شركتان × (6 مستخدمين + 3 مشاريع + 15 مهمة) بتسليمات ومراجعات ومرفقات حقيقية
SEED_PASSWORD='<...>' npm run seed:dev -- --reset            # يعيد بناء شركتي seed فقط (ويحذف ملفاتهما) ولا يمس غيرهما
```
بلا `SEED_PASSWORD` تُولَّد كلمة عشوائية وتُطبع مرة واحدة. الأمر يرفض `NODE_ENV=production`. مرفقات التسليم تُخزَّن تحت `UPLOAD_DIR` (الافتراضي `./storage/uploads`، مستثنى من Git)؛ يجب أن يكون المجلد قابلًا للكتابة لمستخدم الخادم، وللنسخ الاحتياطي معه مع قاعدة البيانات (انظر T18 في `docs/backlog.md` للمرفقات اليتيمة).

## البنية
- `src/app.module.ts` جذر الوحدات؛ `src/app.factory.ts` (`createApp`) يضبط helmet/CORS/pipes/filter ويُستخدم في `main.ts` والاختبارات بالإعداد نفسه.
- `src/auth` المصادقة والجلسات وحد المحاولات؛ `src/common` الحراس (`JwtAuthGuard` ثم `RolesGuard` عامان)، المرشح، التحقق، الرسائل العربية؛ `src/database` الـ migrations.
- الأخطاء: `ApiException(status, CODE, { details, fields })` والرسائل في `src/common/messages.ts` (عربية: السبب + طريقة الإصلاح).

## Extending: إضافة وحدة جديدة
1. `src/<name>/<name>.module.ts` + controller/service/dto، وأضفها إلى `imports` في `app.module.ts`.
2. كل مسار محمي افتراضيًا. `@Public()` للمفتوح، `@Roles(...)` للأدوار، `@AllowDuringPasswordChange()` نادرًا.
3. الشركة من `@CurrentUser().companyId` دائمًا، لا من الجسم. مورد شركة أخرى ⇒ `404 NOT_FOUND`.
4. تغيير المخطط: `npm run migration:create` ثم أضف الفئة إلى `MIGRATIONS` في `src/database/data-source.ts` (ترتيب زمني). لا `synchronize`.
5. أضف اختبار E2E في `test/e2e` (استخدم `twoCompanyFixture` لاختبار العزل) ثم `npm run verify`.

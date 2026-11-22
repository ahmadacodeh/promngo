# PROMANGO — SESSION HANDOFF

**آخر تحديث:** 2026-11-22 · **المشروع:** `/home/claude/PROMANGO` (قد تُمسح البيئة؛ النسخة المرسلة للمالك هي المرجع الاحتياطي).

## اقرأ أولًا
**`docs/NEXT_SESSION_PROMPT.md` (خطة الإكمال والإطلاق)** · `PROGRESS.md` · `PROMANGO_REQUIREMENTS_AR.md` (لا يُعدَّل) · `docs/decisions.md` · `docs/api-contract.md` (المرجع المشترك) · `docs/phase-j-audit.md` · `design/brand/identity.md`.

## الحالة
- `apps/api`: أساس + مصادقة + مستخدمون/شركة/تخصصات + **B2 كاملًا (مشاريع، مهام، اعتماديات، تسليم، مراجعة، تدقيق، لوحة قيادة، تقارير)** + seed بالمشاريع والمهام، مُختبرة (`cd apps/api && npm run verify` → **93 وحدة + 238 E2E**؛ و`npm run mutation:b2` → 52/52 طفرة قُتلت). النسبة المُتحقَّقة **68.07٪** (`docs/PROMANGO_progress.xlsx`).
- `apps/web`: J2/J3 + **J4-أ (شاشة `/users`)** منجزة (`cd apps/web && npm run verify` → typecheck×3 + lint + 125 اختبارًا + بناء). E2E: `SEED_PASSWORD=… E2E_DATABASE_URL=… npm run e2e` → 62 ناجحًا؛ ومع `E2E_DATABASE_URL` تُنظَّف مستخدمو `e2e-*` تلقائيًا (انظر `docs/testing.md`).
- PostgreSQL 16 يتوقف بعد كل إعادة تشغيل للبيئة: `service postgresql start` ثم `cd apps/api && npm run build && node dist/main.js` (المنفذ 3000) ثم `npm run dev` في الواجهة. القاعدتان `promango_dev` و`promango_test` (دور `promango_app`)؛ `.env` في `apps/api` سري لا يُطبع.
- npm 10 قد يفشل ← `npx --yes npm@11 install`. Figma MCP محدود (Starter): الهوية من `design/brand/identity.md`.
- الوكلاء الفرعيون يقطعهم حد الاستخدام: العمل المباشر أنجح.
- **قائمة الحل الكاملة:** `docs/backlog.md` (مشاكل P1–P23، مهام T1–T21، قرارات المالك 1–10).
- `seed:dev --reset` مُطبَّق على `promango_dev` (3 مشاريع و15 مهمة لكل شركة)؛ أعد تطبيقه بـ`SEED_PASSWORD=… npm run seed:dev -- --reset` (يغيّر كلمة مرور حسابات seed؛ استعمل القيمة نفسها لـ Playwright). لا تضع كلمة المرور في أي ملف.

## الخطوات المتبقية بالترتيب (التفصيل في `docs/NEXT_SESSION_PROMPT.md`)
1. J4 (المتبقي): **صفحة الشركة** (T17)، لوحات الأدوار الأربع، قائمة المشاريع وتفاصيلها — الـ API جاهز كله (المستخدمون منجزة ✅). حدّث `src/api/types.ts` بحقول B2 (priority, dueDate, isOverdue, needsReview, can, allowedNext…) قبل المهام.
2. J5–J8: المهام (فرز/فلترة بالأولوية والتأخر)، تفاصيل المهمة والفرعية والاعتماديات، التسليم والمراجعة، التقارير والتدقيق + Playwright لكل رحلة.
4. T3 الاشتراكات (بعد قرار الأسعار والدفع) وT21 مسار إنشاء الشركات (عائق إطلاق).
5. أمن وإطلاق: T8، T10، T18، P7، P18؛ ثم T13 (CI/نسخ احتياطي) وT14 (استضافة/TLS) وقائمة الإطلاق في البرومت.

## Next exact action
اقرأ `docs/NEXT_SESSION_PROMPT.md` ثم شغّل `npm run verify` في `apps/api` و`apps/web`، وابدأ بصفحة الشركة `/company` (قراءة/تعديل `GET/PATCH /companies/current`، للمدير التنفيذي) على نمط `src/features/users/` (ملف `routes.ts` يُلتقط تلقائيًا بـ `import.meta.glob`، ونمط الاختبارات في `UsersView.test.ts` و`e2e/users.spec.ts`)، ثم لوحات الأدوار الأربع من `/dashboard`.

## نسخ احتياطية أُرسلت للمالك
_(يُسجَّل هنا اسم الملف وتاريخه عند كل إرسال.)_
- 2026-11-10: `PROMANGO_backup_2026-11-10_a.zip` (قديمة، قبل B1a)
- 2026-11-14: `PROMANGO_backup_2026-11-14_a.zip` (بعد B1a: 22 وحدة + 49 E2E ناجحة؛ بلا `.env` ولا node_modules)
- 2026-11-15: `PROMANGO_backup_2026-11-15_a.zip` (بعد B1b جزء 1 + J2/J3: خادم 24+70، واجهة 87+39؛ بلا `.env` ولا node_modules ولا dist)
- 2026-11-19: `PROMANGO_backup_2026-11-19_a.zip` (بعد B2 الخادم: 52 وحدة + 233 E2E؛ واجهة 87 وحدة؛ مع ملف التقدم 63.9٪ وبرومت المتابعة؛ بلا `.env` ولا node_modules ولا dist ولا storage)
- 2026-11-19: دُفع إلى GitHub (`ahmadacodeh/promngo`، فرع main) — commit `6a50518` ثم commit تصحيح الوثائق
- 2026-11-22: `PROMANGO_backup_2026-11-22_a.zip` (بعد T19/T20 وJ4-أ: خادم 93+238 وطفرات 52/52، واجهة 125+62 Playwright؛ ملف التقدم 68.07٪؛ بلا `.env` ولا node_modules ولا dist ولا storage)

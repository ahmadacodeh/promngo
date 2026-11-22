# PROMANGO — SESSION HANDOFF

**آخر تحديث:** 2026-11-22 · **المشروع:** `/home/claude/PROMANGO` (قد تُمسح البيئة؛ النسخة المرسلة للمالك هي المرجع الاحتياطي).

## اقرأ أولًا
**`docs/NEXT_SESSION_PROMPT.md` (خطة الإكمال والإطلاق)** · `PROGRESS.md` · `PROMANGO_REQUIREMENTS_AR.md` (لا يُعدَّل) · `docs/decisions.md` · `docs/api-contract.md` (المرجع المشترك) · `docs/phase-j-audit.md` · `design/brand/identity.md`.

## الحالة
- `apps/api`: أساس + مصادقة + مستخدمون/شركة/تخصصات + **B2 كاملًا (مشاريع، مهام، اعتماديات، تسليم، مراجعة، تدقيق، لوحة قيادة، تقارير)** + seed بالمشاريع والمهام، مُختبرة (`cd apps/api && npm run verify` → **93 وحدة + 238 E2E**؛ و`npm run mutation:b2` → 52/52 طفرة قُتلت). النسبة المُتحقَّقة **68.07٪** (`docs/PROMANGO_progress.xlsx`).
- `apps/web`: J1–J4 + قائمة المهام: المستخدمون، الشركة، اللوحات الأربع، المشاريع (قائمة/تفاصيل/إنشاء/انتقالات)، المهام بالأولوية (`cd apps/web && npm run verify` → typecheck×3 + lint + 149 اختبارًا + بناء). E2E: `SEED_PASSWORD=… E2E_DATABASE_URL=… npm run e2e` → 77 ناجحًا؛ التنظيف التلقائي يحذف مستخدمي `e2e-*` ومشاريع `E2E …`. **CI على GitHub أخضر**؛ النشر في `docs/deploy.md`؛ إنشاء شركة: `npm run company:create`.
- PostgreSQL 16 يتوقف بعد كل إعادة تشغيل للبيئة: `service postgresql start` ثم `cd apps/api && npm run build && node dist/main.js` (المنفذ 3000) ثم `npm run dev` في الواجهة. القاعدتان `promango_dev` و`promango_test` (دور `promango_app`)؛ `.env` في `apps/api` سري لا يُطبع.
- npm 10 قد يفشل ← `npx --yes npm@11 install`. Figma: `get_design_context` يعمل ويعيد اللقطة والقيم (الملف بلا متغيرات)؛ الصدفة لا تنزّل لقطات Figma (الوكيل يحجب)، وDocker Hub محجوب فلا تُبنى الصور محليًا (CI يبنيها).
- الوكلاء الفرعيون يقطعهم حد الاستخدام: العمل المباشر أنجح.
- **قائمة الحل الكاملة:** `docs/backlog.md` (مشاكل P1–P23، مهام T1–T26، قرارات المالك 1–10).
- `seed:dev --reset` مُطبَّق على `promango_dev` (3 مشاريع و15 مهمة لكل شركة)؛ أعد تطبيقه بـ`SEED_PASSWORD=… npm run seed:dev -- --reset` (يغيّر كلمة مرور حسابات seed؛ استعمل القيمة نفسها لـ Playwright). لا تضع كلمة المرور في أي ملف.

## الخطوات المتبقية بالترتيب (التفصيل في `docs/NEXT_SESSION_PROMPT.md`)
1. T23: تفاصيل المهمة `/tasks/:id` (اسم المسار `task-detail`) + إنشاء مهمة/فرعية، ثم T24 التسليم والمراجعة وسجلها.
2. J7–J8: التقارير، التدقيق، الاشتراكات (بعد T3)، الصقل وفحص axe (T16).
4. T3 الاشتراكات (بعد قرار الأسعار والدفع). ✅ T21 منجز (`company:create`).
5. أمن وإطلاق: T8، T10، T18، P7، P18، T25، T26؛ ✅ T13 (CI) وT14 (جاهزية الاستضافة) — يبقى خادم ونطاق حقيقيان (قرار المالك).

## Next exact action
اقرأ `docs/NEXT_SESSION_PROMPT.md` ثم شغّل `npm run verify` في `apps/api` و`apps/web`، وابدأ بصفحة الشركة `/company` (قراءة/تعديل `GET/PATCH /companies/current`، للمدير التنفيذي) على نمط `src/features/users/` (ملف `routes.ts` يُلتقط تلقائيًا بـ `import.meta.glob`، ونمط الاختبارات في `UsersView.test.ts` و`e2e/users.spec.ts`)، ثم لوحات الأدوار الأربع من `/dashboard`.

## نسخ احتياطية أُرسلت للمالك
_(يُسجَّل هنا اسم الملف وتاريخه عند كل إرسال.)_
- 2026-11-10: `PROMANGO_backup_2026-11-10_a.zip` (قديمة، قبل B1a)
- 2026-11-14: `PROMANGO_backup_2026-11-14_a.zip` (بعد B1a: 22 وحدة + 49 E2E ناجحة؛ بلا `.env` ولا node_modules)
- 2026-11-15: `PROMANGO_backup_2026-11-15_a.zip` (بعد B1b جزء 1 + J2/J3: خادم 24+70، واجهة 87+39؛ بلا `.env` ولا node_modules ولا dist)
- 2026-11-19: `PROMANGO_backup_2026-11-19_a.zip` (بعد B2 الخادم: 52 وحدة + 233 E2E؛ واجهة 87 وحدة؛ مع ملف التقدم 63.9٪ وبرومت المتابعة؛ بلا `.env` ولا node_modules ولا dist ولا storage)
- 2026-11-19: دُفع إلى GitHub (`ahmadacodeh/promngo`، فرع main) — commit `6a50518` ثم commit تصحيح الوثائق
- 2026-11-22: `PROMANGO_backup_2026-11-22_b.zip` (بعد T21 وCI والاستضافة وشاشات J4: خادم 93+242، واجهة 149+77 Playwright؛ ملف التقدم 74.06٪)
- 2026-11-22: `PROMANGO_backup_2026-11-22_a.zip` (بعد T19/T20 وJ4-أ: خادم 93+238 وطفرات 52/52، واجهة 125+62 Playwright؛ ملف التقدم 68.07٪؛ بلا `.env` ولا node_modules ولا dist ولا storage)

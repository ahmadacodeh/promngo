# PROMANGO — SESSION HANDOFF

**آخر تحديث:** 2026-11-19 · **المشروع:** `/home/claude/PROMANGO` (قد تُمسح البيئة؛ النسخة المرسلة للمالك هي المرجع الاحتياطي).

## اقرأ أولًا
**`docs/NEXT_SESSION_PROMPT.md` (خطة الإكمال والإطلاق)** · `PROGRESS.md` · `PROMANGO_REQUIREMENTS_AR.md` (لا يُعدَّل) · `docs/decisions.md` · `docs/api-contract.md` (المرجع المشترك) · `docs/phase-j-audit.md` · `design/brand/identity.md`.

## الحالة
- `apps/api`: أساس + مصادقة + مستخدمون/شركة/تخصصات + **B2 كاملًا (مشاريع، مهام، اعتماديات، تسليم، مراجعة، تدقيق، لوحة قيادة، تقارير)** + seed بالمشاريع والمهام، مُختبرة (`cd apps/api && npm run verify` → **52 وحدة + 233 E2E**). النسبة المُتحقَّقة 63.9٪ (`docs/PROMANGO_progress.xlsx`).
- `apps/web`: J2/J3 منجزان (`cd apps/web && npm run verify` → typecheck×3 + lint + 87 اختبارًا + بناء). E2E: `SEED_PASSWORD=… E2E_DATABASE_URL=… npm run e2e` (انظر `docs/testing.md`).
- PostgreSQL 16 يتوقف بعد كل إعادة تشغيل للبيئة: `service postgresql start` ثم `cd apps/api && npm run build && node dist/main.js` (المنفذ 3000) ثم `npm run dev` في الواجهة. القاعدتان `promango_dev` و`promango_test` (دور `promango_app`)؛ `.env` في `apps/api` سري لا يُطبع.
- npm 10 قد يفشل ← `npx --yes npm@11 install`. Figma MCP محدود (Starter): الهوية من `design/brand/identity.md`.
- الوكلاء الفرعيون يقطعهم حد الاستخدام: العمل المباشر أنجح.
- **قائمة الحل الكاملة:** `docs/backlog.md` (مشاكل P1–P23، مهام T1–T21، قرارات المالك 1–10).
- `seed:dev` لم يُطبَّق بعد على `promango_dev` بالبيانات الجديدة: `SEED_PASSWORD=… npm run seed:dev -- --reset` (يغيّر كلمة مرور حسابات seed؛ استعمل القيمة نفسها لـ Playwright).

## الخطوات المتبقية بالترتيب (التفصيل في `docs/NEXT_SESSION_PROMPT.md`)
1. J4: صفحات المستخدمين والشركة (T17)، لوحات الأدوار الأربع، المشاريع — الـ API جاهز كله.
2. J5–J8: المهام (فرز/فلترة بالأولوية والتأخر)، تفاصيل المهمة والفرعية والاعتماديات، التسليم والمراجعة، التقارير والتدقيق + Playwright لكل رحلة.
3. T19/T20: طفرات واختبارات وحدة لـ policy/model قبل البناء فوقها.
4. T3 الاشتراكات (بعد قرار الأسعار والدفع) وT21 مسار إنشاء الشركات (عائق إطلاق).
5. أمن وإطلاق: T8، T10، T18، P7، P18؛ ثم T13 (CI/نسخ احتياطي) وT14 (استضافة/TLS) وقائمة الإطلاق في البرومت.

## Next exact action
اقرأ `docs/NEXT_SESSION_PROMPT.md` ثم شغّل `npm run verify` في `apps/api` و`apps/web`، وابدأ بشاشة المستخدمين على `/users` للمدير التنفيذي (`src/features/users/routes.ts` يُلتقط تلقائيًا بـ `import.meta.glob`) مع اختبارات مكوّنات + E2E بالنمط نفسه في `apps/web/e2e`.

## نسخ احتياطية أُرسلت للمالك
_(يُسجَّل هنا اسم الملف وتاريخه عند كل إرسال.)_
- 2026-11-10: `PROMANGO_backup_2026-11-10_a.zip` (قديمة، قبل B1a)
- 2026-11-14: `PROMANGO_backup_2026-11-14_a.zip` (بعد B1a: 22 وحدة + 49 E2E ناجحة؛ بلا `.env` ولا node_modules)
- 2026-11-15: `PROMANGO_backup_2026-11-15_a.zip` (بعد B1b جزء 1 + J2/J3: خادم 24+70، واجهة 87+39؛ بلا `.env` ولا node_modules ولا dist)
- 2026-11-19: `PROMANGO_backup_2026-11-19_a.zip` (بعد B2 الخادم: 52 وحدة + 233 E2E؛ واجهة 87 وحدة؛ مع ملف التقدم 63.9٪ وبرومت المتابعة؛ بلا `.env` ولا node_modules ولا dist ولا storage)

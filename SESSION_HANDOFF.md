# PROMANGO — SESSION HANDOFF

**آخر تحديث:** 2026-11-15 · **المشروع:** `/home/claude/PROMANGO` (قد تُمسح البيئة؛ النسخة المرسلة للمالك هي المرجع الاحتياطي).

## اقرأ أولًا
`PROGRESS.md` · `PROMANGO_REQUIREMENTS_AR.md` (لا يُعدَّل) · `docs/decisions.md` · `docs/api-contract.md` (المرجع المشترك) · `docs/phase-j-audit.md` · `design/brand/identity.md`.

## الحالة
- `apps/api`: أساس + مصادقة + مستخدمون/شركة/تخصصات + seed، مُختبرة (`cd apps/api && npm run verify` → 24 وحدة + 70 E2E).
- `apps/web`: J2/J3 منجزان (`cd apps/web && npm run verify` → typecheck×3 + lint + 87 اختبارًا + بناء). E2E: `SEED_PASSWORD=… E2E_DATABASE_URL=… npm run e2e` (انظر `docs/testing.md`).
- PostgreSQL 16 يتوقف بعد كل إعادة تشغيل للبيئة: `service postgresql start` ثم `cd apps/api && npm run build && node dist/main.js` (المنفذ 3000) ثم `npm run dev` في الواجهة. القاعدتان `promango_dev` و`promango_test` (دور `promango_app`)؛ `.env` في `apps/api` سري لا يُطبع.
- npm 10 قد يفشل ← `npx --yes npm@11 install`. Figma MCP محدود (Starter): الهوية من `design/brand/identity.md`.
- الوكلاء الفرعيون يقطعهم حد الاستخدام: العمل المباشر أنجح.
- **قائمة الحل الكاملة:** `docs/backlog.md` (مشاكل P1–P13، مهام T1–T16، قرارات المالك).

## الخطوات المتبقية بالترتيب
1. صفحات الواجهة للمستخدمين والشركة (الـ API جاهز) — جزء من J4.
2. **T3** الاشتراكات والشراء التجريبي (migration + `pgp_sym_encrypt` + اختبارات + صفحة) — يحتاج قرار الأسعار/العملة أو تبقى موسومة تجريبية.
3. **T4** قرار المالك `priority`/`due_date` ثم **B2**: المشاريع والمهام والاعتماديات والتسليم والمراجعة والتدقيق والتقارير + اختبارات عزل ومنطق وتزامن.
4. J4–J8 تتبع B2؛ T8 smoke tests للمخطط؛ T9 `setup-windows.md`؛ T10 حد معدّل عام؛ T13–T14 CI/نشر.

## Next exact action
أنشئ شاشة المستخدمين (قائمة + إنشاء بكلمة مؤقتة تُعرض مرة واحدة مع نسخها + تعديل/تعطيل/إعادة تعيين) على `/users` للمدير التنفيذي فقط عبر `src/features/users/routes.ts` (يُلتقط تلقائيًا بـ `import.meta.glob`)، مع اختبارات مكوّنات + E2E بالنمط نفسه في `apps/web/e2e`.

## نسخ احتياطية أُرسلت للمالك
_(يُسجَّل هنا اسم الملف وتاريخه عند كل إرسال.)_
- 2026-11-10: `PROMANGO_backup_2026-11-10_a.zip` (قديمة، قبل B1a)
- 2026-11-14: `PROMANGO_backup_2026-11-14_a.zip` (بعد B1a: 22 وحدة + 49 E2E ناجحة؛ بلا `.env` ولا node_modules)
- 2026-11-15: `PROMANGO_backup_2026-11-15_a.zip` (بعد B1b جزء 1 + J2/J3: خادم 24+70، واجهة 87+39؛ بلا `.env` ولا node_modules ولا dist)

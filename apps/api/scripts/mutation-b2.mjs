#!/usr/bin/env node
/**
 * T19 — اختبار الطفرات (mutation testing) لمنطق B2 الحرج.
 *
 * الفكرة: نكسر سطرًا واحدًا من الكود عمدًا (طفرة) ونشغّل الاختبارات المعنية؛ يجب أن يفشل اختبار واحد
 * على الأقل («قُتلت الطفرة»). طفرة تنجو = ثغرة في الاختبارات: تُكتب لها حالة اختبار ثم تُعاد.
 *
 * الاستعمال (من apps/api، بعد `service postgresql start`):
 *   node scripts/mutation-b2.mjs                 # كل الطفرات
 *   node scripts/mutation-b2.mjs --only P1,S5    # طفرات محددة
 *   node scripts/mutation-b2.mjs --list          # عرض القائمة فقط
 *   node scripts/mutation-b2.mjs --report out.json
 *
 * الأمان: تُحفظ نسخة من كل ملف قبل تعديله في .tmp/mutation-backup مع ملف قفل؛ تُستعاد الملفات في
 * finally وعند SIGINT/SIGTERM وعند أي تشغيل لاحق وجد قفلًا عالقًا. يخرج بالرمز 1 إن نجت أي طفرة.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const BACKUP_DIR = join(TMP, 'mutation-backup');
const LOCK = join(TMP, 'mutation.lock');
const VITEST = join(ROOT, 'node_modules', '.bin', 'vitest');

const UNIT = { cfg: 'vitest.config.ts' };
const E2E = { cfg: 'vitest.config.e2e.ts' };

/**
 * old/new: نص مطابق تمامًا. occurrence: أي ظهور يُعدَّل (افتراضي 1) و count: العدد المتوقع الكلي (افتراضي 1)
 * — إن تغيّر الكود فتبدّل العدد يتوقف السكربت بدل أن يختبر طفرة خاطئة.
 */
const MUTANTS = [
  // ── السياسة والنموذج (وحدة) ─────────────────────────────────────────────
  { id: 'P1', name: 'المراجع يراجع عمله (إزالة reviewer ≠ assignee من policy)', file: 'src/work/policy.ts', old: 't.reviewerId === a.id && t.assignedTo !== a.id;', new: 't.reviewerId === a.id;', suite: UNIT, specs: ['src/work/policy.spec.ts'] },
  { id: 'P2', name: 'التعديل على مشروع مغلق (edit بلا open)', file: 'src/work/policy.ts', old: 'edit: open && mgr,', new: 'edit: mgr,', suite: UNIT, specs: ['src/work/policy.spec.ts'] },
  { id: 'P3', name: 'البدء بعد طلب التعديل غير مسموح', file: 'src/work/policy.ts', old: " && (t.status === 'ASSIGNED' || t.status === 'CHANGES_REQUESTED'),", new: " && t.status === 'ASSIGNED',", suite: UNIT, specs: ['src/work/policy.spec.ts'] },
  { id: 'P4', name: 'البدء رغم سوابق غير مكتملة (allowedNext)', file: 'src/work/policy.ts', old: 'if (can.start && ctx.blockedByCount === 0)', new: 'if (can.start)', suite: UNIT, specs: ['src/work/policy.spec.ts'] },
  { id: 'P5', name: 'أي دور يُعدّ مديرًا مختصًا معيّنًا (إزالة فحص الدور)', file: 'src/work/policy.ts', old: "a.role === 'SPECIALIZED_MANAGER' && t.assignedManagerId === a.id", new: 't.assignedManagerId === a.id', suite: UNIT, specs: ['src/work/policy.spec.ts'] },
  { id: 'P6', name: 'مهمة فرعية يمكن أن يكون لها مهام فرعية', file: 'src/work/policy.ts', old: 'createSubtask: open && !isSubtask && (mgr || am),', new: 'createSubtask: open && (mgr || am),', suite: UNIT, specs: ['src/work/policy.spec.ts'] },
  { id: 'P7', name: 'حذف مهمة لها تسليمات', file: 'src/work/policy.ts', old: ' && !ctx.hasDependencies && !ctx.hasSubmissions,', new: ' && !ctx.hasDependencies,', suite: UNIT, specs: ['src/work/policy.spec.ts'] },
  { id: 'P8', name: 'المراجع لا يرى المهمة (canSeeTask)', file: 'src/work/policy.ts', old: '[t.createdBy, t.assignedManagerId, t.assignedTo, t.reviewerId].includes(a.id)', new: '[t.createdBy, t.assignedManagerId, t.assignedTo].includes(a.id)', suite: UNIT, specs: ['src/work/policy.spec.ts'] },
  { id: 'M1', name: 'السماح بانتقال SUBMITTED→COMPLETED مباشرة', file: 'src/work/model.ts', old: "  ['UNDER_REVIEW', 'COMPLETED'],\n  ['UNDER_REVIEW', 'CHANGES_REQUESTED'],\n  ['CHANGES_REQUESTED', 'IN_PROGRESS'],\n];\n\n/** ما يُسمح", new: "  ['UNDER_REVIEW', 'COMPLETED'],\n  ['SUBMITTED', 'COMPLETED'],\n  ['UNDER_REVIEW', 'CHANGES_REQUESTED'],\n  ['CHANGES_REQUESTED', 'IN_PROGRESS'],\n];\n\n/** ما يُسمح", suite: UNIT, specs: ['src/work/model.spec.ts'] },
  { id: 'M2', name: 'انتقال يدوي إلى COMPLETED (تجاوز المراجعة)', file: 'src/work/model.ts', old: "  ['ASSIGNED', 'IN_PROGRESS'],\n  ['CHANGES_REQUESTED', 'IN_PROGRESS'],\n];", new: "  ['ASSIGNED', 'IN_PROGRESS'],\n  ['CHANGES_REQUESTED', 'IN_PROGRESS'],\n  ['UNDER_REVIEW', 'COMPLETED'],\n];", suite: UNIT, specs: ['src/work/model.spec.ts'] },
  { id: 'M3', name: 'مشروع مكتمل يُعاد تنشيطه', file: 'src/work/model.ts', old: '  COMPLETED: [],\n  CANCELLED: [],', new: "  COMPLETED: ['ACTIVE'],\n  CANCELLED: [],", suite: UNIT, specs: ['src/work/model.spec.ts'] },
  { id: 'M4', name: 'مشروع ON_HOLD يُعدّ مغلقًا', file: 'src/work/model.ts', old: "['COMPLETED', 'CANCELLED'];", new: "['COMPLETED', 'CANCELLED', 'ON_HOLD'];", suite: UNIT, specs: ['src/work/model.spec.ts', 'src/work/policy.spec.ts'] },
  { id: 'M5', name: 'ترتيب الأولوية: HIGH أعلى من URGENT', file: 'src/work/model.ts', old: 'HIGH: 3, URGENT: 4', new: 'HIGH: 4, URGENT: 3', suite: UNIT, specs: ['src/work/model.spec.ts'] },

  // ── عزل الشركات والرؤية (SQL + E2E) ────────────────────────────────────
  { id: 'S1', name: 'غير المدراء يرون كل مهام الشركة (taskVisibilitySql)', file: 'src/work/task-sql.ts', old: "params: unknown[]): string {\n  if (isManager(actor.role)) return 'TRUE';\n  const i = params.push(actor.id);\n  return `(${alias}.created_by = $${i} OR ${alias}.assigned_to", new: "params: unknown[]): string {\n  if (true) return 'TRUE';\n  const i = params.push(actor.id);\n  return `(${alias}.created_by = $${i} OR ${alias}.assigned_to", suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/projects.e2e-spec.ts'] },
  { id: 'S2', name: 'غير المدراء يرون كل المشاريع (projectVisibilitySql)', file: 'src/work/task-sql.ts', old: "export function projectVisibilitySql(actor: AuthUser, alias: string, params: unknown[]): string {\n  if (isManager(actor.role)) return 'TRUE';", new: "export function projectVisibilitySql(actor: AuthUser, alias: string, params: unknown[]): string {\n  if (true) return 'TRUE';", suite: E2E, specs: ['test/e2e/projects.e2e-spec.ts', 'test/e2e/tasks.e2e-spec.ts'] },
  { id: 'S3', name: 'تحميل مهمة بلا قيد الشركة (loadTaskRow)', file: 'src/work/task-sql.ts', old: 'WHERE t.id = $1 AND t.company_id = $2${lock', new: 'WHERE t.id = $1 AND (t.company_id = $2 OR TRUE)${lock', suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/delivery.e2e-spec.ts', 'test/e2e/dependencies.e2e-spec.ts'] },
  { id: 'S4', name: 'قائمة المهام بلا قيد الشركة', file: 'src/tasks/tasks.service.ts', old: "const where = ['t.company_id = $1', taskVisibilitySql(actor, 't', params)];", new: "const where = ['($1::uuid IS NOT NULL)', taskVisibilitySql(actor, 't', params)];", suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/platform.e2e-spec.ts'] },
  { id: 'S5', name: 'التأخّر: مهمة مكتملة تُعدّ متأخرة', file: 'src/work/task-sql.ts', old: "AND t.status <> 'COMPLETED' AND t.archived_at IS NULL)`;", new: 'AND t.archived_at IS NULL)`;', suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/insights.e2e-spec.ts'] },
  { id: 'S6', name: 'التأخّر: يوم الاستحقاق نفسه يُعدّ متأخرًا (< ← <=)', file: 'src/work/task-sql.ts', old: 't.due_date < CURRENT_DATE AND', new: 't.due_date <= CURRENT_DATE AND', suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/insights.e2e-spec.ts'] },
  { id: 'S7', name: 'فرز الأولوية معكوس (URGENT=3, HIGH=4)', file: 'src/tasks/tasks.service.ts', old: "WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3", new: "WHEN 'URGENT' THEN 3 WHEN 'HIGH' THEN 4", suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts'] },
  { id: 'S8', name: 'السابقة المؤرشفة تمنع البدء (إزالة فلتر الأرشفة من blocked_by)', file: 'src/work/task-sql.ts', old: "pr.status <> 'COMPLETED' AND pr.archived_at IS NULL) AS blocked_by", new: "pr.status <> 'COMPLETED') AS blocked_by", suite: E2E, specs: ['test/e2e/dependencies.e2e-spec.ts', 'test/e2e/tasks.e2e-spec.ts'] },
  { id: 'S9', name: 'تعليم اللاحقات يشمل المهام غير المبدوءة (FR-010)', file: 'src/work/task-sql.ts', old: "AND s.status IN ('IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED')", new: 'AND s.status IS NOT NULL', suite: E2E, specs: ['test/e2e/dependencies.e2e-spec.ts', 'test/e2e/delivery.e2e-spec.ts'] },

  // ── الاعتماديات ────────────────────────────────────────────────────────
  { id: 'D1', name: 'الدورة في الاعتماديات تُقبل', file: 'src/dependencies/dependencies.service.ts', old: "if (cycle.length) throw new ApiException(409, 'DEPENDENCY_CYCLE');", new: '', suite: E2E, specs: ['test/e2e/dependencies.e2e-spec.ts'] },
  { id: 'D2', name: 'الدورة غير المباشرة لا تُكتشف (البحث بعمق 1 فقط)', file: 'src/dependencies/dependencies.service.ts', old: '           UNION\n           SELECT d.successor_task_id FROM task_dependencies d JOIN reach r ON d.predecessor_task_id = r.id\n', new: '           UNION\n           SELECT d.successor_task_id FROM task_dependencies d JOIN reach r ON d.predecessor_task_id = r.id WHERE FALSE\n', suite: E2E, specs: ['test/e2e/dependencies.e2e-spec.ts'] },
  { id: 'D3', name: 'اعتمادية مكررة تُقبل', file: 'src/dependencies/dependencies.service.ts', old: "if (dup.length) throw new ApiException(409, 'DEPENDENCY_DUPLICATE');", new: '', suite: E2E, specs: ['test/e2e/dependencies.e2e-spec.ts'] },
  { id: 'D4', name: 'ربط مهمتين من مشروعين مختلفين', file: 'src/dependencies/dependencies.service.ts', old: 'AND company_id = $2 AND project_id = $3`,', new: 'AND company_id = $2 AND ($3::uuid IS NOT NULL OR TRUE)`,', suite: E2E, specs: ['test/e2e/dependencies.e2e-spec.ts'] },
  { id: 'D5', name: 'إضافة اعتمادية في مشروع مغلق', file: 'src/dependencies/dependencies.service.ts', old: 'if (isProjectClosed(p.status))', new: 'if (false && isProjectClosed(p.status))', suite: E2E, specs: ['test/e2e/dependencies.e2e-spec.ts'] },
  { id: 'D6', name: 'إزالة القفل الاستشاري (سباق دورتين متعاكستين)', file: 'src/dependencies/dependencies.service.ts', old: 'await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [projectId]);', new: '', suite: E2E, specs: ['test/e2e/dependencies.e2e-spec.ts'] },

  // ── إغلاق المشروع ─────────────────────────────────────────────────────
  { id: 'C1', name: 'إنشاء مهمة في مشروع مغلق', file: 'src/tasks/tasks.service.ts', old: 'if (isProjectClosed(p.status))', new: 'if (false && isProjectClosed(p.status))', suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/projects.e2e-spec.ts'] },
  { id: 'C2', name: 'تعديل مهمة في مشروع مغلق', file: 'src/tasks/tasks.service.ts', old: 'if (isProjectClosed(row.project_status))', new: 'if (false && isProjectClosed(row.project_status))', occurrence: 1, count: 3, suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/projects.e2e-spec.ts'] },
  { id: 'C3', name: 'انتقال حالة مهمة في مشروع مغلق', file: 'src/tasks/tasks.service.ts', old: 'if (isProjectClosed(row.project_status))', new: 'if (false && isProjectClosed(row.project_status))', occurrence: 2, count: 3, suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/projects.e2e-spec.ts'] },
  { id: 'C4', name: 'أرشفة/حذف مهمة فرعية في مشروع مغلق', file: 'src/tasks/tasks.service.ts', old: 'if (isProjectClosed(row.project_status))', new: 'if (false && isProjectClosed(row.project_status))', occurrence: 3, count: 3, suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/projects.e2e-spec.ts'] },
  { id: 'C5', name: 'تسليم في مشروع مغلق', file: 'src/delivery/delivery.service.ts', old: 'if (isProjectClosed(row.project_status))', new: 'if (false && isProjectClosed(row.project_status))', occurrence: 1, count: 2, suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts', 'test/e2e/projects.e2e-spec.ts'] },
  { id: 'C6', name: 'مراجعة في مشروع مغلق', file: 'src/delivery/delivery.service.ts', old: 'if (isProjectClosed(row.project_status))', new: 'if (false && isProjectClosed(row.project_status))', occurrence: 2, count: 2, suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts', 'test/e2e/projects.e2e-spec.ts'] },

  // ── التسليم والمراجعة ──────────────────────────────────────────────────
  { id: 'R1', name: 'مراجعة المكلّف لعمله (إزالة assigned_to من فحص المراجعة)', file: 'src/delivery/delivery.service.ts', old: 'if (row.reviewer_id !== actor.id || row.assigned_to === actor.id)', new: 'if (row.reviewer_id !== actor.id)', suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts'] },
  { id: 'R2', name: 'أي مستخدم يراجع (إزالة فحص reviewer_id)', file: 'src/delivery/delivery.service.ts', old: 'if (row.reviewer_id !== actor.id || row.assigned_to === actor.id)', new: 'if (row.assigned_to === actor.id)', suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts'] },
  { id: 'R3', name: 'اعتماد مهمة رئيسية بمهام فرعية مطلوبة غير مكتملة', file: 'src/delivery/delivery.service.ts', old: "AND archived_at IS NULL AND is_required AND status <> 'COMPLETED' ORDER BY created_at", new: "AND archived_at IS NULL AND status <> 'COMPLETED' AND FALSE ORDER BY created_at", suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts'] },
  { id: 'R4', name: 'طلب تعديل بلا تعليق', file: 'src/delivery/delivery.service.ts', old: "if (dto.decision === 'CHANGES_REQUESTED' && !comments) {", new: 'if (false) {', suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts'] },
  { id: 'R5', name: 'مراجعة مهمة ليست قيد المراجعة', file: 'src/delivery/delivery.service.ts', old: "if (row.status !== 'UNDER_REVIEW') throw", new: "if (false) throw", suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts'] },

  // ── الملفات والتنزيل ──────────────────────────────────────────────────
  { id: 'F1', name: 'حارس مسار التنزيل معطّل (path traversal)', file: 'src/delivery/delivery.service.ts', old: 'if (!abs.startsWith(this.root + sep))', new: 'if (false)', suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts'] },
  { id: 'F2', name: 'رقم PDF السحري لا يُفحص', file: 'src/delivery/file-rules.ts', old: 'return startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-', new: 'return true;', suite: UNIT, specs: ['src/delivery/file-rules.spec.ts'] },
  { id: 'F3', name: 'حد الحجم مضاعف', file: 'src/delivery/file-rules.ts', old: 'buf.length > FILE_LIMITS.maxBytes)', new: 'buf.length > FILE_LIMITS.maxBytes * 2)', suite: UNIT, specs: ['src/delivery/file-rules.spec.ts'] },
  { id: 'F4', name: 'مسارات المجلدات لا تُزال من اسم الملف', file: 'src/delivery/file-rules.ts', old: "name = name.replace(/^.*[\\\\/]/, '');", new: '', suite: UNIT, specs: ['src/delivery/file-rules.spec.ts'] },
  { id: 'F5', name: 'اسم Content-Disposition بلا تعقيم ASCII', file: 'src/delivery/file-rules.ts', old: ".replace(/[^A-Za-z0-9._-]/g, '_')", new: '', suite: UNIT, specs: ['src/delivery/file-rules.spec.ts'] },
  { id: 'F6', name: 'محارف الاتجاه لا تُزال (تزييف الامتداد)', file: 'src/delivery/file-rules.ts', old: '  (n >= 0x202a && n <= 0x202e) ||\n', new: '', suite: UNIT, specs: ['src/delivery/file-rules.spec.ts'] },

  // ── التدقيق والأزمنة ──────────────────────────────────────────────────
  { id: 'A1', name: 'أحداث التدقيق بطابع NOW() (ترتيب ضائع داخل المعاملة)', file: 'src/work/audit.ts', old: '$10::jsonb, clock_timestamp())', new: '$10::jsonb, NOW())', suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts', 'test/e2e/insights.e2e-spec.ts', 'test/e2e/users-audit.e2e-spec.ts'] },
  { id: 'A2', name: 'طابع المرفقات NOW() (ترتيب الملفات)', file: 'src/delivery/delivery.service.ts', old: "$6, $7, clock_timestamp())", new: "$6, $7, NOW())", suite: E2E, specs: ['test/e2e/delivery.e2e-spec.ts'] },
  { id: 'A3', name: 'تقرير أسبوعي 7 أيام قبل بدل 6', file: 'src/insights/audit-period.ts', old: '6 * DAY_MS', new: '7 * DAY_MS', suite: UNIT, specs: ['src/insights/audit-period.spec.ts'] },
  { id: 'A4', name: 'نهاية الفترة بعد يومين', file: 'src/insights/audit-period.ts', old: 'const to = new Date(day.getTime() + DAY_MS);', new: 'const to = new Date(day.getTime() + 2 * DAY_MS);', suite: UNIT, specs: ['src/insights/audit-period.spec.ts'] },
  { id: 'A5', name: 'نطاق التاريخين الشاملين يستثني اليوم الأخير', file: 'src/insights/audit-period.ts', old: 'new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS', new: 'new Date(`${to}T00:00:00.000Z`).getTime()', suite: UNIT, specs: ['src/insights/audit-period.spec.ts'] },
  { id: 'A6', name: 'التدقيق متاح لمدير المشروع (EXEC فقط)', file: 'src/insights/insights.controller.ts', old: "@Roles('EXECUTIVE_MANAGER')\n@Controller('audit')", new: "@Roles('EXECUTIVE_MANAGER', 'PROJECT_MANAGER')\n@Controller('audit')", suite: E2E, specs: ['test/e2e/insights.e2e-spec.ts', 'test/e2e/routes.e2e-spec.ts'] },

  // ── طبقة البيانات ─────────────────────────────────────────────────────
  { id: 'Q1', name: 'rowsOf لا يفكّ شكل [rows,count] لـ UPDATE…RETURNING', file: 'src/common/db.ts', old: "result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number'", new: 'false', suite: E2E, specs: ['test/e2e/tasks.e2e-spec.ts', 'test/e2e/delivery.e2e-spec.ts', 'test/e2e/dependencies.e2e-spec.ts'] },
];

// ───────────────────────── المنفّذ ─────────────────────────
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

function restoreStale() {
  if (!existsSync(LOCK)) return;
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  for (const f of lock.files) writeFileSync(join(ROOT, f), readFileSync(join(BACKUP_DIR, f.replaceAll('/', '__')), 'utf8'));
  rmSync(LOCK);
  console.log(`⚠ استُعيدت ملفات من تشغيل سابق منقطع: ${lock.files.join(', ')}`);
}

let active = null; // { file, original }
function restoreActive() {
  if (!active) return;
  writeFileSync(join(ROOT, active.file), active.original);
  active = null;
  if (existsSync(LOCK)) rmSync(LOCK);
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restoreActive();
    process.exit(130);
  });
}
process.on('exit', restoreActive);

function runVitest(suite, specs) {
  const r = spawnSync(VITEST, ['run', '--config', suite.cfg, ...specs], { cwd: ROOT, encoding: 'utf8', timeout: 900_000, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const failedTests = /Tests\s+.*?(\d+) failed/.exec(out);
  return { code: r.status, out, failed: failedTests ? Number(failedTests[1]) : 0, timedOut: r.error?.code === 'ETIMEDOUT' };
}

function applyMutation(src, m) {
  const occurrence = m.occurrence ?? 1;
  const count = m.count ?? 1;
  const total = src.split(m.old).length - 1;
  if (total !== count) throw new Error(`النص المستهدف يظهر ${total} مرة (المتوقع ${count}) — حدّث الطفرة ${m.id}`);
  let idx = -1;
  for (let i = 0; i < occurrence; i++) idx = src.indexOf(m.old, idx + 1);
  return src.slice(0, idx) + m.new + src.slice(idx + m.old.length);
}

function main() {
  restoreStale();
  const only = opt('--only')?.split(',');
  const list = only ? MUTANTS.filter((m) => only.includes(m.id)) : MUTANTS;
  if (flag('--list')) {
    for (const m of MUTANTS) console.log(`${m.id.padEnd(3)} ${m.suite === UNIT ? 'وحدة' : 'E2E '}  ${m.file}  —  ${m.name}`);
    console.log(`\n${MUTANTS.length} طفرة`);
    return 0;
  }
  if (flag('--check')) {
    // تحقق جاف: كل طفرة يجب أن تجد نصها المستهدف في الملف بالعدد المتوقع، بلا تشغيل اختبارات.
    let bad = 0;
    for (const m of list) {
      try {
        applyMutation(readFileSync(join(ROOT, m.file), 'utf8'), m);
      } catch (e) {
        bad++;
        console.log(`✗ ${m.id}: ${e.message}`);
      }
    }
    console.log(bad ? `${bad} طفرة بحاجة إلى تصحيح` : `كل الطفرات الـ${list.length} تجد هدفها ✓`);
    return bad ? 1 : 0;
  }
  mkdirSync(BACKUP_DIR, { recursive: true });

  // 1) خط الأساس: الاختبارات المعنية يجب أن تنجح بلا أي طفرة وإلا لا معنى للنتائج.
  for (const [name, suite] of [['وحدة', UNIT], ['E2E', E2E]]) {
    const specs = [...new Set(list.filter((m) => m.suite === suite).flatMap((m) => m.specs))];
    if (!specs.length) continue;
    process.stdout.write(`خط الأساس (${name}، ${specs.length} ملف)… `);
    const b = runVitest(suite, specs);
    if (b.code !== 0) {
      console.log('فشل ✗\n' + b.out.slice(-1500));
      return 2;
    }
    console.log('نجح ✓');
  }

  const results = [];
  for (const m of list) {
    const original = readFileSync(join(ROOT, m.file), 'utf8');
    let mutated;
    try {
      mutated = applyMutation(original, m);
    } catch (e) {
      console.log(`${m.id} خطأ إعداد: ${e.message}`);
      results.push({ id: m.id, name: m.name, status: 'CONFIG_ERROR', detail: e.message });
      continue;
    }
    if (mutated === original) {
      results.push({ id: m.id, name: m.name, status: 'CONFIG_ERROR', detail: 'الطفرة لم تغيّر شيئًا' });
      console.log(`${m.id} خطأ إعداد: الطفرة لم تغيّر شيئًا`);
      continue;
    }
    const key = m.file.replaceAll('/', '__');
    writeFileSync(join(BACKUP_DIR, key), original);
    writeFileSync(LOCK, JSON.stringify({ files: [m.file] }));
    active = { file: m.file, original };
    writeFileSync(join(ROOT, m.file), mutated);
    const t0 = Date.now();
    let r;
    try {
      r = runVitest(m.suite, m.specs);
    } finally {
      restoreActive();
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    let status;
    if (r.timedOut) status = 'TIMEOUT';
    else if (r.code === 0) status = 'SURVIVED';
    else if (r.failed > 0) status = 'KILLED';
    else status = 'KILLED_LOAD_ERROR'; // فشل تحميل/ترجمة (لا اختبار مخفق) — تُراجع يدويًا
    const failing = [...r.out.matchAll(/^\s*(?:×|✗|FAIL)\s+(.*?)(?:\s+\d+ms)?$/gm)].map((x) => x[1]).slice(0, 3);
    results.push({ id: m.id, name: m.name, file: m.file, status, failedTests: r.failed, secs: Number(secs), killedBy: failing });
    const icon = status === 'KILLED' ? '✓ قُتلت' : status === 'SURVIVED' ? '✗ نجت!' : `? ${status}`;
    console.log(`${m.id.padEnd(3)} ${icon.padEnd(10)} (${secs}s, ${r.failed} فاشل)  ${m.name}`);
    if (status !== 'KILLED') console.log(r.out.slice(-600).replace(/^/gm, '      | '));
  }

  const by = (s) => results.filter((r) => r.status === s).length;
  const killed = by('KILLED');
  console.log(`\nالنتيجة: ${killed}/${results.length} طفرة قُتلت، ${by('SURVIVED')} نجت، ${results.length - killed - by('SURVIVED')} غير محسومة (إعداد/تحميل/مهلة).`);
  if (opt('--report')) writeFileSync(resolve(opt('--report')), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  return by('SURVIVED') || results.length - killed ? 1 : 0;
}

process.exitCode = main();

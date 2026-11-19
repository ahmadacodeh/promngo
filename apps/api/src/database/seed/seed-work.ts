/**
 * بيانات تطوير المشاريع والمهام (B2).
 *
 * لا نكتب الحالة النهائية مباشرة: نصف «تاريخ» كل مهمة خطوات (إسناد، بدء، تسليم، مراجعة) ثم نعيد تشغيله
 * فينتج بالضبط السجلات التي ينتجها التطبيق: حالة المهمة، التسليمات والمرفقات، قرارات المراجعة، وأحداث التدقيق
 * بالتتابع الزمني. ويُفحص التعريف نفسه قبل الكتابة بقواعد التطبيق (المراجع مدير مختص غير المكلّف، تطابق التخصص،
 * لا بدء قبل اكتمال السوابق، لا اكتمال مع فرعية مطلوبة مفتوحة)، فإن خالف خطأ في التعريف يفشل البذر برسالة واضحة.
 *
 * التواريخ نسبية لليوم (CURRENT_DATE) كي تبقى المتأخرة/القادمة صحيحة كلما أُعيد البناء.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EntityManager } from 'typeorm';
import { STARTED_STATUSES, type Priority, type ProjectStatus, type TaskStatus } from '../../work/model.js';

export type Who = 'exec' | 'pm' | 'spec1' | 'spec2' | 'emp1' | 'emp2';

/** ما يحتاجه البذر عن كل مستخدم مزروع (المعرّف والدور والتخصص للتحقق من القواعد). */
export interface SeededUser {
  id: string;
  role: string;
  specialization: string | null;
}

type Step =
  | { go: 'ASSIGNED' | 'BLOCKED' | 'IN_PROGRESS' }
  | { submit: { note?: string; file?: { name: string; body: string } } }
  | { review: 'APPROVED' | 'CHANGES_REQUESTED'; comments?: string };

interface TaskSeed {
  key: string;
  parent?: string;
  title: string;
  description?: string;
  priority: Priority;
  /** عدد الأيام من اليوم (سالب = متأخر). */
  due?: number;
  spec?: string;
  manager?: Who;
  assignee?: Who;
  reviewer?: Who;
  required?: boolean;
  archived?: boolean;
  /** منذ كم يومًا أُنشئت المهمة. */
  daysAgo: number;
  /** منذ كم يومًا وقع آخر حدث في تاريخها (الافتراضي: الآن). */
  endDaysAgo?: number;
  steps?: Step[];
}

interface DependencySeed {
  pred: string;
  succ: string;
  /** اعتمادية أُضيفت بعد بدء اللاحقة: تُعلَّم اللاحقة «تحتاج مراجعة» (FR-010). */
  lateDaysAgo?: number;
}

interface ProjectSeed {
  name: string;
  description: string;
  status: ProjectStatus;
  start?: number;
  due?: number;
  daysAgo: number;
  /** لمشروع مكتمل: منذ كم يومًا اكتمل. */
  completedDaysAgo?: number;
  tasks: TaskSeed[];
  deps?: DependencySeed[];
}

const FE = 'الواجهات الأمامية';
const BE = 'الواجهات الخلفية';
const QA = 'ضمان الجودة';

const REPORT = (title: string): string => `# ${title}\n\nملخص التسليم:\n\n- تم تنفيذ المطلوب وفق الوصف.\n- أُجريت الاختبارات الأساسية بنجاح.\n- الملاحظات مدوّنة في هذا الملف للمراجعة.\n`;

export const SEED_PROJECTS: ProjectSeed[] = [
  {
    name: 'بوابة العملاء الإلكترونية',
    description: 'بوابة عربية (RTL) تتيح للعملاء تسجيل الدخول ومتابعة طلباتهم ولوحة تحكم بمؤشراتهم.',
    status: 'ACTIVE',
    start: -35,
    due: 40,
    daysAgo: 40,
    tasks: [
      {
        key: 'login-ui', title: 'تصميم شاشة تسجيل الدخول', description: 'تصميم الشاشة بالعربية مع حالات الخطأ والتحميل ونسيان كلمة المرور.',
        priority: 'HIGH', due: -12, spec: FE, manager: 'spec1', assignee: 'emp1', reviewer: 'spec2', daysAgo: 38, endDaysAgo: 14,
        steps: [{ go: 'ASSIGNED' }, { go: 'IN_PROGRESS' }, { submit: { note: 'التصميم النهائي مرفق مع شرح الحالات.', file: { name: 'تصميم-شاشة-الدخول.md', body: REPORT('تصميم شاشة تسجيل الدخول') } } }, { review: 'APPROVED', comments: 'ممتاز، مطابق للمواصفات.' }],
      },
      {
        key: 'dash-ui', title: 'بناء مكوّنات لوحة التحكم', description: 'بطاقات المؤشرات والجداول والرسوم الأساسية للوحة التحكم.',
        priority: 'URGENT', due: 2, spec: FE, manager: 'spec1', assignee: 'emp1', reviewer: 'spec2', daysAgo: 25,
        steps: [{ go: 'ASSIGNED' }, { go: 'IN_PROGRESS' }, { submit: { note: 'النسخة الأولى جاهزة للمراجعة.', file: { name: 'مكوّنات-لوحة-التحكم.md', body: REPORT('مكوّنات لوحة التحكم') } } }],
      },
      {
        key: 'dash-qa', title: 'اختبار قبول لوحة التحكم', description: 'تنفيذ سيناريوهات القبول بعد اكتمال مكوّنات اللوحة.',
        priority: 'HIGH', due: 10, spec: QA, manager: 'spec1', assignee: 'emp2', reviewer: 'spec1', daysAgo: 20,
        steps: [{ go: 'BLOCKED' }],
      },
      {
        key: 'auth-svc', title: 'تهيئة خدمة المصادقة', description: 'إعداد خدمة المصادقة والجلسات في الخلفية وربطها بقاعدة المستخدمين.',
        priority: 'MEDIUM', due: -3, spec: BE, manager: 'spec2', reviewer: 'spec1', daysAgo: 18,
      },
      {
        key: 'api-bind', title: 'ربط الواجهة بالخدمات', description: 'ربط شاشات الواجهة بواجهات البرمجة وإدارة حالات التحميل والأخطاء.',
        priority: 'MEDIUM', due: -2, spec: FE, manager: 'spec1', assignee: 'emp1', reviewer: 'spec2', daysAgo: 12,
        steps: [{ go: 'ASSIGNED' }, { go: 'IN_PROGRESS' }],
      },
      {
        key: 'bind-login', parent: 'api-bind', title: 'ربط شاشة الدخول', description: 'ربط نموذج الدخول بخدمة تسجيل الدخول.',
        priority: 'HIGH', due: -5, spec: FE, manager: 'spec1', assignee: 'emp1', reviewer: 'spec2', daysAgo: 11, endDaysAgo: 6,
        steps: [{ go: 'ASSIGNED' }, { go: 'IN_PROGRESS' }, { submit: { note: 'تم الربط واختُبرت حالات الخطأ.' } }, { review: 'APPROVED' }],
      },
      {
        key: 'bind-account', parent: 'api-bind', title: 'ربط شاشة الحساب', priority: 'MEDIUM', due: 3,
        spec: FE, manager: 'spec1', assignee: 'emp1', reviewer: 'spec2', daysAgo: 8,
        steps: [{ go: 'ASSIGNED' }, { go: 'IN_PROGRESS' }],
      },
      {
        key: 'bind-docs', parent: 'api-bind', title: 'توثيق نقاط الربط', description: 'مهمة اختيارية: توثيق نقاط الربط للمطورين الجدد.',
        priority: 'LOW', due: 12, required: false, spec: FE, manager: 'spec1', assignee: 'emp1', reviewer: 'spec2', daysAgo: 8,
        steps: [{ go: 'ASSIGNED' }],
      },
      { key: 'bind-old', parent: 'api-bind', title: 'ربط شاشة التقارير (أُلغيت)', priority: 'LOW', manager: 'spec1', archived: true, daysAgo: 10 },
      {
        key: 'perf-review', title: 'مراجعة أداء الصفحات', description: 'قياس زمن التحميل على الشبكات البطيئة وتقديم تقرير.',
        priority: 'LOW', due: 20, spec: QA, manager: 'spec1', assignee: 'emp2', reviewer: 'spec1', daysAgo: 9,
        steps: [
          { go: 'ASSIGNED' }, { go: 'IN_PROGRESS' },
          { submit: { note: 'أرفقت نتائج القياس على الشبكة السريعة.', file: { name: 'نتائج-الأداء.md', body: REPORT('نتائج قياس الأداء') } } },
          { review: 'CHANGES_REQUESTED', comments: 'يلزم قياس الأداء على الشبكات البطيئة وإرفاق النتائج.' },
        ],
      },
    ],
    deps: [
      { pred: 'login-ui', succ: 'dash-ui' },
      { pred: 'dash-ui', succ: 'dash-qa' },
      { pred: 'login-ui', succ: 'api-bind' },
      { pred: 'auth-svc', succ: 'api-bind', lateDaysAgo: 1 },
    ],
  },
  {
    name: 'حملة الإطلاق التسويقية',
    description: 'التحضير لحملة إطلاق المنتج: المحتوى وصفحة الهبوط والحملة الإعلانية.',
    status: 'PLANNED',
    start: 7,
    due: 60,
    daysAgo: 6,
    tasks: [
      { key: 'content-plan', title: 'خطة المحتوى', description: 'تحديد المحتوى والقنوات والجدول الزمني للنشر.', priority: 'MEDIUM', due: 20, manager: 'spec2', daysAgo: 5 },
      {
        key: 'landing', title: 'تجهيز صفحة الهبوط', priority: 'HIGH', due: 14, spec: FE, manager: 'spec1', assignee: 'emp1', reviewer: 'spec2', daysAgo: 5,
        steps: [{ go: 'ASSIGNED' }],
      },
      { key: 'ads', title: 'جدولة الحملة الإعلانية', priority: 'URGENT', due: 5, manager: 'spec2', daysAgo: 4 },
    ],
  },
  {
    name: 'ترحيل النظام القديم',
    description: 'ترحيل بيانات النظام القديم إلى المنصة الجديدة والتحقق من سلامتها.',
    status: 'COMPLETED',
    start: -90,
    due: -20,
    daysAgo: 70,
    completedDaysAgo: 22,
    tasks: [
      {
        key: 'inventory', title: 'جرد بيانات النظام القديم', description: 'حصر الجداول والسجلات المطلوب ترحيلها.',
        priority: 'HIGH', due: -60, manager: 'spec2', assignee: 'emp2', reviewer: 'spec1', daysAgo: 68, endDaysAgo: 40,
        steps: [{ go: 'ASSIGNED' }, { go: 'IN_PROGRESS' }, { submit: { note: 'قائمة الجرد كاملة.', file: { name: 'جرد-البيانات.md', body: REPORT('جرد بيانات النظام القديم') } } }, { review: 'APPROVED' }],
      },
      {
        key: 'migration-test', title: 'اختبار الترحيل التجريبي', description: 'ترحيل عيّنة والتحقق من تطابق الأرقام.',
        priority: 'MEDIUM', due: -30, spec: QA, manager: 'spec1', assignee: 'emp2', reviewer: 'spec2', daysAgo: 60, endDaysAgo: 23,
        steps: [
          { go: 'ASSIGNED' }, { go: 'IN_PROGRESS' },
          { submit: { note: 'نتيجة أولى للترحيل التجريبي.' } },
          { review: 'CHANGES_REQUESTED', comments: 'أرقام الفواتير لا تتطابق في 3 سجلات؛ راجع التحويل.' },
          { go: 'IN_PROGRESS' },
          { submit: { note: 'صُحّح التحويل وتطابقت الأرقام.', file: { name: 'تقرير-الترحيل.md', body: REPORT('تقرير الترحيل التجريبي') } } },
          { review: 'APPROVED', comments: 'تمت المطابقة.' },
        ],
      },
    ],
    deps: [{ pred: 'inventory', succ: 'migration-test' }],
  },
];

// ───────────────────────── إعادة تشغيل التاريخ ─────────────────────────

interface EventRow {
  at: Date;
  entity: 'TASK' | 'PROJECT' | 'DEPENDENCY';
  entityId: string;
  taskId: string | null;
  projectId: string | null;
  type: string;
  from?: string | null;
  to?: string | null;
  actor: string;
  meta?: Record<string, unknown>;
}

interface PlannedSubmission {
  id: string;
  round: number;
  by: string;
  note: string | null;
  at: Date;
  file?: { name: string; body: string };
}

interface PlannedReview {
  id: string;
  round: number;
  by: string;
  decision: 'APPROVED' | 'CHANGES_REQUESTED';
  comments: string | null;
  at: Date;
}

interface TaskPlan {
  seed: TaskSeed;
  id: string;
  status: TaskStatus;
  createdAt: Date;
  events: EventRow[];
  submissions: PlannedSubmission[];
  reviews: PlannedReview[];
  needsReview: boolean;
}

const DAY = 86_400_000;
function fail(msg: string): never {
  throw new Error(`تعريف بيانات التطوير غير صالح: ${msg}`);
}

export async function seedWork(m: EntityManager, companyId: string, users: Record<Who, SeededUser>, uploadDir?: string): Promise<void> {
  const now = Date.now();
  const written: string[] = [];
  try {
    for (const p of SEED_PROJECTS) await seedProject(m, companyId, users, p, now, uploadDir, written);
  } catch (e) {
    await Promise.all(written.map((f) => rm(f, { force: true })));
    throw e;
  }
}

async function seedProject(m: EntityManager, companyId: string, users: Record<Who, SeededUser>, p: ProjectSeed, now: number, uploadDir: string | undefined, written: string[]): Promise<void> {
  const uid = (who: Who | undefined): string | null => (who ? users[who].id : null);
  const projectId = randomUUID();
  const createdAt = new Date(now - p.daysAgo * DAY);
  const byKey = new Map(p.tasks.map((t) => [t.key, t]));

  // 1) تخطيط كل مهمة (إعادة تشغيل التاريخ + التحقق من القواعد)
  const plans = new Map<string, TaskPlan>();
  for (const t of p.tasks) plans.set(t.key, planTask(t, users, projectId, createdAt, now));
  for (const d of p.deps ?? []) {
    if (!plans.has(d.pred) || !plans.has(d.succ)) fail(`اعتمادية على مهمة غير موجودة (${d.pred} → ${d.succ}).`);
  }
  validateProject(p, plans, byKey);

  const projectEvents: EventRow[] = [
    { at: createdAt, entity: 'PROJECT', entityId: projectId, taskId: null, projectId, type: 'PROJECT_CREATED', to: 'PLANNED', actor: 'pm', meta: { name: p.name } },
  ];
  if (p.status !== 'PLANNED') {
    projectEvents.push({ at: new Date(createdAt.getTime() + 3_600_000), entity: 'PROJECT', entityId: projectId, taskId: null, projectId, type: 'PROJECT_STATUS_CHANGED', from: 'PLANNED', to: 'ACTIVE', actor: 'pm' });
  }
  if (p.status === 'COMPLETED') {
    projectEvents.push({ at: new Date(now - (p.completedDaysAgo ?? 0) * DAY), entity: 'PROJECT', entityId: projectId, taskId: null, projectId, type: 'PROJECT_STATUS_CHANGED', from: 'ACTIVE', to: 'COMPLETED', actor: 'pm' });
  }
  const projectUpdatedAt = new Date(Math.max(...projectEvents.map((e) => e.at.getTime())));

  await m.query(
    `INSERT INTO projects (id, company_id, name, description, status, created_by, start_date, due_date, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE + $7::int, CURRENT_DATE + $8::int, $9, $10)`,
    [projectId, companyId, p.name, p.description, p.status, users.pm.id, p.start ?? null, p.due ?? null, createdAt, projectUpdatedAt],
  );

  // 2) الاعتماديات المتأخرة تُنتج أحداثها على اللاحقة (تعليم «تحتاج مراجعة»)
  const depRows: Array<{ id: string; pred: TaskPlan; succ: TaskPlan; at: Date; late: boolean }> = [];
  for (const d of p.deps ?? []) {
    const pred = plans.get(d.pred)!;
    const succ = plans.get(d.succ)!;
    const at = d.lateDaysAgo !== undefined ? new Date(now - d.lateDaysAgo * DAY) : new Date(Math.max(pred.createdAt.getTime(), succ.createdAt.getTime()) + 120_000);
    const id = randomUUID();
    depRows.push({ id, pred, succ, at, late: d.lateDaysAgo !== undefined });
    const base = { entity: 'DEPENDENCY' as const, projectId, actor: 'pm' };
    succ.events.push({ ...base, at, entityId: id, taskId: succ.id, type: 'DEPENDENCY_ADDED', meta: { predecessorTaskId: pred.id, successorTaskId: succ.id, predecessorTitle: pred.seed.title, successorTitle: succ.seed.title } });
    if (d.lateDaysAgo !== undefined) {
      succ.events.push({ entity: 'TASK', projectId, actor: 'pm', at: new Date(at.getTime() + 1000), entityId: succ.id, taskId: succ.id, type: 'DEPENDENCY_PREDECESSOR_CHANGED', meta: { predecessorId: pred.id, reason: 'DEPENDENCY_ADDED_AFTER_START' } });
    }
  }

  // 3) المهام: الرئيسية قبل الفرعية
  const ordered = [...p.tasks.filter((t) => !t.parent), ...p.tasks.filter((t) => t.parent)];
  for (const t of ordered) {
    const plan = plans.get(t.key)!;
    const parent = t.parent ? plans.get(t.parent)! : null;
    const updatedAt = new Date(Math.max(plan.createdAt.getTime(), ...plan.events.map((e) => e.at.getTime())));
    const creator = t.parent ? (uid(t.manager) ?? users.pm.id) : users.pm.id;
    await m.query(
      `INSERT INTO tasks (id, company_id, project_id, parent_task_id, title, description, created_by, assigned_manager_id, assigned_to, reviewer_id,
                          specialization_id, status, is_required, priority, due_date, needs_review, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT id FROM specializations WHERE name = $11), $12, $13, $14, CURRENT_DATE + $15::int, $16, $17, $18, $19)`,
      [
        plan.id, companyId, projectId, parent?.id ?? null, t.title, t.description ?? null, creator, uid(t.manager), uid(t.assignee), uid(t.reviewer),
        t.spec ?? null, plan.status, t.required ?? true, t.priority, t.due ?? null, plan.needsReview, t.archived ? new Date(plan.createdAt.getTime() + 3_600_000) : null, plan.createdAt, updatedAt,
      ],
    );
  }

  for (const d of depRows) {
    await m.query(
      `INSERT INTO task_dependencies (id, company_id, project_id, predecessor_task_id, successor_task_id, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [d.id, companyId, projectId, d.pred.id, d.succ.id, users.pm.id, d.at],
    );
  }

  // 4) التسليمات والمرفقات والمراجعات
  for (const plan of plans.values()) {
    for (const s of plan.submissions) {
      await m.query(`INSERT INTO task_submissions (id, company_id, task_id, round, submitted_by, note, submitted_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [s.id, companyId, plan.id, s.round, users[s.by as Who].id, s.note, s.at]);
      if (s.file && uploadDir) {
        const body = Buffer.from(s.file.body, 'utf8');
        const rel = `${companyId}/${plan.id}/${randomUUID()}.md`;
        const abs = join(uploadDir, rel);
        await mkdir(dirname(abs), { recursive: true, mode: 0o750 });
        await writeFile(abs, body, { flag: 'wx', mode: 0o640 });
        written.push(abs);
        await m.query(
          `INSERT INTO task_attachments (company_id, task_id, submission_id, file_name, mime_type, size_bytes, storage_path, created_at) VALUES ($1, $2, $3, $4, 'text/markdown', $5, $6, $7)`,
          [companyId, plan.id, s.id, s.file.name, body.length, rel, s.at],
        );
      }
    }
    for (const r of plan.reviews) {
      await m.query(`INSERT INTO review_records (id, company_id, task_id, reviewer_id, decision, comments, reviewed_at, round) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [r.id, companyId, plan.id, users[r.by as Who].id, r.decision, r.comments, r.at, r.round]);
    }
  }

  // 5) أحداث التدقيق (تُكتب بعد وجود كل الكيانات التي تشير إليها)
  const events = [...projectEvents, ...[...plans.values()].flatMap((pl) => pl.events)];
  for (const e of events) {
    await m.query(
      `INSERT INTO audit_events (company_id, entity, entity_id, task_id, project_id, type, from_status, to_status, actor_id, meta, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [companyId, e.entity, e.entityId, e.taskId, e.projectId, e.type, e.from ?? null, e.to ?? null, users[e.actor as Who].id, JSON.stringify(e.meta ?? {}), e.at],
    );
  }
}

/** يعيد تشغيل خطوات المهمة فيُنتج الحالة النهائية والسجلات والأحداث، ويرفض أي خطوة تخالف قواعد التطبيق. */
function planTask(t: TaskSeed, users: Record<Who, SeededUser>, projectId: string, projectCreatedAt: Date, now: number): TaskPlan {
  const id = randomUUID();
  const createdAt = new Date(Math.max(now - t.daysAgo * DAY, projectCreatedAt.getTime()));
  const end = now - (t.endDaysAgo ?? 0) * DAY - 600_000;
  const steps = t.steps ?? [];
  const label = `«${t.title}»`;

  for (const [field, who] of [['المدير المختص', t.manager], ['المراجع', t.reviewer]] as const) {
    if (who && users[who].role !== 'SPECIALIZED_MANAGER') fail(`${field} في ${label} يجب أن يكون مديرًا مختصًا.`);
  }
  if (t.reviewer && t.reviewer === t.assignee) fail(`المراجع هو المكلّف نفسه في ${label}.`);
  if (t.spec && t.assignee && users[t.assignee].specialization !== t.spec) fail(`تخصص المكلّف لا يطابق تخصص ${label}.`);

  const ev = (at: Date, type: string, actor: Who, from: string | null, to: string | null, meta: Record<string, unknown> = {}): EventRow => ({
    at, entity: 'TASK', entityId: id, taskId: id, projectId, type, from, to, actor, meta,
  });
  const events: EventRow[] = [ev(createdAt, 'TASK_CREATED', t.parent ? (t.manager ?? 'pm') : 'pm', null, 'PLANNED', { title: t.title, subtask: Boolean(t.parent), priority: t.priority })];
  if (t.archived) events.push(ev(new Date(createdAt.getTime() + 3_600_000), 'TASK_ARCHIVED', t.manager ?? 'pm', 'PLANNED', null, { title: t.title }));
  const submissions: PlannedSubmission[] = [];
  const reviews: PlannedReview[] = [];

  let status: TaskStatus = 'PLANNED';
  let round = 0;
  for (const [i, step] of steps.entries()) {
    const at = new Date(createdAt.getTime() + ((i + 1) / (steps.length + 1)) * Math.max(end - createdAt.getTime(), 3_600_000));
    const plus = (s: number): Date => new Date(at.getTime() + s * 1000);
    if ('go' in step) {
      const to = step.go;
      const ok =
        (to === 'ASSIGNED' && (status === 'PLANNED' || status === 'BLOCKED') && Boolean(t.assignee && t.reviewer)) ||
        (to === 'BLOCKED' && status === 'PLANNED') ||
        (to === 'IN_PROGRESS' && (status === 'ASSIGNED' || status === 'CHANGES_REQUESTED'));
      if (!ok) fail(`انتقال غير مسموح ${status} → ${to} في ${label}.`);
      events.push(ev(at, 'TASK_STATUS_CHANGED', to === 'IN_PROGRESS' ? (t.assignee as Who) : 'pm', status, to));
      status = to;
    } else if ('submit' in step) {
      if (status !== 'IN_PROGRESS' || !t.assignee) fail(`تسليم من حالة ${status} في ${label}.`);
      round += 1;
      const sub: PlannedSubmission = { id: randomUUID(), round, by: t.assignee as string, note: step.submit.note ?? null, at, file: step.submit.file };
      submissions.push(sub);
      events.push(ev(at, 'TASK_STATUS_CHANGED', t.assignee as Who, 'IN_PROGRESS', 'SUBMITTED', { round, submissionId: sub.id, files: step.submit.file ? 1 : 0 }));
      events.push(ev(plus(60), 'TASK_STATUS_CHANGED', t.assignee as Who, 'SUBMITTED', 'UNDER_REVIEW', { round, auto: true }));
      status = 'UNDER_REVIEW';
    } else {
      if (status !== 'UNDER_REVIEW' || !t.reviewer) fail(`مراجعة من حالة ${status} في ${label}.`);
      if (step.review === 'CHANGES_REQUESTED' && !step.comments) fail(`طلب تعديلات بلا تعليق في ${label}.`);
      const rec: PlannedReview = { id: randomUUID(), round, by: t.reviewer as string, decision: step.review, comments: step.comments ?? null, at };
      reviews.push(rec);
      const to: TaskStatus = step.review === 'APPROVED' ? 'COMPLETED' : 'CHANGES_REQUESTED';
      events.push(ev(at, 'REVIEW_DECISION', t.reviewer as Who, null, null, { decision: step.review, round, reviewId: rec.id, hasComments: rec.comments !== null }));
      events.push(ev(plus(60), 'TASK_STATUS_CHANGED', t.reviewer as Who, 'UNDER_REVIEW', to, { decision: step.review, round }));
      status = to;
    }
  }
  return { seed: t, id, status, createdAt, events, submissions, reviews, needsReview: false };
}

/** قواعد عبر المهام: السوابق، الفرعيات، إغلاق المشروع. الاعتمادية «المتأخرة» تُعلّم لاحقتها «تحتاج مراجعة». */
function validateProject(p: ProjectSeed, plans: Map<string, TaskPlan>, byKey: Map<string, TaskSeed>): void {
  for (const d of p.deps ?? []) {
    const pred = plans.get(d.pred)!;
    const succ = plans.get(d.succ)!;
    if (pred.seed.parent || succ.seed.parent) fail('الاعتماديات بين المهام الرئيسية فقط.');
    const started = (STARTED_STATUSES as readonly string[]).includes(succ.status);
    if (d.lateDaysAgo !== undefined) {
      if (!started) fail(`الاعتمادية المتأخرة تفترض أن «${succ.seed.title}» بدأت.`);
      succ.needsReview = true;
    } else if (started && pred.status !== 'COMPLETED' && !pred.seed.archived) {
      fail(`«${succ.seed.title}» بدأت قبل اكتمال سابقتها «${pred.seed.title}».`);
    }
  }
  for (const [key, plan] of plans) {
    const t = byKey.get(key)!;
    if (t.parent && !byKey.get(t.parent)) fail(`المهمة الأب «${t.parent}» غير موجودة.`);
    if (t.parent && byKey.get(t.parent)!.parent) fail(`عمق المهام الفرعية أكثر من مستوى واحد عند «${t.title}».`);
    if (plan.status === 'COMPLETED' || p.status === 'COMPLETED') {
      const open = p.tasks.filter((c) => c.parent === key && !c.archived && (c.required ?? true) && plans.get(c.key)!.status !== 'COMPLETED');
      if (plan.status === 'COMPLETED' && open.length) fail(`«${t.title}» مكتملة وفيها فرعية مطلوبة مفتوحة.`);
    }
    if (p.status === 'COMPLETED' && !t.archived && plan.status !== 'COMPLETED') fail(`مشروع مكتمل فيه مهمة غير مكتملة «${t.title}».`);
  }
}

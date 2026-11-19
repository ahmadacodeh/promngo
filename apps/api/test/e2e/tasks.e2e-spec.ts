import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';
import { auditTypes, specializationIds, workFixture, type WorkFixture } from '../helpers/work.js';

let t: TestApp;
let f: WorkFixture;
let projectId: string;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await closeTestPool();
});
beforeEach(async () => {
  await resetDb();
  f = await workFixture(t);
  projectId = (await f.project()).id;
});

const ids = (res: { body: { items: Array<{ id: string }> } }): string[] => res.body.items.map((i) => i.id);

describe('إنشاء المهام', () => {
  it('المدير ينشئ مهمة رئيسية: PLANNED، أولوية MEDIUM افتراضيًا، وتُسجَّل الحادثة', async () => {
    for (const who of [f.api.exec, f.api.pm]) {
      const res = await who.post(`/projects/${projectId}/tasks`, { title: '  تصميم الواجهة  ', description: 'وصف' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        title: 'تصميم الواجهة', status: 'PLANNED', priority: 'MEDIUM', dueDate: null, isOverdue: false, isRequired: true,
        parentTaskId: null, needsReview: false, archivedAt: null, assignedTo: null, reviewer: null, subtasks: [], predecessors: [], successors: [],
      });
      expect(res.body.project).toMatchObject({ id: projectId, status: 'PLANNED' });
      expect(res.body.createdBy.id).toBe(who.user.id);
      expect(await auditTypes(`task_id = $1`, [res.body.id])).toEqual(['TASK_CREATED']);
    }
  });

  it('الأولوية وتاريخ الاستحقاق والتعيينات تُحفظ كما أُرسلت', async () => {
    const res = await f.api.pm.post(`/projects/${projectId}/tasks`, {
      title: 'عاجلة', priority: 'URGENT', dueDate: '2030-01-15', assignedToId: f.users.e1.id, reviewerId: f.users.sm1.id, assignedManagerId: f.users.sm2.id,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ priority: 'URGENT', dueDate: '2030-01-15', isOverdue: false });
    expect(res.body.assignedTo.id).toBe(f.users.e1.id);
    expect(res.body.reviewer.id).toBe(f.users.sm1.id);
    expect(res.body.assignedManager.id).toBe(f.users.sm2.id);
  });

  it('تاريخ ماضٍ ← isOverdue = true', async () => {
    const res = await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'قديمة', dueDate: '2020-01-01' });
    expect(res.body.isOverdue).toBe(true);
  });

  it.each(['sm1', 'e1'] as const)('الدور %s لا ينشئ مهمة رئيسية (403)', async (k) => {
    expect((await f.api[k].post(`/projects/${projectId}/tasks`, { title: 'x' })).status).toBe(403);
  });

  it('التحقق: العنوان مطلوب، الأولوية والتاريخ صالحان، لا حقول غريبة، ومشروع مجهول ← 404', async () => {
    const noTitle = await f.api.pm.post(`/projects/${projectId}/tasks`, {});
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.fields.title).toMatch(/[؀-ۿ]/);
    expect((await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', priority: 'CRITICAL' })).body.fields.priority).toBeTruthy();
    expect((await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', dueDate: '2026-13-01' })).body.fields.dueDate).toBeTruthy();
    expect((await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', status: 'COMPLETED' })).status).toBe(400);
    expect((await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', companyId: 'z' })).status).toBe(400);
    expect((await f.api.pm.post(`/projects/00000000-0000-4000-8000-000000000000/tasks`, { title: 'x' })).status).toBe(404);
  });

  it('الأشخاص: المراجع مدير مختص فقط وليس المكلّف، والمدير المختص بدوره، والمستخدم من شركتك ونشط', async () => {
    const asReviewer = await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', reviewerId: f.users.e2.id });
    expect(asReviewer.status).toBe(409);
    expect(asReviewer.body.code).toBe('REVIEWER_NOT_ELIGIBLE');

    const self = await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', assignedToId: f.users.sm1.id, reviewerId: f.users.sm1.id });
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('REVIEWER_NOT_ELIGIBLE');

    const empManager = await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', assignedManagerId: f.users.e2.id });
    expect(empManager.status).toBe(400);
    expect(empManager.body.fields.assignedManagerId).toBeTruthy();

    const co = await createCompany();
    const foreign = await createUser({ companyId: co.id, role: 'EMPLOYEE' });
    const cross = await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', assignedToId: foreign.id });
    expect(cross.status).toBe(400);
    expect(cross.body.fields.assignedToId).toBeTruthy();

    await q(`UPDATE users SET is_active = FALSE WHERE id = $1`, [f.users.e3.id]);
    const inactive = await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', assignedToId: f.users.e3.id });
    expect(inactive.status).toBe(400);
  });

  it('تخصص المكلّف يجب أن يطابق تخصص المهمة (SPECIALIZATION_MISMATCH)', async () => {
    const [a, b] = await specializationIds();
    await q(`UPDATE users SET specialization_id = $2 WHERE id = $1`, [f.users.e1.id, a]);
    const bad = await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', specializationId: b, assignedToId: f.users.e1.id });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('SPECIALIZATION_MISMATCH');
    const ok = await f.api.pm.post(`/projects/${projectId}/tasks`, { title: 'x', specializationId: a, assignedToId: f.users.e1.id });
    expect(ok.status).toBe(201);
    expect(ok.body.specialization.id).toBe(a);
  });
});

describe('الرؤية والعزل', () => {
  it('الموظف يرى مهامه فقط؛ المراجع والمدير المختص المعيّن يريانها؛ غيرهم 404', async () => {
    const mine = await f.task(projectId, { assignedToId: f.users.e1.id, reviewerId: f.users.sm1.id, assignedManagerId: f.users.sm2.id });
    const other = await f.task(projectId);
    for (const k of ['e1', 'sm1', 'sm2', 'pm', 'exec'] as const) expect((await f.api[k].get(`/tasks/${mine.id}`)).status, k).toBe(200);
    for (const k of ['e2', 'e3'] as const) expect((await f.api[k].get(`/tasks/${mine.id}`)).status, k).toBe(404);
    expect((await f.api.e1.get(`/tasks/${other.id}`)).status).toBe(404);
    expect(ids(await f.api.e1.get('/tasks'))).toEqual([mine.id]);
    expect(ids(await f.api.sm2.get('/tasks'))).toEqual([mine.id]);
    expect((await f.api.pm.get('/tasks')).body.total).toBe(2);
  });

  it('مهمة شركة أخرى ← 404 للقراءة والتعديل والانتقال والأرشفة والأحداث، ولا تظهر في القوائم', async () => {
    const co = await createCompany();
    const foreignMgr = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    await q(`UPDATE users SET can_create_projects = TRUE, must_change_password = FALSE WHERE id = $1`, [foreignMgr.id]);
    const { apiAs } = await import('../helpers/work.js');
    const fx = await apiAs(t, foreignMgr);
    const fp = (await fx.post('/projects', { name: 'سري' })).body;
    const ft = (await fx.post(`/projects/${fp.id}/tasks`, { title: 'سرية' })).body;

    expect((await f.api.exec.get(`/tasks/${ft.id}`)).status).toBe(404);
    expect((await f.api.exec.patch(`/tasks/${ft.id}`, { title: 'x' })).status).toBe(404);
    expect((await f.api.exec.post(`/tasks/${ft.id}/transitions`, { to: 'BLOCKED' })).status).toBe(404);
    expect((await f.api.exec.post(`/tasks/${ft.id}/archive`)).status).toBe(404);
    expect((await f.api.exec.get(`/tasks/${ft.id}/events`)).status).toBe(404);
    expect((await f.api.exec.get(`/projects/${fp.id}/tasks`)).status).toBe(404);
    expect((await f.api.exec.post(`/projects/${fp.id}/tasks`, { title: 'x' })).status).toBe(404);
    expect((await f.api.exec.get('/tasks')).body.total).toBe(0);
  });

  it('مهمة بمعرّف من مشروع آخر في الشركة نفسها لا تُنشأ فرعية عبر مشروع خاطئ (404)', async () => {
    const other = await f.project();
    const parent = await f.task(projectId);
    expect((await f.api.pm.post(`/projects/${other.id}/tasks/${parent.id}/subtasks`, { title: 'x' })).status).toBe(404);
  });
});

describe('GET /tasks — القائمة والفرز', () => {
  it('scope=mine يعيد ما كُلّفت به، وscope=review ما أنا مراجعه وهو UNDER_REVIEW فقط', async () => {
    const a = await f.task(projectId, { assignedToId: f.users.e1.id, reviewerId: f.users.sm1.id });
    const b = await f.task(projectId, { assignedToId: f.users.e2.id, reviewerId: f.users.sm1.id });
    await f.task(projectId);
    expect(ids(await f.api.e1.get('/tasks?scope=mine'))).toEqual([a.id]);
    expect(ids(await f.api.sm1.get('/tasks?scope=review'))).toEqual([]);
    await q(`UPDATE tasks SET status = 'UNDER_REVIEW' WHERE id = $1`, [b.id]);
    expect(ids(await f.api.sm1.get('/tasks?scope=review'))).toEqual([b.id]);
    expect(ids(await f.api.sm1.get('/tasks?scope=all')).sort()).toEqual([a.id, b.id].sort());
  });

  it('الفلترة بالحالة والأولوية (قوائم مفصولة بفواصل) والتأخر وparentOnly والبحث', async () => {
    const urgent = await f.task(projectId, { title: 'نشر الإصدار', priority: 'URGENT' });
    const high = await f.task(projectId, { title: 'مراجعة الشيفرة', priority: 'HIGH', dueDate: '2020-01-01' });
    const low = await f.task(projectId, { title: 'تنظيف', priority: 'LOW' });
    await f.api.pm.post(`/projects/${projectId}/tasks/${urgent.id}/subtasks`, { title: 'فرعية' });
    await q(`UPDATE tasks SET status = 'BLOCKED' WHERE id = $1`, [low.id]);

    expect(ids(await f.api.pm.get('/tasks?priority=URGENT,HIGH&parentOnly=true')).sort()).toEqual([urgent.id, high.id].sort());
    expect(ids(await f.api.pm.get('/tasks?status=BLOCKED'))).toEqual([low.id]);
    expect(ids(await f.api.pm.get('/tasks?overdue=true'))).toEqual([high.id]);
    expect(ids(await f.api.pm.get('/tasks?q=الإصدار'))).toEqual([urgent.id]);
    expect((await f.api.pm.get('/tasks?q=%25')).body.total).toBe(0);
    expect((await f.api.pm.get('/tasks?parentOnly=true')).body.total).toBe(3);
    expect((await f.api.pm.get('/tasks')).body.total).toBe(4);
  });

  it('الفرز بالأولوية: الأعلى أولًا عند desc والأدنى عند asc', async () => {
    const mk = (priority: string) => f.task(projectId, { title: priority, priority });
    const [l, m, h, u] = [await mk('LOW'), await mk('MEDIUM'), await mk('HIGH'), await mk('URGENT')];
    expect(ids(await f.api.pm.get('/tasks?sort=priority&order=desc'))).toEqual([u.id, h.id, m.id, l.id]);
    expect(ids(await f.api.pm.get('/tasks?sort=priority&order=asc'))).toEqual([l.id, m.id, h.id, u.id]);
  });

  it('الفرز بتاريخ الاستحقاق: الأقرب أولًا وبلا تاريخ في النهاية في الاتجاهين', async () => {
    const late = await f.task(projectId, { dueDate: '2030-06-01' });
    const soon = await f.task(projectId, { dueDate: '2030-01-01' });
    const none = await f.task(projectId);
    expect(ids(await f.api.pm.get('/tasks?sort=dueDate&order=asc'))).toEqual([soon.id, late.id, none.id]);
    expect(ids(await f.api.pm.get('/tasks?sort=dueDate&order=desc'))).toEqual([late.id, soon.id, none.id]);
  });

  it('الفرز بالعنوان والحالة، وقيمة فرز غير معروفة ← 400', async () => {
    const b = await f.task(projectId, { title: 'ب' });
    const a = await f.task(projectId, { title: 'أ' });
    expect(ids(await f.api.pm.get('/tasks?sort=title&order=asc'))).toEqual([a.id, b.id]);
    await q(`UPDATE tasks SET status = 'BLOCKED' WHERE id = $1`, [a.id]);
    expect(ids(await f.api.pm.get('/tasks?sort=status&order=asc'))).toEqual([b.id, a.id]);
    expect((await f.api.pm.get('/tasks?sort=password')).status).toBe(400);
    expect((await f.api.pm.get('/tasks?priority=NOPE')).status).toBe(400);
  });

  it('قائمة المشروع تُقيَّد بالمشروع، والمؤرشف مخفي ما لم يُطلب', async () => {
    const other = await f.project();
    const inA = await f.task(projectId);
    const parent = await f.task(projectId);
    const sub = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 'فرعية' })).body;
    await f.task(other.id);
    await f.api.pm.post(`/tasks/${sub.id}/archive`);
    expect(ids(await f.api.pm.get(`/projects/${projectId}/tasks`)).sort()).toEqual([inA.id, parent.id].sort());
    expect(ids(await f.api.pm.get(`/projects/${projectId}/tasks?includeArchived=true`))).toContain(sub.id);
  });

  it('عدّادات الفرعيات في عنصر القائمة', async () => {
    const parent = await f.task(projectId);
    const s1 = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's1' })).body;
    await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's2' });
    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [s1.id]);
    const item = (await f.api.pm.get('/tasks?parentOnly=true')).body.items[0];
    expect(item).toMatchObject({ id: parent.id, subtaskCount: 2, completedSubtaskCount: 1, projectName: expect.any(String) });
  });
});

describe('GET /tasks/:id — القدرات can وallowedNext', () => {
  it('المدير: يعدّل ويُسند؛ بلا أشخاص لا يُعرض ASSIGNED بل BLOCKED فقط', async () => {
    const task = await f.task(projectId);
    const d = (await f.api.pm.get(`/tasks/${task.id}`)).body;
    expect(d.can).toMatchObject({ edit: true, assign: true, start: false, submit: false, review: false, manageDependencies: true, createSubtask: true, archive: false, delete: false });
    expect(d.allowedNext).toEqual(['BLOCKED']);
  });

  it('مع المكلّف والمراجع يُعرض ASSIGNED، والمكلّف يرى start بعد الإسناد', async () => {
    const task = await f.assignedTask(projectId);
    const pm = (await f.api.pm.get(`/tasks/${task.id}`)).body;
    expect(pm.allowedNext).toEqual([]);
    const e1 = (await f.api.e1.get(`/tasks/${task.id}`)).body;
    expect(e1.can).toMatchObject({ start: true, edit: false, assign: false, submit: false, createSubtask: false });
    expect(e1.allowedNext).toEqual(['IN_PROGRESS']);
    const sm2 = (await f.api.sm2.get(`/tasks/${task.id}`)).body;
    expect(sm2.can).toMatchObject({ assign: true, edit: false, createSubtask: true });
  });
});

describe('PATCH /tasks/:id', () => {
  it('المدير يعدّل الحقول ويمسح الاستحقاق بـ null، وتُسجَّل الحقول المتغيّرة', async () => {
    const task = await f.task(projectId, { dueDate: '2030-01-01' });
    const res = await f.api.pm.patch(`/tasks/${task.id}`, { title: 'جديد', priority: 'HIGH', dueDate: null, description: null, isRequired: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'جديد', priority: 'HIGH', dueDate: null, description: null, isRequired: false });
    const [ev] = await q(`SELECT meta FROM audit_events WHERE task_id = $1 AND type = 'TASK_UPDATED'`, [task.id]);
    expect(ev.meta.fields.sort()).toEqual(['description', 'dueDate', 'isRequired', 'priority', 'title']);
  });

  it('المدير المختص المعيّن يغيّر المكلّف والمراجع فقط؛ تعديل العنوان ← 403', async () => {
    const task = await f.task(projectId, { assignedManagerId: f.users.sm2.id });
    const people = await f.api.sm2.patch(`/tasks/${task.id}`, { assignedToId: f.users.e2.id, reviewerId: f.users.sm1.id });
    expect(people.status).toBe(200);
    expect(people.body.assignedTo.id).toBe(f.users.e2.id);
    expect((await f.api.sm2.patch(`/tasks/${task.id}`, { title: 'x' })).status).toBe(403);
    expect((await f.api.sm2.patch(`/tasks/${task.id}`, { title: 'x', assignedToId: f.users.e3.id })).status).toBe(403);
  });

  it('الموظف والمراجع غير المعيّن مديرًا لا يعدّلان (403) وجسم فارغ ← 400', async () => {
    const task = await f.assignedTask(projectId);
    expect((await f.api.e1.patch(`/tasks/${task.id}`, { title: 'x' })).status).toBe(403);
    expect((await f.api.sm1.patch(`/tasks/${task.id}`, { reviewerId: f.users.sm2.id })).status).toBe(403);
    expect((await f.api.pm.patch(`/tasks/${task.id}`, {})).status).toBe(400);
  });

  it('تغيير المكلّف بعد بدء التنفيذ ← 409 STATE_CONFLICT، وتعديل المكتملة ← 409', async () => {
    const task = await f.startedTask(projectId);
    const res = await f.api.pm.patch(`/tasks/${task.id}`, { assignedToId: f.users.e2.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STATE_CONFLICT');
    expect((await f.api.pm.patch(`/tasks/${task.id}`, { priority: 'LOW' })).status).toBe(200); // حقول أخرى مسموحة أثناء التنفيذ
    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [task.id]);
    expect((await f.api.pm.patch(`/tasks/${task.id}`, { title: 'x' })).status).toBe(409);
  });

  it('المراجع يجب أن يبقى مؤهلًا بعد التعديل (لا مكلّف = مراجع)', async () => {
    const task = await f.task(projectId, { assignedToId: f.users.sm2.id, reviewerId: f.users.sm1.id });
    const bad = await f.api.pm.patch(`/tasks/${task.id}`, { reviewerId: f.users.sm2.id });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('REVIEWER_NOT_ELIGIBLE');
    const bad2 = await f.api.pm.patch(`/tasks/${task.id}`, { assignedToId: f.users.sm1.id });
    expect(bad2.status).toBe(409);
  });

  it('مشروع مغلق ← PROJECT_CLOSED', async () => {
    const task = await f.task(projectId);
    await f.api.pm.patch(`/projects/${projectId}`, { status: 'CANCELLED' });
    const res = await f.api.pm.patch(`/tasks/${task.id}`, { title: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_CLOSED');
  });
});

describe('POST /tasks/:id/transitions', () => {
  it('الإسناد يتطلب مكلّفًا ومراجعًا: 409 STATE_CONFLICT مع details.missing', async () => {
    const task = await f.task(projectId, { assignedToId: f.users.e1.id });
    const res = await f.api.pm.post(`/tasks/${task.id}/transitions`, { to: 'ASSIGNED' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STATE_CONFLICT');
    expect(res.body.details.missing).toEqual(['reviewerId']);
    expect(res.body.fields.reviewerId).toBeTruthy();
  });

  it('PLANNED→BLOCKED→ASSIGNED→IN_PROGRESS وتُسجَّل كل حادثة بالفاعل والحالتين', async () => {
    const task = await f.task(projectId, { assignedToId: f.users.e1.id, reviewerId: f.users.sm1.id });
    expect((await f.api.pm.post(`/tasks/${task.id}/transitions`, { to: 'BLOCKED', reason: 'ننتظر العميل' })).body.status).toBe('BLOCKED');
    expect((await f.api.pm.post(`/tasks/${task.id}/transitions`, { to: 'ASSIGNED' })).body.status).toBe('ASSIGNED');
    expect((await f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' })).body.status).toBe('IN_PROGRESS');
    const events = (await f.api.pm.get(`/tasks/${task.id}/events`)).body;
    expect(events.map((e: any) => [e.type, e.fromStatus, e.toStatus])).toEqual([
      ['TASK_CREATED', null, 'PLANNED'],
      ['TASK_STATUS_CHANGED', 'PLANNED', 'BLOCKED'],
      ['TASK_STATUS_CHANGED', 'BLOCKED', 'ASSIGNED'],
      ['TASK_STATUS_CHANGED', 'ASSIGNED', 'IN_PROGRESS'],
    ]);
    expect(events[1].meta).toEqual({ reason: 'ننتظر العميل' });
    expect(events[3].actor.id).toBe(f.users.e1.id);
  });

  it.each([
    ['PLANNED', 'COMPLETED'], ['PLANNED', 'IN_PROGRESS'], ['ASSIGNED', 'SUBMITTED'], ['IN_PROGRESS', 'SUBMITTED'],
    ['IN_PROGRESS', 'COMPLETED'], ['UNDER_REVIEW', 'COMPLETED'], ['COMPLETED', 'PLANNED'], ['ASSIGNED', 'PLANNED'],
  ])('الانتقال %s→%s مرفوض 409 INVALID_TRANSITION ولا تتغير الحالة', async (from, to) => {
    const task = await f.assignedTask(projectId);
    await q(`UPDATE tasks SET status = $2 WHERE id = $1`, [task.id, from]);
    const res = await f.api.pm.post(`/tasks/${task.id}/transitions`, { to });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
    expect((await q(`SELECT status FROM tasks WHERE id = $1`, [task.id]))[0].status).toBe(from);
  });

  it('حالة غير معروفة ← 400', async () => {
    const task = await f.task(projectId);
    expect((await f.api.pm.post(`/tasks/${task.id}/transitions`, { to: 'DONE' })).status).toBe(400);
  });

  it('الصلاحيات: الموظف لا يُسند (403) ولا يبدأ مهمة غيره (404)، والمدير المختص المعيّن يُسند، وغير المكلّف لا يبدأ', async () => {
    const task = await f.task(projectId, { assignedToId: f.users.e1.id, reviewerId: f.users.sm1.id, assignedManagerId: f.users.sm2.id });
    expect((await f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'ASSIGNED' })).status).toBe(403);
    expect((await f.api.e2.post(`/tasks/${task.id}/transitions`, { to: 'ASSIGNED' })).status).toBe(404);
    expect((await f.api.sm1.post(`/tasks/${task.id}/transitions`, { to: 'ASSIGNED' })).status).toBe(403); // مراجع لا مدير معيّن
    expect((await f.api.sm2.post(`/tasks/${task.id}/transitions`, { to: 'ASSIGNED' })).status).toBe(200);
    expect((await f.api.pm.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(403); // المدير لا يبدأ بدل المكلّف
    expect((await f.api.sm2.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(403);
    expect((await f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(200);
  });

  it('ترتيب الأخطاء: انتقال غير صالح يسبق الصلاحية (الموظف يتلقى 409 لا 403 على انتقال مستحيل)', async () => {
    const task = await f.assignedTask(projectId);
    const res = await f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'COMPLETED' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('المشروع المغلق ← PROJECT_CLOSED، والمؤرشفة ← 409', async () => {
    const task = await f.task(projectId, { assignedToId: f.users.e1.id, reviewerId: f.users.sm1.id });
    await f.api.pm.patch(`/projects/${projectId}`, { status: 'CANCELLED' });
    const res = await f.api.pm.post(`/tasks/${task.id}/transitions`, { to: 'ASSIGNED' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_CLOSED');
  });

  it('التزامن: طلبا بدء متوازيان ينجح أحدهما فقط ويُسجَّل حدث واحد', async () => {
    const task = await f.assignedTask(projectId);
    const [a, b] = await Promise.all([
      f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' }),
      f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM audit_events WHERE task_id = $1 AND to_status = 'IN_PROGRESS'`, [task.id]);
    expect(n).toBe(1);
  });

  it('بدء مهمة لها سابقة غير مكتملة ← 409 DEPENDENCIES_NOT_ACCEPTED مع details.blockedBy، وتنجح بعد اكتمال السابقة', async () => {
    const pred = await f.task(projectId, { title: 'السابقة' });
    const succ = await f.assignedTask(projectId, { title: 'اللاحقة' });
    expect((await f.api.pm.post(`/projects/${projectId}/dependencies`, { predecessorTaskId: pred.id, successorTaskId: succ.id })).status).toBe(201);
    const blocked = await f.api.e1.post(`/tasks/${succ.id}/transitions`, { to: 'IN_PROGRESS' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('DEPENDENCIES_NOT_ACCEPTED');
    expect(blocked.body.details.blockedBy).toEqual([{ id: pred.id, title: 'السابقة', status: 'PLANNED' }]);
    const detail = (await f.api.e1.get(`/tasks/${succ.id}`)).body;
    expect(detail.allowedNext).toEqual([]); // لا يُعرض زر بدء مستحيل
    expect(detail.blockedBy).toHaveLength(1);

    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [pred.id]);
    expect((await f.api.e1.post(`/tasks/${succ.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(200);
  });

  it('السابقة المؤرشفة لا تحجب البدء', async () => {
    const parent = await f.task(projectId);
    const pred = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 'سابقة فرعية' })).body;
    const succ = await f.assignedTask(projectId);
    await f.api.pm.post(`/projects/${projectId}/dependencies`, { predecessorTaskId: pred.id, successorTaskId: succ.id });
    expect((await f.api.e1.post(`/tasks/${succ.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(409);
    await q(`UPDATE tasks SET archived_at = NOW() WHERE id = $1`, [pred.id]);
    expect((await f.api.e1.post(`/tasks/${succ.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(200);
  });
});

describe('المهام الفرعية', () => {
  it('المدير والمدير المختص المعيّن ينشئان فرعية؛ الموظف والمراجع غير المعيّن لا (403)', async () => {
    const parent = await f.task(projectId, { assignedManagerId: f.users.sm2.id, reviewerId: f.users.sm1.id, assignedToId: f.users.e1.id });
    const url = `/projects/${projectId}/tasks/${parent.id}/subtasks`;
    const byPm = await f.api.pm.post(url, { title: 'فرعية ١', priority: 'HIGH' });
    expect(byPm.status).toBe(201);
    expect(byPm.body).toMatchObject({ parentTaskId: parent.id, status: 'PLANNED', priority: 'HIGH' });
    expect((await f.api.sm2.post(url, { title: 'فرعية ٢' })).status).toBe(201);
    expect((await f.api.e1.post(url, { title: 'x' })).status).toBe(403);
    expect((await f.api.sm1.post(url, { title: 'x' })).status).toBe(403);
    expect((await f.api.e3.post(url, { title: 'x' })).status).toBe(404);
    const detail = (await f.api.pm.get(`/tasks/${parent.id}`)).body;
    expect(detail.subtasks).toHaveLength(2);
    expect((await f.api.pm.get(`/tasks/${byPm.body.id}`)).body.parent).toEqual({ id: parent.id, title: parent.title });
  });

  it('العمق مستوى واحد (SUBTASK_DEPTH) ولا فرعية لمهمة مكتملة', async () => {
    const parent = await f.task(projectId);
    const sub = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's' })).body;
    const deep = await f.api.pm.post(`/projects/${projectId}/tasks/${sub.id}/subtasks`, { title: 'x' });
    expect(deep.status).toBe(409);
    expect(deep.body.code).toBe('SUBTASK_DEPTH');
    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [parent.id]);
    expect((await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 'x' })).status).toBe(409);
  });

  it('الرئيسية محمية من الأرشفة والحذف (MAIN_TASK_PROTECTED)', async () => {
    const parent = await f.task(projectId);
    for (const res of [await f.api.pm.post(`/tasks/${parent.id}/archive`), await f.api.pm.del(`/tasks/${parent.id}`)]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MAIN_TASK_PROTECTED');
    }
  });

  it('حذف فرعية PLANNED ← 204 ويبقى حدثها في السجل بلا ربط؛ وحذف فرعية بدأت ← 409', async () => {
    const parent = await f.task(projectId);
    const sub = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's' })).body;
    expect((await f.api.pm.del(`/tasks/${sub.id}`)).status).toBe(204);
    expect((await f.api.pm.get(`/tasks/${sub.id}`)).status).toBe(404);
    const rows = await q(`SELECT type, task_id FROM audit_events WHERE entity_id = $1 ORDER BY created_at, id`, [sub.id]);
    expect(rows.map((r) => r.type)).toEqual(['TASK_CREATED', 'TASK_DELETED']);
    expect(rows.every((r) => r.task_id === null)).toBe(true);

    const started = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's2', assignedToId: f.users.e1.id, reviewerId: f.users.sm1.id })).body;
    await f.api.pm.post(`/tasks/${started.id}/transitions`, { to: 'ASSIGNED' });
    expect((await f.api.pm.del(`/tasks/${started.id}`)).status).toBe(409);
  });

  it('حذف فرعية مرتبطة باعتمادية ← 409 (أرشِفها بدلًا)', async () => {
    const parent = await f.task(projectId);
    const sub = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's' })).body;
    const other = await f.task(projectId);
    await f.api.pm.post(`/projects/${projectId}/dependencies`, { predecessorTaskId: other.id, successorTaskId: sub.id });
    const res = await f.api.pm.del(`/tasks/${sub.id}`);
    expect(res.status).toBe(409);
    expect(res.body.hint).toContain('أرشِف');
  });

  it('الأرشفة: المدير والمدير المختص المعيّن على الفرعية فقط، وتختفي من القائمة والتفاصيل الأم', async () => {
    const parent = await f.task(projectId);
    const sub = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's', assignedManagerId: f.users.sm2.id, assignedToId: f.users.e1.id })).body;
    expect((await f.api.e1.post(`/tasks/${sub.id}/archive`)).status).toBe(403);
    expect((await f.api.sm1.post(`/tasks/${sub.id}/archive`)).status).toBe(404); // لا يراها
    const res = await f.api.sm2.post(`/tasks/${sub.id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).toEqual(expect.any(String));
    expect((await f.api.pm.get(`/tasks/${parent.id}`)).body.subtasks).toHaveLength(0);
    expect((await f.api.pm.post(`/tasks/${sub.id}/archive`)).status).toBe(409); // مؤرشفة بالفعل
  });
});

describe('تعليم اللاحقات للمراجعة (FR-010)', () => {
  it('تعديل محتوى سابقة يعلّم اللاحقات التي بدأت فقط ويسجّل DEPENDENCY_PREDECESSOR_CHANGED', async () => {
    const pred = await f.task(projectId, { title: 'سابقة' });
    const started = await f.startedTask(projectId, { title: 'بدأت' });
    const notStarted = await f.assignedTask(projectId, { title: 'لم تبدأ' });
    for (const s of [started, notStarted]) await q(`INSERT INTO task_dependencies (company_id, project_id, predecessor_task_id, successor_task_id, created_by) VALUES ($1, $2, $3, $4, $5)`, [f.company.id, projectId, pred.id, s.id, f.users.pm.id]);

    expect((await f.api.pm.patch(`/tasks/${pred.id}`, { priority: 'LOW' })).status).toBe(200);
    expect((await f.api.pm.get(`/tasks/${started.id}`)).body.needsReview).toBe(false); // الأولوية ليست محتوى

    expect((await f.api.pm.patch(`/tasks/${pred.id}`, { title: 'سابقة معدّلة' })).status).toBe(200);
    expect((await f.api.pm.get(`/tasks/${started.id}`)).body.needsReview).toBe(true);
    expect((await f.api.pm.get(`/tasks/${notStarted.id}`)).body.needsReview).toBe(false);
    expect(await auditTypes(`task_id = $1 AND type = 'DEPENDENCY_PREDECESSOR_CHANGED'`, [started.id])).toEqual(['DEPENDENCY_PREDECESSOR_CHANGED']);
    expect((await f.api.pm.get('/tasks?needsReview=true')).body.items.map((i: any) => i.id)).toEqual([started.id]);
  });

  it('مسح العلامة: المدير والمدير المختص المعيّن فقط، ومرة ثانية بلا أثر', async () => {
    const task = await f.startedTask(projectId, { assignedManagerId: f.users.sm2.id });
    await q(`UPDATE tasks SET needs_review = TRUE WHERE id = $1`, [task.id]);
    expect((await f.api.e1.post(`/tasks/${task.id}/clear-review-flag`)).status).toBe(403);
    expect((await f.api.sm1.post(`/tasks/${task.id}/clear-review-flag`)).status).toBe(403);
    const ok = await f.api.sm2.post(`/tasks/${task.id}/clear-review-flag`);
    expect(ok.status).toBe(200);
    expect(ok.body.needsReview).toBe(false);
    expect((await f.api.sm2.post(`/tasks/${task.id}/clear-review-flag`)).status).toBe(200);
    expect(await auditTypes(`task_id = $1 AND type = 'REVIEW_FLAG_CLEARED'`, [task.id])).toHaveLength(1);
  });
});

describe('GET /tasks/:id/events', () => {
  it('يعيد السجل من الأقدم للأحدث لمن يرى المهمة، ولا يُظهر أسرارًا', async () => {
    const task = await f.assignedTask(projectId);
    const res = await f.api.e1.get(`/tasks/${task.id}/events`);
    expect(res.status).toBe(200);
    expect(res.body.map((e: any) => e.type)).toEqual(['TASK_CREATED', 'TASK_STATUS_CHANGED']);
    expect(JSON.stringify(res.body)).not.toMatch(/password|token|secret|hash/i);
    expect((await f.api.e2.get(`/tasks/${task.id}/events`)).status).toBe(404);
  });
});

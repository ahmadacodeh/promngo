import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';
import { apiAs, auditTypes, workFixture, type WorkFixture } from '../helpers/work.js';

let t: TestApp;
let f: WorkFixture;
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
});

describe('POST /projects', () => {
  it('المدير التنفيذي ومدير المشروع (مع canCreateProjects) ينشئان مشروعًا بحالة PLANNED وتُسجَّل الحادثة', async () => {
    for (const who of [f.api.exec, f.api.pm]) {
      const res = await who.post('/projects', { name: '  مشروع جديد  ', description: 'وصف', startDate: '2026-12-01', dueDate: '2026-12-31' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'مشروع جديد', status: 'PLANNED', startDate: '2026-12-01', dueDate: '2026-12-31', progressPct: null, overdueCount: 0,
        taskCounts: { total: 0 }, allowedNextStatuses: ['ACTIVE', 'CANCELLED'],
      });
      expect(res.body.createdBy).toMatchObject({ id: who.user.id });
      expect(await auditTypes(`entity = 'PROJECT' AND entity_id = $1`, [res.body.id])).toEqual(['PROJECT_CREATED']);
    }
  });

  it('الدور وحده لا يكفي: مدير مشروع بلا canCreateProjects يُرفض 403 برسالة عربية', async () => {
    await q(`UPDATE users SET can_create_projects = FALSE WHERE id = $1`, [f.users.pm.id]);
    const res = await f.api.pm.post('/projects', { name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.message).toContain('صلاحية');
  });

  it.each(['sm1', 'e1'] as const)('الدور %s لا ينشئ مشاريع (403) حتى لو مُنح canCreateProjects', async (k) => {
    await q(`UPDATE users SET can_create_projects = TRUE WHERE id = $1`, [f.users[k].id]);
    expect((await f.api[k].post('/projects', { name: 'x' })).status).toBe(403);
  });

  it('التحقق: الاسم مطلوب، والتاريخ التقويمي صحيح، والاستحقاق لا يسبق البداية، ولا حقول غريبة', async () => {
    const noName = await f.api.pm.post('/projects', { description: 'd' });
    expect(noName.status).toBe(400);
    expect(noName.body.fields.name).toBeTruthy();

    const badDate = await f.api.pm.post('/projects', { name: 'x', dueDate: '2026-02-30' });
    expect(badDate.status).toBe(400);
    expect(badDate.body.fields.dueDate).toBeTruthy();

    const order = await f.api.pm.post('/projects', { name: 'x', startDate: '2026-05-02', dueDate: '2026-05-01' });
    expect(order.status).toBe(400);
    expect(order.body.fields.dueDate).toContain('البداية');

    expect((await f.api.pm.post('/projects', { name: 'x', companyId: 'abc' })).status).toBe(400);
  });

  it('الشركة تؤخذ من المستخدم لا من الطلب', async () => {
    const other = await createCompany();
    const res = await f.api.pm.post('/projects', { name: 'x', company_id: other.id });
    expect(res.status).toBe(400); // forbidNonWhitelisted
    const [{ n }] = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM projects WHERE company_id = $1`, [other.id]);
    expect(n).toBe(0);
  });
});

describe('الرؤية والعزل', () => {
  it('المدراء يرون كل مشاريع شركتهم؛ الموظف لا يرى إلا مشروعًا فيه مهمة تخصه', async () => {
    const p1 = await f.project({ name: 'مشروع ظاهر' });
    const p2 = await f.project({ name: 'مشروع مخفي' });
    await f.task(p1.id, { assignedToId: f.users.e1.id });
    await f.task(p2.id);

    const mgr = await f.api.pm.get('/projects');
    expect(mgr.body.items.map((p: any) => p.id).sort()).toEqual([p1.id, p2.id].sort());

    const emp = await f.api.e1.get('/projects');
    expect(emp.body.items.map((p: any) => p.id)).toEqual([p1.id]);
    expect((await f.api.e1.get(`/projects/${p2.id}`)).status).toBe(404);
    expect((await f.api.e1.get(`/projects/${p1.id}`)).status).toBe(200);
    expect((await f.api.e2.get(`/projects/${p1.id}`)).status).toBe(404); // موظف بلا مهمة فيه
  });

  it('عدّادات الموظف مقيّدة بمهامه فقط (لا تسريب لأعداد ما لا يراه)', async () => {
    const p = await f.project();
    await f.task(p.id, { assignedToId: f.users.e1.id });
    await f.task(p.id);
    await f.task(p.id);
    expect((await f.api.pm.get(`/projects/${p.id}`)).body.taskCounts.total).toBe(3);
    expect((await f.api.e1.get(`/projects/${p.id}`)).body.taskCounts.total).toBe(1);
  });

  it('مشروع شركة أخرى ← 404 للقراءة والتعديل، ولا يظهر في القائمة', async () => {
    const co = await createCompany();
    const foreign = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    await q(`UPDATE users SET can_create_projects = TRUE WHERE id = $1`, [foreign.id]);
    const fx = await apiAs(t, foreign);
    const theirs = (await fx.post('/projects', { name: 'سري' })).body;

    expect((await f.api.exec.get(`/projects/${theirs.id}`)).status).toBe(404);
    expect((await f.api.exec.patch(`/projects/${theirs.id}`, { name: 'اختراق' })).status).toBe(404);
    expect((await f.api.exec.get('/projects')).body.items).toHaveLength(0);
    expect((await fx.get(`/projects/${theirs.id}`)).body.name).toBe('سري');
  });

  it('معرّف غير صالح ← 404 (لا 500)', async () => {
    expect((await f.api.pm.get('/projects/not-a-uuid')).status).toBe(404);
  });
});

describe('PATCH /projects/:id — الحالة', () => {
  it('الانتقال المسموح يعمل ويُسجَّل، وغير المسموح ← 409 INVALID_PROJECT_TRANSITION مع الخيارات', async () => {
    const p = await f.project();
    const ok = await f.api.pm.patch(`/projects/${p.id}`, { status: 'ACTIVE' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ACTIVE');
    expect(ok.body.allowedNextStatuses).toEqual(['ON_HOLD', 'COMPLETED', 'CANCELLED']);
    expect(await auditTypes(`entity = 'PROJECT' AND entity_id = $1`, [p.id])).toEqual(['PROJECT_CREATED', 'PROJECT_STATUS_CHANGED']);

    const bad = await f.api.pm.patch(`/projects/${p.id}`, { status: 'PLANNED' });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('INVALID_PROJECT_TRANSITION');
    expect(bad.body.details.allowed).toEqual(['ON_HOLD', 'COMPLETED', 'CANCELLED']);
  });

  it('لا يكتمل المشروع وفيه مهام مفتوحة (PROJECT_HAS_OPEN_TASKS) ويكتمل حين تُكمل أو تُؤرشف', async () => {
    const p = await f.project();
    await f.api.pm.patch(`/projects/${p.id}`, { status: 'ACTIVE' });
    const task = await f.task(p.id);
    const blocked = await f.api.pm.patch(`/projects/${p.id}`, { status: 'COMPLETED' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PROJECT_HAS_OPEN_TASKS');
    expect(blocked.body.details.openTasks[0].id).toBe(task.id);

    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [task.id]);
    expect((await f.api.pm.patch(`/projects/${p.id}`, { status: 'COMPLETED' })).status).toBe(200);
  });

  it('المشروع المكتمل/الملغى نهائي: لا انتقال منه ولا تعديل بياناته ولا مهام جديدة (PROJECT_CLOSED)', async () => {
    const p = await f.project();
    await f.api.pm.patch(`/projects/${p.id}`, { status: 'CANCELLED' });
    const edit = await f.api.pm.patch(`/projects/${p.id}`, { name: 'جديد' });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('PROJECT_CLOSED');
    expect((await f.api.pm.patch(`/projects/${p.id}`, { status: 'ACTIVE' })).body.code).toBe('INVALID_PROJECT_TRANSITION');
    const mk = await f.api.pm.post(`/projects/${p.id}/tasks`, { title: 'x' });
    expect(mk.status).toBe(409);
    expect(mk.body.code).toBe('PROJECT_CLOSED');
  });

  it('الموظف والمدير المختص لا يعدّلان المشروع (403) وجسم فارغ ← 400', async () => {
    const p = await f.project();
    await f.task(p.id, { assignedToId: f.users.e1.id });
    expect((await f.api.e1.patch(`/projects/${p.id}`, { name: 'x' })).status).toBe(403);
    expect((await f.api.sm1.patch(`/projects/${p.id}`, { name: 'x' })).status).toBe(403);
    expect((await f.api.pm.patch(`/projects/${p.id}`, {})).status).toBe(400);
  });

  it('تعديل التواريخ يحافظ على الترتيب ويقبل المسح بـ null', async () => {
    const p = await f.project({ startDate: '2026-12-01', dueDate: '2026-12-31' });
    const bad = await f.api.pm.patch(`/projects/${p.id}`, { dueDate: '2026-11-30' });
    expect(bad.status).toBe(400);
    const cleared = await f.api.pm.patch(`/projects/${p.id}`, { dueDate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.dueDate).toBeNull();
    expect(cleared.body.startDate).toBe('2026-12-01');
  });
});

describe('GET /projects — الفرز والتقدم والتأخر', () => {
  it('الفرز بتاريخ الاستحقاق: الأقرب أولًا وبلا تاريخ في النهاية دائمًا', async () => {
    const a = await f.project({ name: 'أ', dueDate: '2026-12-20' });
    const b = await f.project({ name: 'ب', dueDate: '2026-12-05' });
    const c = await f.project({ name: 'ج' });
    const asc = (await f.api.pm.get('/projects?sort=dueDate&order=asc')).body.items.map((p: any) => p.id);
    expect(asc).toEqual([b.id, a.id, c.id]);
    const desc = (await f.api.pm.get('/projects?sort=dueDate&order=desc')).body.items.map((p: any) => p.id);
    expect(desc).toEqual([a.id, b.id, c.id]);
  });

  it('progressPct يحسب المهام الرئيسية المكتملة، وoverdueCount المتأخرة غير المكتملة', async () => {
    const p = await f.project();
    const t1 = await f.task(p.id, { dueDate: '2020-01-01' });
    await f.task(p.id, { dueDate: '2020-01-02' });
    await f.task(p.id);
    await f.task(p.id);
    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [t1.id]);
    const body = (await f.api.pm.get(`/projects/${p.id}`)).body;
    expect(body.progressPct).toBe(25);
    expect(body.overdueCount).toBe(1); // المكتملة لا تُعدّ متأخرة
  });

  it('الفلترة بالحالة والبحث بالاسم والتصفح', async () => {
    const a = await f.project({ name: 'منصة المتجر' });
    await f.project({ name: 'تطبيق الجوال' });
    await f.api.pm.patch(`/projects/${a.id}`, { status: 'ACTIVE' });
    expect((await f.api.pm.get('/projects?status=ACTIVE')).body.items.map((p: any) => p.id)).toEqual([a.id]);
    expect((await f.api.pm.get('/projects?q=المتجر')).body.total).toBe(1);
    expect((await f.api.pm.get('/projects?q=%25')).body.total).toBe(0); // % حرفي لا نمط
    const page = (await f.api.pm.get('/projects?pageSize=1&page=2')).body;
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
  });
});

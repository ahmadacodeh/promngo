import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';
import { apiAs, workFixture, specializationIds, type Api, type WorkFixture } from '../helpers/work.js';

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

const pdfBuf = Buffer.from('%PDF-1.4\n%x');
const submit = (api: Api, taskId: string) => t.http().post(`/tasks/${taskId}/submit`).set(api.raw()).attach('files', pdfBuf, { filename: 'a.pdf' });
/** مهمة تصل إلى الموافقة بعد `changeRounds` طلبات تعديل. */
async function completed(changeRounds = 0, over: Record<string, unknown> = {}) {
  const task = await f.startedTask(projectId, over);
  for (let i = 0; i < changeRounds; i++) {
    expect((await submit(f.api.e1, task.id)).status).toBe(201);
    expect((await f.api.sm1.post(`/tasks/${task.id}/reviews`, { decision: 'CHANGES_REQUESTED', comments: 'عدّل' })).status).toBe(201);
    expect((await f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(200);
  }
  expect((await submit(f.api.e1, task.id)).status).toBe(201);
  expect((await f.api.sm1.post(`/tasks/${task.id}/reviews`, { decision: 'APPROVED' })).status).toBe(201);
  return task;
}
const foreignExec = async () => {
  const co = await createCompany();
  const u = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
  await q(`UPDATE users SET can_create_projects = TRUE, must_change_password = FALSE WHERE id = $1`, [u.id]);
  return { co, api: await apiAs(t, u) };
};

describe('GET /dashboard', () => {
  it('شركة فارغة: أصفار وقوائم فارغة لكل دور (لا أخطاء معاملات)', async () => {
    await resetDb();
    f = await workFixture(t);
    for (const k of ['exec', 'pm', 'sm1', 'sm2', 'e1'] as const) {
      const res = await f.api[k].get('/dashboard');
      expect(res.status, k).toBe(200);
      expect(res.body).toMatchObject({
        role: f.users[k].role, projects: { total: 0, byStatus: {} }, tasks: { total: 0, byStatus: {}, byPriority: {}, overdue: 0 },
        myOpenTasks: 0, awaitingMyReview: 0, flaggedForReview: 0, recentTasks: [], awaitingReviewTasks: [],
      });
    }
  });

  it('المدير: نطاق COMPANY بكل الأرقام (الحالة والأولوية والتأخر) وآخر المهام والمنتظرة للمراجعة', async () => {
    await f.api.pm.patch(`/projects/${projectId}`, { status: 'ACTIVE' });
    await f.project();
    await f.task(projectId, { priority: 'URGENT', dueDate: '2020-01-01' });
    await f.task(projectId, { priority: 'LOW' });
    await f.assignedTask(projectId, { priority: 'HIGH' });
    const review = await f.startedTask(projectId);
    await submit(f.api.e1, review.id);
    const done = await completed();
    await q(`UPDATE tasks SET due_date = '2020-01-01' WHERE id = $1`, [done.id]); // مكتملة متأخرة التاريخ: لا تُعدّ متأخرة

    const d = (await f.api.pm.get('/dashboard')).body;
    expect(d.scope).toBe('COMPANY');
    expect(d.projects).toEqual({ total: 2, byStatus: { ACTIVE: 1, PLANNED: 1 } });
    expect(d.tasks.total).toBe(5);
    expect(d.tasks.byStatus).toEqual({ PLANNED: 2, ASSIGNED: 1, UNDER_REVIEW: 1, COMPLETED: 1 });
    expect(d.tasks.byPriority).toEqual({ URGENT: 1, LOW: 1, HIGH: 1, MEDIUM: 2 });
    expect(d.tasks.overdue).toBe(1);
    expect(d.recentTasks).toHaveLength(5);
    const stamps: string[] = d.recentTasks.map((x: any) => x.updatedAt);
    expect(stamps).toEqual([...stamps].sort((a, b) => b.localeCompare(a)));
    expect(d.awaitingReviewTasks.map((x: any) => x.id)).toEqual([review.id]);
    expect(d.awaitingReviewTasks[0]).toMatchObject({ projectName: expect.any(String), subtaskCount: 0 });
  });

  it('القوائم لا تتجاوز 8 عناصر', async () => {
    for (let i = 0; i < 10; i++) await f.task(projectId);
    expect((await f.api.pm.get('/dashboard')).body.recentTasks).toHaveLength(8);
    expect((await f.api.pm.get('/dashboard')).body.tasks.total).toBe(10);
  });

  it('الموظف: نطاق PERSONAL مقيّد بمهامه، وmyOpenTasks لا تحسب المكتملة', async () => {
    await f.task(projectId); // لا تخصه
    await f.assignedTask(projectId);
    await f.startedTask(projectId);
    await completed();
    await f.task(projectId, { assignedToId: f.users.e2.id });
    const d = (await f.api.e1.get('/dashboard')).body;
    expect(d.scope).toBe('PERSONAL');
    expect(d.tasks.total).toBe(3);
    expect(d.projects.total).toBe(1);
    expect(d.myOpenTasks).toBe(2);
    expect(d.awaitingMyReview).toBe(0);
    expect(d.awaitingReviewTasks).toEqual([]);
    expect(d.recentTasks.every((x: any) => x.assignedTo?.id === f.users.e1.id)).toBe(true);
    expect((await f.api.e3.get('/dashboard')).body.tasks.total).toBe(0);
  });

  it('المراجع: awaitingMyReview ومهامه فقط؛ والمدير المختص المعيّن يرى مهامه دون أن تُحسب له مراجعة', async () => {
    const mine = await f.startedTask(projectId);
    await submit(f.api.e1, mine.id);
    const other = await f.startedTask(projectId, { reviewerId: f.users.sm2.id, assignedManagerId: f.users.sm1.id });
    await submit(f.api.e1, other.id);
    const sm1 = (await f.api.sm1.get('/dashboard')).body;
    expect(sm1.awaitingMyReview).toBe(1);
    expect(sm1.awaitingReviewTasks.map((x: any) => x.id)).toEqual([mine.id]);
    expect(sm1.tasks.total).toBe(2); // يرى الثانية كمدير مختص معيّن
    const sm2 = (await f.api.sm2.get('/dashboard')).body;
    expect(sm2.awaitingReviewTasks.map((x: any) => x.id)).toEqual([other.id]);
  });

  it('المؤرشفة لا تُحسب، والمعلّمة للمراجعة تُحسب في flaggedForReview ضمن الرؤية', async () => {
    const parent = await f.task(projectId);
    const sub = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's', assignedToId: f.users.e1.id })).body;
    await q(`UPDATE tasks SET needs_review = TRUE WHERE id = $1`, [sub.id]);
    expect((await f.api.pm.get('/dashboard')).body.flaggedForReview).toBe(1);
    expect((await f.api.e1.get('/dashboard')).body.flaggedForReview).toBe(1);
    expect((await f.api.e2.get('/dashboard')).body.flaggedForReview).toBe(0);
    await f.api.pm.post(`/tasks/${sub.id}/archive`);
    const d = (await f.api.pm.get('/dashboard')).body;
    expect(d.flaggedForReview).toBe(0);
    expect(d.tasks.total).toBe(1);
  });

  it('عزل الشركات: بيانات شركة أخرى لا تظهر، وبلا مصادقة ← 401', async () => {
    await f.task(projectId);
    const other = await foreignExec();
    const p = (await other.api.post('/projects', { name: 'غريب' })).body;
    await other.api.post(`/projects/${p.id}/tasks`, { title: 'غريبة' });
    expect((await f.api.exec.get('/dashboard')).body.tasks.total).toBe(1);
    expect((await other.api.get('/dashboard')).body.tasks.total).toBe(1);
    expect((await t.http().get('/dashboard')).status).toBe(401);
  });
});

describe('GET /reports/overview', () => {
  it('المدير التنفيذي ومدير المشروع فقط (المدير المختص والموظف 403)', async () => {
    for (const k of ['exec', 'pm'] as const) expect((await f.api[k].get('/reports/overview')).status, k).toBe(200);
    for (const k of ['sm1', 'e1'] as const) expect((await f.api[k].get('/reports/overview')).status, k).toBe(403);
    expect((await t.http().get('/reports/overview')).status).toBe(401);
  });

  it('days: 7 و30 و90 مسموح (الافتراضي 30) وغيرها ← 400', async () => {
    expect((await f.api.pm.get('/reports/overview')).body.period.days).toBe(30);
    for (const d of [7, 30, 90]) expect((await f.api.pm.get(`/reports/overview?days=${d}`)).body.period.days).toBe(d);
    for (const d of ['15', '0', '-7', 'abc']) expect((await f.api.pm.get(`/reports/overview?days=${d}`)).status, d).toBe(400);
    const p = (await f.api.pm.get('/reports/overview?days=7')).body.period;
    expect((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000).toBeCloseTo(7, 3);
  });

  it('الأرقام: الحالات والمنشأة والمكتملة في الفترة ومؤشرات المراجعة بالتعريفات المعلنة', async () => {
    await completed(0); // موافقة من أول دورة
    await completed(1); // طلب تعديل ثم موافقة في الدورة 2
    await f.task(projectId, { dueDate: '2020-01-01' });
    const d = (await f.api.pm.get('/reports/overview')).body;
    expect(d.tasks.byStatus).toEqual({ COMPLETED: 2, PLANNED: 1 });
    expect(d.tasks.createdInPeriod).toBe(3);
    expect(d.tasks.completedInPeriod).toBe(2);
    expect(d.tasks.overdue).toBe(1);
    expect(d.reviews).toEqual({ approved: 2, changesRequested: 1, changesRequestRatePct: 33.3, avgRoundsToApproval: 1.5 });
    expect(d.projects.byStatus).toEqual({ PLANNED: 1 });
    expect(d.perProject).toEqual([{ projectId, name: expect.any(String), status: 'PLANNED', totalTasks: 3, completedTasks: 2, progressPct: 67 }]);
    expect(Object.keys(d.definitions)).toEqual(expect.arrayContaining(['progressPct', 'createdInPeriod', 'completedInPeriod', 'changesRequestRatePct', 'avgRoundsToApproval']));
    expect(Object.values(d.definitions).every((v) => typeof v === 'string' && /[؀-ۿ]/.test(v as string))).toBe(true);
  });

  it('بلا قرارات مراجعة: النسبة والمتوسط null (لا قسمة على صفر)، ومشروع بلا مهام progressPct = 0', async () => {
    const empty = await f.project({ name: 'فارغ' });
    const d = (await f.api.pm.get('/reports/overview')).body;
    expect(d.reviews).toEqual({ approved: 0, changesRequested: 0, changesRequestRatePct: null, avgRoundsToApproval: null });
    expect(d.perProject.find((p: any) => p.projectId === empty.id)).toMatchObject({ totalTasks: 0, completedTasks: 0, progressPct: 0 });
    expect(d.perSpecialization).toEqual([]);
  });

  it('الفترة: ما قبلها لا يُحسب، ويُحسب بنافذة أوسع', async () => {
    const task = await completed(1);
    await q(`UPDATE review_records SET reviewed_at = NOW() - INTERVAL '40 days' WHERE task_id = $1`, [task.id]);
    await q(`UPDATE audit_events SET created_at = NOW() - INTERVAL '40 days' WHERE task_id = $1`, [task.id]);
    await q(`UPDATE tasks SET created_at = NOW() - INTERVAL '45 days' WHERE id = $1`, [task.id]);
    const d30 = (await f.api.pm.get('/reports/overview?days=30')).body;
    expect(d30.reviews.approved + d30.reviews.changesRequested).toBe(0);
    expect(d30.tasks.createdInPeriod).toBe(0);
    expect(d30.tasks.completedInPeriod).toBe(0);
    expect(d30.tasks.byStatus).toEqual({ COMPLETED: 1 }); // الحالة الراهنة لا تتأثر بالفترة
    const d90 = (await f.api.pm.get('/reports/overview?days=90')).body;
    expect(d90.reviews).toMatchObject({ approved: 1, changesRequested: 1 });
    expect(d90.tasks.createdInPeriod).toBe(1);
    expect(d90.tasks.completedInPeriod).toBe(1);
  });

  it('التخصصات: تجميع المهام الرئيسية وبدون تخصص في النهاية، والفرعيات والمؤرشفة لا تُحسب', async () => {
    const [a, b] = await specializationIds();
    await f.task(projectId, { specializationId: a });
    await f.task(projectId, { specializationId: a });
    const doneB = await f.task(projectId, { specializationId: b });
    await f.task(projectId);
    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [doneB.id]);
    const main = (await f.api.pm.get('/tasks?parentOnly=true')).body.items[0];
    await f.api.pm.post(`/projects/${projectId}/tasks/${main.id}/subtasks`, { title: 'فرعية', specializationId: a });
    const rows = (await f.api.pm.get('/reports/overview')).body.perSpecialization;
    expect(rows.at(-1)).toEqual({ specializationId: null, name: 'بدون تخصص', total: 1, completed: 0 });
    expect(rows.find((r: any) => r.specializationId === a)).toMatchObject({ total: 2, completed: 0 });
    expect(rows.find((r: any) => r.specializationId === b)).toMatchObject({ total: 1, completed: 1 });
  });

  it('عزل الشركات', async () => {
    await completed(0);
    const other = await foreignExec();
    const p = (await other.api.post('/projects', { name: 'غريب' })).body;
    await other.api.post(`/projects/${p.id}/tasks`, { title: 'غريبة' });
    const d = (await other.api.get('/reports/overview')).body;
    expect(d.tasks.byStatus).toEqual({ PLANNED: 1 });
    expect(d.reviews.approved).toBe(0);
    expect(d.perProject).toHaveLength(1);
  });
});

describe('/audit — المدير التنفيذي فقط', () => {
  it('كل المسارات ترفض غير المدير التنفيذي (403) وغير الموثّق (401)', async () => {
    const calls: Array<(a: Api) => Promise<{ status: number }>> = [
      (a) => a.get('/audit/events'),
      (a) => a.get('/audit/report?period=daily'),
      (a) => a.post('/audit/reports', { period: 'daily' }),
      (a) => a.get('/audit/reports'),
      (a) => a.del('/audit/events?olderThanDays=30'),
    ];
    for (const k of ['pm', 'sm1', 'e1'] as const) for (const c of calls) expect((await c(f.api[k])).status, k).toBe(403);
    expect((await t.http().get('/audit/events')).status).toBe(401);
    expect((await f.api.exec.get('/audit/events')).status).toBe(200);
  });

  it('GET /audit/events: الأحدث أولًا مع الترقيم والفلاتر (النوع، المهمة، الفاعل، التاريخ)', async () => {
    const task = await f.assignedTask(projectId);
    await f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' });
    const all = (await f.api.exec.get('/audit/events?pageSize=200')).body;
    expect(all.total).toBe(4); // مشروع + مهمة + انتقالان
    const times = all.items.map((e: any) => e.createdAt);
    expect(times).toEqual([...times].sort((a, b) => b.localeCompare(a)));
    expect(all.items[0]).toMatchObject({ type: 'TASK_STATUS_CHANGED', entity: 'TASK', taskId: task.id, fromStatus: 'ASSIGNED', toStatus: 'IN_PROGRESS', actor: { id: f.users.e1.id, role: 'EMPLOYEE' } });

    expect((await f.api.exec.get('/audit/events?type=PROJECT_CREATED')).body.total).toBe(1);
    expect((await f.api.exec.get(`/audit/events?taskId=${task.id}`)).body.total).toBe(3);
    expect((await f.api.exec.get(`/audit/events?actorId=${f.users.e1.id}`)).body.total).toBe(1);
    const page = (await f.api.exec.get('/audit/events?pageSize=2&page=2')).body;
    expect(page.items).toHaveLength(2);
    expect(page.page).toBe(2);
    const today = new Date().toISOString().slice(0, 10);
    expect((await f.api.exec.get(`/audit/events?from=${today}&to=${today}`)).body.total).toBe(all.total);
    expect((await f.api.exec.get('/audit/events?to=2020-01-01')).body.total).toBe(0);
  });

  it('GET /audit/events: تحقق المدخلات', async () => {
    for (const qs of ['from=2026-02-31', 'to=غد', 'taskId=x', 'actorId=x', 'from=2026-12-02&to=2026-12-01', 'pageSize=500']) {
      const res = await f.api.exec.get(`/audit/events?${qs}`);
      expect(res.status, qs).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('لا أسرار في السجل (كلمات مرور/رموز) وعزل الشركات', async () => {
    await f.assignedTask(projectId);
    const other = await foreignExec();
    await other.api.post('/projects', { name: 'غريب' });
    const body = JSON.stringify((await f.api.exec.get('/audit/events?pageSize=200')).body);
    expect(body).not.toMatch(/password|token|secret|hash/i);
    expect((await f.api.exec.get('/audit/events?type=PROJECT_CREATED')).body.total).toBe(1);
    expect((await other.api.get('/audit/events')).body.total).toBe(1);
  });

  it('GET /audit/report: يومي وأسبوعي بالأعداد الصحيحة وقرارات المراجعة، وفترة قديمة = أصفار', async () => {
    await completed(1);
    const today = new Date().toISOString().slice(0, 10);
    const daily = (await f.api.exec.get(`/audit/report?period=daily&date=${today}`)).body;
    expect(daily.period).toBe('daily');
    expect(daily.totalEvents).toBeGreaterThan(8);
    expect(daily.totalEvents).toBe(Object.values(daily.byType as Record<string, number>).reduce((s, n) => s + n, 0));
    expect(daily.reviews).toEqual({ approved: 1, changesRequested: 1 });
    expect(daily.byType.REVIEW_DECISION).toBe(2);
    expect(daily.statusChanges).toBe(daily.byType.TASK_STATUS_CHANGED);
    expect(daily.byActor.map((a: any) => a.actor.id)).toEqual(expect.arrayContaining([f.users.e1.id, f.users.sm1.id, f.users.pm.id]));
    expect(daily.byActor.reduce((s: number, a: any) => s + a.count, 0)).toBe(daily.totalEvents);
    const weekly = (await f.api.exec.get(`/audit/report?period=weekly&date=${today}`)).body;
    expect(Date.parse(weekly.to) - Date.parse(weekly.from)).toBe(7 * 86_400_000);
    expect(weekly.totalEvents).toBe(daily.totalEvents);
    const old = (await f.api.exec.get('/audit/report?period=daily&date=2020-01-01')).body;
    expect(old).toMatchObject({ totalEvents: 0, byType: {}, byActor: [], statusChanges: 0, reviews: { approved: 0, changesRequested: 0 } });
    expect((await f.api.exec.get('/audit/report?period=daily')).status).toBe(200); // التاريخ الافتراضي
    for (const qs of ['', 'period=monthly', 'period=daily&date=2026-13-01']) expect((await f.api.exec.get(`/audit/report?${qs}`)).status, qs).toBe(400);
  });

  it('POST/GET /audit/reports: يحفظ التقرير ويسجّل الحدث ويعرضه الأحدث أولًا', async () => {
    await f.task(projectId);
    const today = new Date().toISOString().slice(0, 10);
    const a = await f.api.exec.post('/audit/reports', { period: 'daily', date: today });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ period: 'daily', createdBy: { id: f.users.exec.id }, payload: { period: 'daily', totalEvents: expect.any(Number) } });
    const b = await f.api.exec.post('/audit/reports', { period: 'weekly' });
    expect(b.status).toBe(201);
    const list = (await f.api.exec.get('/audit/reports')).body;
    expect(list.total).toBe(2);
    expect(list.items.map((r: any) => r.id)).toEqual([b.body.id, a.body.id]);
    expect((await f.api.exec.get('/audit/events?type=AUDIT_REPORT_SAVED')).body.total).toBe(2);
    expect((await f.api.exec.post('/audit/reports', { period: 'yearly' })).status).toBe(400);
    const other = await foreignExec();
    expect((await other.api.get('/audit/reports')).body.total).toBe(0);
  });

  it('DELETE /audit/events: يحذف الأقدم من N يومًا فقط في شركته، ويسجّل الحذف، ويرفض الحدود الخاطئة', async () => {
    await f.task(projectId);
    const other = await foreignExec();
    await other.api.post('/projects', { name: 'غريب' });
    await q(`UPDATE audit_events SET created_at = NOW() - INTERVAL '100 days' WHERE type = 'PROJECT_CREATED'`); // قديمان: واحد لكل شركة
    await q(`UPDATE audit_events SET created_at = NOW() - INTERVAL '6 days' WHERE type = 'TASK_CREATED'`);
    const before = (await f.api.exec.get('/audit/events')).body.total;

    for (const qs of ['', 'olderThanDays=6', 'olderThanDays=3651', 'olderThanDays=abc', 'olderThanDays=7.5']) {
      expect((await f.api.exec.del(`/audit/events?${qs}`)).status, qs).toBe(400);
    }
    expect((await f.api.exec.get('/audit/events')).body.total).toBe(before); // الرفض بلا حذف

    const res = await f.api.exec.del('/audit/events?olderThanDays=7');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    const after = (await f.api.exec.get('/audit/events?pageSize=200')).body;
    expect(after.items.some((e: any) => e.type === 'PROJECT_CREATED')).toBe(false);
    expect(after.items.some((e: any) => e.type === 'TASK_CREATED')).toBe(true); // عمره 6 أيام < 7
    const purge = after.items.find((e: any) => e.type === 'AUDIT_EVENTS_PURGED');
    expect(purge).toMatchObject({ entity: 'AUDIT', actor: { id: f.users.exec.id }, meta: { olderThanDays: 7, deleted: 1 } });
    expect((await other.api.get('/audit/events?type=PROJECT_CREATED')).body.total).toBe(1); // شركة أخرى لم تُمسّ
    expect((await f.api.exec.del('/audit/events?olderThanDays=7')).body).toEqual({ deleted: 0 });
  });
});

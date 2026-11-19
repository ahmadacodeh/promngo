import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';
import { apiAs, auditTypes, workFixture, type WorkFixture } from '../helpers/work.js';

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

const link = (pred: string, succ: string, who = f.api.pm) => who.post(`/projects/${projectId}/dependencies`, { predecessorTaskId: pred, successorTaskId: succ });
const edgeCount = async (): Promise<number> => (await q(`SELECT COUNT(*)::int AS n FROM task_dependencies`))[0].n;

describe('POST /projects/:projectId/dependencies', () => {
  it('ينشئ اعتمادية 201 بالشكل المعتمد ويسجّل الحادثة على اللاحقة', async () => {
    const a = await f.task(projectId, { title: 'أ' });
    const b = await f.task(projectId, { title: 'ب' });
    const res = await link(a.id, b.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      projectId, dependencyType: 'FINISH_TO_START_WITH_ACCEPTANCE',
      predecessor: { id: a.id, title: 'أ', status: 'PLANNED' }, successor: { id: b.id, title: 'ب', status: 'PLANNED' },
    });
    expect(await auditTypes(`entity = 'DEPENDENCY' AND entity_id = $1 AND task_id = $2`, [res.body.id, b.id])).toEqual(['DEPENDENCY_ADDED']);
    const detail = (await f.api.pm.get(`/tasks/${b.id}`)).body;
    expect(detail.predecessors.map((d: any) => d.predecessor.id)).toEqual([a.id]);
    expect((await f.api.pm.get(`/tasks/${a.id}`)).body.successors.map((d: any) => d.successor.id)).toEqual([b.id]);
  });

  it('المدراء فقط: المدير المختص والموظف 403', async () => {
    const a = await f.task(projectId, { assignedToId: f.users.e1.id });
    const b = await f.task(projectId, { assignedManagerId: f.users.sm2.id });
    expect((await link(a.id, b.id, f.api.e1)).status).toBe(403);
    expect((await link(a.id, b.id, f.api.sm2)).status).toBe(403);
    expect((await link(a.id, b.id, f.api.exec)).status).toBe(201);
  });

  it('التحقق: معرّفان صالحان، ولا ذاتية (400)، ولا مكررة (409)', async () => {
    const a = await f.task(projectId);
    const b = await f.task(projectId);
    expect((await f.api.pm.post(`/projects/${projectId}/dependencies`, { predecessorTaskId: 'x', successorTaskId: b.id })).status).toBe(400);
    expect((await f.api.pm.post(`/projects/${projectId}/dependencies`, { predecessorTaskId: a.id })).status).toBe(400);
    const self = await link(a.id, a.id);
    expect(self.status).toBe(400);
    expect(self.body.fields.successorTaskId).toBeTruthy();
    expect((await link(a.id, b.id)).status).toBe(201);
    const dup = await link(a.id, b.id);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DEPENDENCY_DUPLICATE');
    expect(await edgeCount()).toBe(1);
  });

  it('الدورة المباشرة والانتقالية والطويلة مرفوضة 409 DEPENDENCY_CYCLE بلا أثر', async () => {
    const [a, b, c, d] = [await f.task(projectId), await f.task(projectId), await f.task(projectId), await f.task(projectId)];
    expect((await link(a.id, b.id)).status).toBe(201);
    const direct = await link(b.id, a.id);
    expect(direct.status).toBe(409);
    expect(direct.body.code).toBe('DEPENDENCY_CYCLE');
    expect((await link(b.id, c.id)).status).toBe(201);
    expect((await link(c.id, a.id)).body.code).toBe('DEPENDENCY_CYCLE');
    expect((await link(c.id, d.id)).status).toBe(201);
    expect((await link(d.id, a.id)).body.code).toBe('DEPENDENCY_CYCLE');
    expect((await link(d.id, b.id)).body.code).toBe('DEPENDENCY_CYCLE');
    expect(await edgeCount()).toBe(3);
  });

  it('الأضلاع المتفرعة (الماسة) مسموحة: لا إنذار كاذب', async () => {
    const [a, b, c, d] = [await f.task(projectId), await f.task(projectId), await f.task(projectId), await f.task(projectId)];
    for (const [p, s] of [[a, b], [a, c], [b, d], [c, d]] as const) expect((await link(p.id, s.id)).status).toBe(201);
    expect(await edgeCount()).toBe(4);
  });

  it('منع الدورات ذري مع التزامن: عكسان متوازيان ← ينجح أحدهما فقط', async () => {
    for (let round = 0; round < 5; round++) {
      await q('TRUNCATE task_dependencies');
      const a = await f.task(projectId);
      const b = await f.task(projectId);
      const [x, y] = await Promise.all([link(a.id, b.id), link(b.id, a.id)]);
      expect([x.status, y.status].sort(), `الجولة ${round}`).toEqual([201, 409]);
      expect(await edgeCount()).toBe(1);
    }
  });

  it('حلقة من ثلاث إضافات متوازية ← تنجح اثنتان وتُرفض واحدة (لا دورة في القاعدة)', async () => {
    for (let round = 0; round < 3; round++) {
      await q('TRUNCATE task_dependencies');
      const [a, b, c] = [await f.task(projectId), await f.task(projectId), await f.task(projectId)];
      const res = await Promise.all([link(a.id, b.id), link(b.id, c.id), link(c.id, a.id)]);
      expect(res.filter((r) => r.status === 201)).toHaveLength(2);
      expect(res.filter((r) => r.status === 409 && r.body.code === 'DEPENDENCY_CYCLE')).toHaveLength(1);
      const cyc = await q(`WITH RECURSIVE r(start, cur, path) AS (
          SELECT predecessor_task_id, successor_task_id, ARRAY[predecessor_task_id] FROM task_dependencies
          UNION ALL SELECT r.start, d.successor_task_id, r.path || d.predecessor_task_id FROM r JOIN task_dependencies d ON d.predecessor_task_id = r.cur
           WHERE NOT d.predecessor_task_id = ANY(r.path))
        SELECT 1 FROM r WHERE cur = start LIMIT 1`);
      expect(cyc).toHaveLength(0);
    }
  });

  it('مهمة من مشروع آخر أو شركة أخرى أو غير موجودة ← 404، والمؤرشفة ← 409، والمشروع المغلق ← 409', async () => {
    const a = await f.task(projectId);
    const other = await f.project();
    const inOther = await f.task(other.id);
    expect((await link(a.id, inOther.id)).status).toBe(404);
    expect((await link(a.id, '00000000-0000-4000-8000-000000000000')).status).toBe(404);

    const co = await createCompany();
    const foreignMgr = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    await q(`UPDATE users SET can_create_projects = TRUE, must_change_password = FALSE WHERE id = $1`, [foreignMgr.id]);
    const fx = await apiAs(t, foreignMgr);
    const fp = (await fx.post('/projects', { name: 'سري' })).body;
    const ft = (await fx.post(`/projects/${fp.id}/tasks`, { title: 'سرية' })).body;
    expect((await link(a.id, ft.id)).status).toBe(404);
    expect((await f.api.pm.post(`/projects/${fp.id}/dependencies`, { predecessorTaskId: ft.id, successorTaskId: ft.id })).status).toBe(400);
    expect((await f.api.pm.post(`/projects/${fp.id}/dependencies`, { predecessorTaskId: a.id, successorTaskId: ft.id })).status).toBe(404);

    const parent = await f.task(projectId);
    const sub = (await f.api.pm.post(`/projects/${projectId}/tasks/${parent.id}/subtasks`, { title: 's' })).body;
    await f.api.pm.post(`/tasks/${sub.id}/archive`);
    const arch = await link(a.id, sub.id);
    expect(arch.status).toBe(409);
    expect(arch.body.code).toBe('STATE_CONFLICT');

    const b = await f.task(projectId);
    await f.api.pm.patch(`/projects/${projectId}`, { status: 'CANCELLED' });
    expect((await link(a.id, b.id)).body.code).toBe('PROJECT_CLOSED');
  });

  it('لاحقة بدأ عملها قبل الإضافة تُعلَّم needsReview مع حدث؛ غير المبدوءة لا', async () => {
    const pred = await f.task(projectId);
    const started = await f.startedTask(projectId);
    const idle = await f.assignedTask(projectId);
    await link(pred.id, started.id);
    await link(pred.id, idle.id);
    expect((await f.api.pm.get(`/tasks/${started.id}`)).body.needsReview).toBe(true);
    expect((await f.api.pm.get(`/tasks/${idle.id}`)).body.needsReview).toBe(false);
    expect(await auditTypes(`task_id = $1 AND type = 'DEPENDENCY_PREDECESSOR_CHANGED'`, [started.id])).toHaveLength(1);
  });
});

describe('GET /projects/:projectId/dependencies', () => {
  it('المدير يرى الكل؛ الموظف لا يرى إلا ما يرى طرفيه؛ مشروع غير مرئي ← 404', async () => {
    const a = await f.task(projectId, { assignedToId: f.users.e1.id });
    const b = await f.task(projectId, { assignedToId: f.users.e1.id });
    const c = await f.task(projectId, { assignedToId: f.users.e2.id });
    await link(a.id, b.id);
    await link(a.id, c.id);
    expect((await f.api.pm.get(`/projects/${projectId}/dependencies`)).body).toHaveLength(2);
    const mine = (await f.api.e1.get(`/projects/${projectId}/dependencies`)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0].successor.id).toBe(b.id);
    expect((await f.api.e3.get(`/projects/${projectId}/dependencies`)).status).toBe(404);
  });
});

describe('DELETE /dependencies/:id', () => {
  it('المدير يحذف 204 ويُسجَّل DEPENDENCY_REMOVED، ويعود البدء ممكنًا', async () => {
    const pred = await f.task(projectId);
    const succ = await f.assignedTask(projectId);
    const dep = (await link(pred.id, succ.id)).body;
    expect((await f.api.e1.post(`/tasks/${succ.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(409);
    expect((await f.api.pm.del(`/dependencies/${dep.id}`)).status).toBe(204);
    expect(await auditTypes(`entity = 'DEPENDENCY' AND entity_id = $1`, [dep.id])).toEqual(['DEPENDENCY_ADDED', 'DEPENDENCY_REMOVED']);
    expect((await f.api.e1.post(`/tasks/${succ.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(200);
    expect((await f.api.pm.del(`/dependencies/${dep.id}`)).status).toBe(404);
  });

  it('الموظف 403، وحذف اعتمادية شركة أخرى ← 404، ومشروع مغلق ← 409', async () => {
    const a = await f.task(projectId);
    const b = await f.task(projectId);
    const dep = (await link(a.id, b.id)).body;
    expect((await f.api.e1.del(`/dependencies/${dep.id}`)).status).toBe(403);

    const co = await createCompany();
    const foreignMgr = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    await q(`UPDATE users SET must_change_password = FALSE WHERE id = $1`, [foreignMgr.id]);
    expect((await (await apiAs(t, foreignMgr)).del(`/dependencies/${dep.id}`)).status).toBe(404);
    expect(await edgeCount()).toBe(1);

    await f.api.pm.patch(`/projects/${projectId}`, { status: 'CANCELLED' });
    expect((await f.api.pm.del(`/dependencies/${dep.id}`)).body.code).toBe('PROJECT_CLOSED');
  });
});

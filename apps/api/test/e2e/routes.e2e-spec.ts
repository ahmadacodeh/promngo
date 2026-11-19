import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '../../src/common/auth-user.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';
import { apiAs, workFixture, type WorkFixture } from '../helpers/work.js';

type Access = 'public' | 'authenticated' | Role[];
const EXEC: Role[] = ['EXECUTIVE_MANAGER'];
const MGR: Role[] = ['EXECUTIVE_MANAGER', 'PROJECT_MANAGER'];

/**
 * جرد كل مسارات المنصة وتصنيف صلاحية كل منها صراحةً. إضافة مسار بلا تصنيف هنا تُفشل الاختبار:
 * يفرض على المطوّر أن يقرر (وليس أن ينسى) من يصل إلى المسار الجديد.
 */
const CLASSIFIED: Record<string, Access> = {
  'GET /health': 'public',
  'POST /auth/login': 'public',
  'POST /auth/refresh': 'public',
  'POST /auth/logout': 'public',
  'GET /auth/me': 'authenticated',
  'POST /auth/change-password': 'authenticated',
  'GET /companies/current': 'authenticated',
  'PATCH /companies/current': EXEC,
  'GET /specializations': 'authenticated',
  'GET /users': 'authenticated', // العقد §4: قراءة مستخدمي الشركة لكل موثّق (قرار خصوصية مفتوح: P18 في backlog)
  'POST /users': EXEC,
  'GET /users/:id': 'authenticated',
  'PATCH /users/:id': EXEC,
  'POST /users/:id/reset-password': EXEC,
  'GET /projects': 'authenticated',
  'POST /projects': MGR,
  'GET /projects/:id': 'authenticated',
  'PATCH /projects/:id': MGR,
  'GET /projects/:projectId/tasks': 'authenticated',
  'POST /projects/:projectId/tasks': MGR,
  'POST /projects/:projectId/tasks/:taskId/subtasks': 'authenticated', // المدراء أو المدير المختص المعيّن (تفحصه الخدمة)
  'GET /projects/:projectId/dependencies': 'authenticated',
  'POST /projects/:projectId/dependencies': MGR,
  'DELETE /dependencies/:id': MGR,
  'GET /tasks': 'authenticated',
  'GET /tasks/:id': 'authenticated',
  'PATCH /tasks/:id': 'authenticated', // المدراء أو المدير المختص المعيّن (الخدمة)
  'DELETE /tasks/:id': 'authenticated',
  'POST /tasks/:id/transitions': 'authenticated',
  'POST /tasks/:id/archive': 'authenticated',
  'POST /tasks/:id/clear-review-flag': 'authenticated',
  'GET /tasks/:id/events': 'authenticated',
  'POST /tasks/:id/submit': 'authenticated', // المكلّف فقط (الخدمة)
  'GET /tasks/:id/submissions': 'authenticated',
  'POST /tasks/:id/reviews': 'authenticated', // المراجع المعيّن فقط (الخدمة)
  'GET /tasks/:id/reviews': 'authenticated',
  'GET /attachments/:id/download': 'authenticated',
  'GET /dashboard': 'authenticated',
  'GET /reports/overview': MGR,
  'GET /audit/events': EXEC,
  'GET /audit/report': EXEC,
  'GET /audit/reports': EXEC,
  'POST /audit/reports': EXEC,
  'DELETE /audit/events': EXEC,
};
/** مسارات يجوز الوصول إليها حتى مع إلزام تغيير كلمة المرور (والباقي يُحجب في الخادم). */
const ALLOWED_DURING_PASSWORD_CHANGE = new Set(['GET /auth/me', 'POST /auth/change-password', 'POST /auth/logout', 'POST /auth/login', 'POST /auth/refresh', 'GET /health']);

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

function registeredRoutes(): string[] {
  // Express 5 يعرض الموجّه الرئيسي في الحقل router
  const stack = (t.app.getHttpAdapter().getInstance() as { router: { stack: any[] } }).router.stack;
  const out: string[] = [];
  for (const l of stack) if (l.route) for (const m of Object.keys(l.route.methods)) out.push(`${m.toUpperCase()} ${l.route.path}`);
  return out.sort();
}
const fill = (route: string): { method: string; url: string } => {
  const [method, path] = route.split(' ') as [string, string];
  return { method, url: path.replace(/:\w+/g, () => randomUUID()) };
};
const send = (method: string, url: string, headers: Record<string, string> = {}) => {
  const req = (t.http() as any)[method.toLowerCase()](url).set(headers);
  return ['POST', 'PATCH'].includes(method) ? req.send({}) : req;
};

describe('جرد المسارات', () => {
  it('كل مسار مسجَّل له تصنيف صلاحية صريح، ولا تصنيف لمسار غير موجود', () => {
    const routes = registeredRoutes();
    expect(routes.filter((r) => !(r in CLASSIFIED)), 'مسارات بلا تصنيف').toEqual([]);
    expect(Object.keys(CLASSIFIED).filter((r) => !routes.includes(r)), 'تصنيفات لمسارات غير موجودة').toEqual([]);
    expect(routes.length).toBe(Object.keys(CLASSIFIED).length);
  });

  it('المسارات العامة هي المنصوص عليها فقط', () => {
    expect(Object.entries(CLASSIFIED).filter(([, a]) => a === 'public').map(([r]) => r).sort()).toEqual(['GET /health', 'POST /auth/login', 'POST /auth/logout', 'POST /auth/refresh']);
  });

  it('كل مسار غير عام يرفض الطلب بلا رمز (401) بما فيها تحميل الملفات والتسليم', async () => {
    for (const [route, access] of Object.entries(CLASSIFIED)) {
      if (access === 'public') continue;
      const { method, url } = fill(route);
      const res = await send(method, url);
      expect(res.status, route).toBe(401);
    }
  });

  it('رمز مزوّر أو بصيغة خاطئة ← 401 على كل المسارات المحمية', async () => {
    for (const bad of ['Bearer x.y.z', 'Basic abc', 'Bearer ']) {
      for (const [route, access] of Object.entries(CLASSIFIED)) {
        if (access === 'public') continue;
        const { method, url } = fill(route);
        expect((await send(method, url, { Authorization: bad })).status, `${route} / ${bad}`).toBe(401);
      }
    }
  });

  it('المسارات المقيّدة بالدور ترفض الأدوار الأخرى بـ403 FORBIDDEN (بمعرّفات عشوائية: الدور يُفحص قبل أي بحث)', async () => {
    const byRole: Record<Role, keyof WorkFixture['api']> = { EXECUTIVE_MANAGER: 'exec', PROJECT_MANAGER: 'pm', SPECIALIZED_MANAGER: 'sm1', EMPLOYEE: 'e1' };
    for (const [route, access] of Object.entries(CLASSIFIED)) {
      if (!Array.isArray(access)) continue;
      const { method, url } = fill(route);
      for (const [role, key] of Object.entries(byRole) as Array<[Role, keyof WorkFixture['api']]>) {
        if (access.includes(role)) continue;
        const res = await send(method, url, f.api[key].raw());
        expect(res.status, `${route} كـ ${role}`).toBe(403);
        expect(res.body.code, `${route} كـ ${role}`).toBe('FORBIDDEN');
      }
    }
  });

  it('إلزام تغيير كلمة المرور يُحجب في الخادم على كل مسار عدا المستثنى', async () => {
    await q(`UPDATE users SET must_change_password = TRUE WHERE id = $1`, [f.users.exec.id]);
    for (const [route, access] of Object.entries(CLASSIFIED)) {
      if (access === 'public' || ALLOWED_DURING_PASSWORD_CHANGE.has(route)) continue;
      const { method, url } = fill(route);
      const res = await send(method, url, f.api.exec.raw());
      expect(res.status, route).toBe(403);
      expect(res.body.code, route).toBe('PASSWORD_MUST_CHANGE');
    }
  });
});

describe('مصفوفة عزل الشركات: مدير تنفيذي من شركة أخرى على كل مورد في الشركة أ', () => {
  it('كل مسار يأخذ معرّفًا ← 404، والقوائم فارغة، ولا يتغير شيء في بيانات الشركة أ', async () => {
    // بيانات الشركة أ: مشروع، مهمة تحت المراجعة بتسليم ومرفق، مهمة أخرى، فرعية، اعتمادية.
    const P = (await f.project()).id;
    const T1 = await f.startedTask(P);
    const sub = await t.http().post(`/tasks/${T1.id}/submit`).set(f.api.e1.raw()).attach('files', Buffer.from('%PDF-1.4\n%x'), { filename: 'a.pdf' });
    expect(sub.status).toBe(201);
    const attachmentId: string = sub.body.submission.attachments[0].id;
    const T2 = await f.task(P);
    const S = (await f.api.pm.post(`/projects/${P}/tasks/${T2.id}/subtasks`, { title: 'فرعية' })).body.id as string;
    const D = (await f.api.pm.post(`/projects/${P}/dependencies`, { predecessorTaskId: T2.id, successorTaskId: T1.id })).body.id as string;
    const U = f.users.e1.id;

    const co = await createCompany();
    const x = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    await q(`UPDATE users SET can_create_projects = TRUE, must_change_password = FALSE WHERE id = $1`, [x.id]);
    const xa = await apiAs(t, x);

    const snapshot = async () =>
      JSON.stringify([
        await q(`SELECT * FROM projects ORDER BY id`),
        await q(`SELECT * FROM tasks ORDER BY id`),
        await q(`SELECT id, role, is_active, full_name, password_hash, must_change_password FROM users WHERE company_id = $1 ORDER BY id`, [f.company.id]),
        await q(`SELECT * FROM task_dependencies ORDER BY id`),
        await q(`SELECT * FROM review_records ORDER BY id`),
        await q(`SELECT * FROM task_attachments ORDER BY id`),
        await q(`SELECT COUNT(*)::int AS n FROM audit_events WHERE company_id = $1`, [f.company.id]),
      ]);
    const before = await snapshot();

    const matrix: Array<[string, string, object?]> = [
      ['GET', `/projects/${P}`], ['PATCH', `/projects/${P}`, { name: 'اختراق' }], ['GET', `/projects/${P}/tasks`],
      ['POST', `/projects/${P}/tasks`, { title: 'اختراق' }], ['POST', `/projects/${P}/tasks/${T2.id}/subtasks`, { title: 'اختراق' }],
      ['GET', `/projects/${P}/dependencies`], ['POST', `/projects/${P}/dependencies`, { predecessorTaskId: T1.id, successorTaskId: T2.id }],
      ['DELETE', `/dependencies/${D}`],
      ['GET', `/tasks/${T1.id}`], ['PATCH', `/tasks/${T1.id}`, { title: 'اختراق' }], ['DELETE', `/tasks/${S}`],
      ['POST', `/tasks/${T1.id}/transitions`, { to: 'BLOCKED' }], ['POST', `/tasks/${S}/archive`], ['POST', `/tasks/${T1.id}/clear-review-flag`],
      ['GET', `/tasks/${T1.id}/events`], ['GET', `/tasks/${T1.id}/submissions`], ['GET', `/tasks/${T1.id}/reviews`],
      ['POST', `/tasks/${T1.id}/reviews`, { decision: 'APPROVED' }], ['POST', `/tasks/${T1.id}/submit`, {}],
      ['GET', `/attachments/${attachmentId}/download`],
      ['GET', `/users/${U}`], ['PATCH', `/users/${U}`, { isActive: false }], ['POST', `/users/${U}/reset-password`],
    ];
    for (const [method, url, body] of matrix) {
      const req = (t.http() as any)[method.toLowerCase()](url).set(xa.raw());
      const res = body !== undefined ? await req.send(body) : await req;
      expect(res.status, `${method} ${url}`).toBe(404);
      expect(res.body.code, `${method} ${url}`).toBe('NOT_FOUND');
    }

    // القوائم والمجاميع لا تُظهر شيئًا من الشركة أ.
    expect((await xa.get('/projects')).body.total).toBe(0);
    expect((await xa.get('/tasks')).body.total).toBe(0);
    expect((await xa.get('/tasks?q=%25&scope=review')).body.total).toBe(0);
    expect((await xa.get('/users')).body.items.map((u: any) => u.id)).toEqual([x.id]);
    const dash = (await xa.get('/dashboard')).body;
    expect([dash.projects.total, dash.tasks.total, dash.myOpenTasks, dash.recentTasks.length]).toEqual([0, 0, 0, 0]);
    expect((await xa.get('/reports/overview')).body.perProject).toEqual([]);
    expect((await xa.get('/audit/events?pageSize=200')).body.items.some((e: any) => e.taskId === T1.id || e.entityId === P)).toBe(false);

    expect(await snapshot()).toBe(before); // لم يُعدَّل شيء في الشركة أ
  });

  it('معرّف شركة أخرى في الجسم لا يُقبل ولا يُربط: مكلّف ومراجع من شركة أخرى ← 400', async () => {
    const P = (await f.project()).id;
    const co = await createCompany();
    const foreignEmp = await createUser({ companyId: co.id, role: 'EMPLOYEE' });
    const foreignSm = await createUser({ companyId: co.id, role: 'SPECIALIZED_MANAGER' });
    const t0 = await f.task(P);
    for (const body of [{ assignedToId: foreignEmp.id }, { reviewerId: foreignSm.id }, { assignedManagerId: foreignSm.id }]) {
      const c = await f.api.pm.post(`/projects/${P}/tasks`, { title: 'x', ...body });
      expect(c.status, JSON.stringify(body)).toBe(400);
      const u = await f.api.pm.patch(`/tasks/${t0.id}`, body);
      expect(u.status, JSON.stringify(body)).toBe(400);
    }
    expect((await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE assigned_to = $1 OR reviewer_id = $2 OR assigned_manager_id = $2`, [foreignEmp.id, foreignSm.id]))[0].n).toBe(0);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';
import { specializationIds, workFixture, type WorkFixture } from '../helpers/work.js';

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

const eventsOf = async (entityId: string) =>
  (await q(`SELECT type, actor_id, meta FROM audit_events WHERE entity = 'USER' AND entity_id = $1 ORDER BY created_at, id`, [entityId])) as Array<{ type: string; actor_id: string; meta: Record<string, any> }>;

describe('تدقيق إدارة المستخدمين (FR-012)', () => {
  it('الإنشاء يُسجَّل بالفاعل ودون أي سر (لا كلمة المرور المؤقتة ولا البريد ولا التجزئة)', async () => {
    const [spec] = await specializationIds();
    const res = await f.api.exec.post('/users', { fullName: 'مستخدم جديد', email: 'new.user@example.test', role: 'EMPLOYEE', specializationId: spec });
    expect(res.status).toBe(201);
    const temp: string = res.body.temporaryPassword;
    const [ev] = await eventsOf(res.body.user.id);
    expect(ev).toMatchObject({ type: 'USER_CREATED', actor_id: f.users.exec.id, meta: { fullName: 'مستخدم جديد', role: 'EMPLOYEE', canCreateProjects: false } });
    const all = JSON.stringify(await q(`SELECT * FROM audit_events`));
    expect(all).not.toContain(temp);
    expect(all).not.toContain('new.user@example.test');
    expect(all).not.toMatch(/\$2[aby]\$/);
    const viaApi = JSON.stringify((await f.api.exec.get('/audit/events?type=USER_CREATED')).body);
    expect(viaApi).not.toContain(temp);
  });

  it('التعديل يسجّل الحقول المتغيرة وانتقال الدور والتفعيل', async () => {
    const id = f.users.e2.id;
    expect((await f.api.exec.patch(`/users/${id}`, { fullName: 'اسم جديد', canCreateProjects: true })).status).toBe(200);
    expect((await f.api.exec.patch(`/users/${id}`, { role: 'SPECIALIZED_MANAGER' })).status).toBe(200);
    expect((await f.api.exec.patch(`/users/${id}`, { isActive: false })).status).toBe(200);
    const evs = await eventsOf(id);
    expect(evs.map((e) => e.type)).toEqual(['USER_UPDATED', 'USER_UPDATED', 'USER_UPDATED']);
    expect(evs[0]!.meta).toEqual({ fields: ['fullName', 'canCreateProjects'] });
    expect(evs[1]!.meta).toEqual({ fields: ['role'], role: { from: 'EMPLOYEE', to: 'SPECIALIZED_MANAGER' } });
    expect(evs[2]!.meta).toEqual({ fields: ['isActive'], isActive: { from: true, to: false } });
    expect(evs.every((e) => e.actor_id === f.users.exec.id)).toBe(true);
  });

  it('إعادة تعيين كلمة المرور تُسجَّل دون كلمة المرور الجديدة', async () => {
    const res = await f.api.exec.post(`/users/${f.users.e1.id}/reset-password`);
    expect(res.status).toBe(200);
    const [ev] = await eventsOf(f.users.e1.id);
    expect(ev).toMatchObject({ type: 'USER_PASSWORD_RESET', actor_id: f.users.exec.id, meta: {} });
    expect(JSON.stringify(await q(`SELECT * FROM audit_events`))).not.toContain(res.body.temporaryPassword);
  });

  it('المحاولات المرفوضة لا تترك أحداثًا (بريد مكرر، آخر مدير تنفيذي، مستخدم مجهول)', async () => {
    expect((await f.api.exec.post('/users', { fullName: 'x', email: f.users.e1.email, role: 'EMPLOYEE' })).status).toBe(409);
    expect((await f.api.exec.patch(`/users/${f.users.exec.id}`, { isActive: false })).status).toBe(409);
    expect((await f.api.exec.patch(`/users/${f.users.exec.id}`, { role: 'EMPLOYEE' })).status).toBe(409);
    expect((await f.api.exec.patch('/users/00000000-0000-4000-8000-000000000000', { fullName: 'x' })).status).toBe(404);
    expect((await q(`SELECT COUNT(*)::int AS n FROM audit_events WHERE entity = 'USER'`))[0].n).toBe(0);
  });

  it('أحداث المستخدمين تظهر في سجل المدير التنفيذي بالنوع، وتبقى معزولة عن الشركات الأخرى', async () => {
    await f.api.exec.post(`/users/${f.users.e1.id}/reset-password`);
    const other = await createCompany();
    const ox = await createUser({ companyId: other.id, role: 'EXECUTIVE_MANAGER' });
    await q(`UPDATE users SET must_change_password = FALSE WHERE id = $1`, [ox.id]);
    const { apiAs } = await import('../helpers/work.js');
    const oApi = await apiAs(t, ox);
    const mine = (await f.api.exec.get('/audit/events?type=USER_PASSWORD_RESET')).body;
    expect(mine.total).toBe(1);
    expect(mine.items[0]).toMatchObject({ entity: 'USER', entityId: f.users.e1.id, actor: { id: f.users.exec.id } });
    expect((await oApi.get('/audit/events?type=USER_PASSWORD_RESET')).body.total).toBe(0);
  });
});

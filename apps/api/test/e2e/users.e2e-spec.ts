import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { bearer, loginAs } from '../helpers/auth.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser, twoCompanyFixture } from '../helpers/factories.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await closeTestPool();
});
beforeEach(resetDb);

const as = async (u: Parameters<typeof loginAs>[1]) => bearer((await loginAs(t, u)).accessToken);
const specId = async () => (await q<{ id: string }>(`SELECT id FROM specializations ORDER BY name LIMIT 1`))[0]!.id;

describe('GET /users و/users/:id (لكل أعضاء الشركة، داخل شركتهم فقط)', () => {
  it('الموظف يرى زملاء شركته فقط ولا يرى الشركة الأخرى', async () => {
    const f = await twoCompanyFixture();
    const res = await t.http().get('/users').set(await as(f.a.employee));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const ids = res.body.items.map((u: { id: string }) => u.id);
    expect(ids).toContain(f.a.executive.id);
    expect(ids).not.toContain(f.b.executive.id);
    expect(JSON.stringify(res.body)).not.toMatch(/password_?hash|\$2[aby]\$/i);
  });

  it('مستخدم من شركة أخرى أو معرّف غير موجود/تالف = 404 بالشكل الموحد', async () => {
    const f = await twoCompanyFixture();
    const h = await as(f.a.executive);
    for (const id of [f.b.employee.id, '00000000-0000-4000-8000-000000000000', 'not-a-uuid', "1' OR '1'='1"]) {
      const res = await t.http().get(`/users/${encodeURIComponent(id)}`).set(h);
      expect(res.status, id).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    expect((await t.http().get(`/users/${f.a.employee.id}`).set(h)).status).toBe(200);
  });

  it('الفلاتر: role وactive وq (مع تهريب % و_) والصفحات', async () => {
    const co = await createCompany();
    const exec = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER', fullName: 'مدير عام' });
    await createUser({ companyId: co.id, role: 'EMPLOYEE', fullName: 'ليلى 100%', email: 'laila@example.test' });
    await createUser({ companyId: co.id, role: 'EMPLOYEE', fullName: 'خالد', isActive: false });
    const h = await as(exec);
    const get = async (qs: string) => (await t.http().get(`/users${qs}`).set(h)).body;

    expect((await get('?role=EMPLOYEE')).total).toBe(2);
    expect((await get('?active=false')).total).toBe(1);
    expect((await get('?active=true')).total).toBe(2);
    expect((await get('?q=' + encodeURIComponent('100%'))).total).toBe(1);
    expect((await get('?q=' + encodeURIComponent('%'))).total).toBe(1); // % حرفية لا «أي شيء»
    expect((await get('?q=laila')).total).toBe(1);
    const p = await get('?pageSize=2&page=2');
    expect(p).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(p.items).toHaveLength(1);
    expect((await t.http().get('/users?pageSize=500').set(h)).status).toBe(400);
    expect((await t.http().get('/users?role=ROOT').set(h)).status).toBe(400);
  });
});

describe('POST /users (المدير التنفيذي فقط)', () => {
  it('ينشئ مستخدمًا بكلمة مؤقتة تعمل مرة واحدة وتفرض التغيير، والتجزئة داخل القاعدة', async () => {
    const f = await twoCompanyFixture();
    const sid = await specId();
    const res = await t
      .http()
      .post('/users')
      .set(await as(f.a.executive))
      .send({ fullName: '  نور  ', email: 'Nour@Example.Test ', role: 'SPECIALIZED_MANAGER', canCreateProjects: true, specializationId: sid });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.user).toMatchObject({ fullName: 'نور', email: 'nour@example.test', role: 'SPECIALIZED_MANAGER', canCreateProjects: true, isActive: true, mustChangePassword: true });
    expect(res.body.user.specialization.id).toBe(sid);
    const temp: string = res.body.temporaryPassword;
    expect(temp).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);

    // الشركة من هوية المنشئ لا من الطلب.
    const [row] = await q(`SELECT company_id, password_hash FROM users WHERE id = $1`, [res.body.user.id]);
    expect(row.company_id).toBe(f.a.company.id);
    expect(row.password_hash).toMatch(/^\$2a\$12\$/);
    expect(row.password_hash).not.toContain(temp);

    const login = await t.http().post('/auth/login').send({ email: 'nour@example.test', password: temp });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    // الإلزام من الخادم: كل مسار غير مستثنى مرفوض حتى تُغيَّر الكلمة المؤقتة.
    const blocked = await t.http().get('/users').set(bearer(login.body.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_MUST_CHANGE');
  });

  it('يرفض غير المدير التنفيذي (403) وبدون رمز (401)', async () => {
    const f = await twoCompanyFixture();
    const body = { fullName: 'س', email: 'x@example.test', role: 'EMPLOYEE' };
    for (const u of [f.a.projectManager, f.a.employee]) {
      const res = await t.http().post('/users').set(await as(u)).send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect((await t.http().post('/users').send(body)).status).toBe(401);
    expect(await q(`SELECT 1 FROM users WHERE email = 'x@example.test'`)).toHaveLength(0);
  });

  it('البريد المكرر (بأي حالة أحرف، وحتى من شركة أخرى) = 409 EMAIL_TAKEN', async () => {
    const f = await twoCompanyFixture();
    const h = await as(f.a.executive);
    const dup = await t.http().post('/users').set(h).send({ fullName: 'س', email: f.a.employee.email.toUpperCase(), role: 'EMPLOYEE' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
    const other = await t.http().post('/users').set(h).send({ fullName: 'س', email: f.b.employee.email, role: 'EMPLOYEE' });
    expect(other.status).toBe(409);
  });

  it('طلبان متزامنان بالبريد نفسه: ينجح واحد فقط', async () => {
    const f = await twoCompanyFixture();
    const h = await as(f.a.executive);
    const send = () => t.http().post('/users').set(h).send({ fullName: 'س', email: 'race@example.test', role: 'EMPLOYEE' });
    const r = await Promise.all([send(), send()]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
  });

  it('لا يقبل companyId ولا حقولًا غير معروفة (حماية Mass Assignment) ويتحقق من المدخلات برسائل عربية', async () => {
    const f = await twoCompanyFixture();
    const h = await as(f.a.executive);
    const inj = await t.http().post('/users').set(h).send({ fullName: 'س', email: 'i@example.test', role: 'EMPLOYEE', companyId: f.b.company.id });
    expect(inj.status).toBe(400);
    expect(inj.body.code).toBe('VALIDATION_FAILED');
    const bad = await t.http().post('/users').set(h).send({ fullName: '', email: 'nope', role: 'ROOT', specializationId: 'x' });
    expect(bad.status).toBe(400);
    for (const k of ['fullName', 'email', 'role', 'specializationId']) expect(bad.body.fields[k], k).toMatch(/[؀-ۿ]/);
    const noSpec = await t.http().post('/users').set(h).send({ fullName: 'س', email: 'j@example.test', role: 'EMPLOYEE', specializationId: '00000000-0000-4000-8000-000000000000' });
    expect(noSpec.status).toBe(400);
    expect(noSpec.body.fields.specializationId).toBeDefined();
  });
});

describe('PATCH /users/:id (المدير التنفيذي فقط)', () => {
  it('يعدّل الحقول ويمسح التخصص بـ null، والدور الجديد يسري فورًا على رمزه', async () => {
    const f = await twoCompanyFixture();
    const sid = await specId();
    const h = await as(f.a.executive);
    const emp = await loginAs(t, f.a.employee);
    expect((await t.http().post('/users').set(bearer(emp.accessToken)).send({})).status).toBe(403);

    const res = await t.http().patch(`/users/${f.a.employee.id}`).set(h).send({ fullName: 'اسم جديد', role: 'EXECUTIVE_MANAGER', canCreateProjects: true, specializationId: sid });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fullName: 'اسم جديد', role: 'EXECUTIVE_MANAGER', canCreateProjects: true });
    expect(res.body.specialization.id).toBe(sid);
    // رمزه القديم صار مديرًا تنفيذيًا فورًا (الدور يُقرأ من القاعدة في كل طلب)
    expect((await t.http().patch(`/users/${f.a.projectManager.id}`).set(bearer(emp.accessToken)).send({ fullName: 'م' })).status).toBe(200);

    const cleared = await t.http().patch(`/users/${f.a.employee.id}`).set(h).send({ specializationId: null });
    expect(cleared.body.specialization).toBeNull();
  });

  it('مستخدم من شركة أخرى = 404 ولا يتغير شيء', async () => {
    const f = await twoCompanyFixture();
    const res = await t.http().patch(`/users/${f.b.employee.id}`).set(await as(f.a.executive)).send({ isActive: false });
    expect(res.status).toBe(404);
    const [row] = await q(`SELECT is_active FROM users WHERE id = $1`, [f.b.employee.id]);
    expect(row.is_active).toBe(true);
  });

  it('جسم فارغ أو حقول غير معروفة = 400', async () => {
    const f = await twoCompanyFixture();
    const h = await as(f.a.executive);
    expect((await t.http().patch(`/users/${f.a.employee.id}`).set(h).send({})).status).toBe(400);
    expect((await t.http().patch(`/users/${f.a.employee.id}`).set(h).send({ companyId: f.b.company.id })).status).toBe(400);
    expect((await t.http().patch(`/users/${f.a.employee.id}`).set(h).send({ email: 'new@example.test' })).status).toBe(400);
  });

  it('لا يعطّل المدير نفسه، وتعطيل غيره يُبطل جلساته فورًا', async () => {
    const f = await twoCompanyFixture();
    const second = await createUser({ companyId: f.a.company.id, role: 'EXECUTIVE_MANAGER' });
    const h = await as(f.a.executive);
    const self = await t.http().patch(`/users/${f.a.executive.id}`).set(h).send({ isActive: false });
    expect(self.status).toBe(409);
    expect(self.body.message).toMatch(/[؀-ۿ]/);

    const emp = await loginAs(t, f.a.employee);
    const off = await t.http().patch(`/users/${f.a.employee.id}`).set(h).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await t.http().get('/auth/me').set(bearer(emp.accessToken))).status).toBe(401);
    expect((await t.http().post('/auth/refresh').send({ refreshToken: emp.refreshToken })).status).toBe(401);
    expect((await t.http().post('/auth/login').send({ email: f.a.employee.email, password: f.a.employee.password })).status).toBe(401);
    expect(second.id).toBeDefined();
  });

  it('لا يُخفَّض ولا يُعطَّل آخر مدير تنفيذي نشط (LAST_EXECUTIVE)', async () => {
    const co = await createCompany();
    const only = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    const h = await as(only);
    const demote = await t.http().patch(`/users/${only.id}`).set(h).send({ role: 'PROJECT_MANAGER' });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('LAST_EXECUTIVE');

    // مع وجود معطّل لا يُحسب: المدير الثاني معطّل ⇒ ما زال الأول آخر نشط
    await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER', isActive: false });
    expect((await t.http().patch(`/users/${only.id}`).set(h).send({ role: 'EMPLOYEE' })).body.code).toBe('LAST_EXECUTIVE');
  });

  it('سباق: مديران تنفيذيان يخفّض كل منهما الآخر معًا ⇒ يبقى واحد نشط دائمًا', async () => {
    for (let i = 0; i < 3; i++) {
      await resetDb();
      const co = await createCompany();
      const a = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
      const b = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
      const ha = await as(a);
      const hb = await as(b);
      const rs = await Promise.all([
        t.http().patch(`/users/${b.id}`).set(ha).send({ role: 'EMPLOYEE' }),
        t.http().patch(`/users/${a.id}`).set(hb).send({ role: 'EMPLOYEE' }),
      ]);
      expect(rs.map((r) => r.status).sort(), `iteration ${i}`).toEqual([200, 409]);
      const [n] = await q(`SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1 AND role = 'EXECUTIVE_MANAGER' AND is_active`, [co.id]);
      expect(n.n).toBe(1);
    }
  });
});

describe('POST /users/:id/reset-password', () => {
  it('كلمة مؤقتة جديدة، تُبطل الجلسات، تفرض التغيير، وترفع حجب المحاولات', async () => {
    const f = await twoCompanyFixture();
    const emp = f.a.employee;
    const old = await loginAs(t, emp);
    for (let i = 0; i < 5; i++) await t.http().post('/auth/login').send({ email: emp.email, password: 'Wrong-Pass-999' });
    expect((await t.http().post('/auth/login').send({ email: emp.email, password: emp.password })).status).toBe(429);

    const res = await t.http().post(`/users/${emp.id}/reset-password`).set(await as(f.a.executive));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const temp: string = res.body.temporaryPassword;

    expect((await t.http().post('/auth/refresh').send({ refreshToken: old.refreshToken })).status).toBe(401);
    expect((await t.http().post('/auth/login').send({ email: emp.email, password: emp.password })).status).toBe(401); // القديمة لا تدخل
    const ok = await t.http().post('/auth/login').send({ email: emp.email, password: temp });
    expect(ok.status).toBe(200); // لا حجب بعد إعادة التعيين
    expect(ok.body.mustChangePassword).toBe(true);
  });

  it('لغير المدير التنفيذي 403، ولمستخدم شركة أخرى 404 دون تغيير كلمته', async () => {
    const f = await twoCompanyFixture();
    expect((await t.http().post(`/users/${f.a.employee.id}/reset-password`).set(await as(f.a.projectManager))).status).toBe(403);
    const cross = await t.http().post(`/users/${f.b.employee.id}/reset-password`).set(await as(f.a.executive));
    expect(cross.status).toBe(404);
    expect((await t.http().post('/auth/login').send({ email: f.b.employee.email, password: f.b.employee.password })).status).toBe(200);
  });
});

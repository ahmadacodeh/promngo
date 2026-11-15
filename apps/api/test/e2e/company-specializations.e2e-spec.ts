import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { bearer, loginAs } from '../helpers/auth.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { twoCompanyFixture } from '../helpers/factories.js';

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

describe('الشركة الحالية', () => {
  it('كل عضو يقرأ شركته هو فقط', async () => {
    const f = await twoCompanyFixture();
    const a = await t.http().get('/companies/current').set(await as(f.a.employee));
    const b = await t.http().get('/companies/current').set(await as(f.b.employee));
    expect(a.body.id).toBe(f.a.company.id);
    expect(b.body.id).toBe(f.b.company.id);
    expect(a.body.name).toBe('شركة أ');
  });

  it('تعديل الاسم للمدير التنفيذي فقط ويؤثر على شركته فقط', async () => {
    const f = await twoCompanyFixture();
    const ok = await t.http().patch('/companies/current').set(await as(f.a.executive)).send({ name: '  اسم جديد  ' });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('اسم جديد');
    const [b] = await q(`SELECT name FROM companies WHERE id = $1`, [f.b.company.id]);
    expect(b.name).toBe('شركة ب');
    for (const u of [f.a.projectManager, f.a.employee]) {
      expect((await t.http().patch('/companies/current').set(await as(u)).send({ name: 'x' })).status).toBe(403);
    }
  });

  it('لا يغيّر الحالة ولا slug ولا يقبل companyId، ويرفض اسمًا فارغًا', async () => {
    const f = await twoCompanyFixture();
    const h = await as(f.a.executive);
    for (const body of [{ name: 'x', status: 'SUSPENDED' }, { name: 'x', slug: 'hacked' }, { name: 'x', id: f.b.company.id }]) {
      expect((await t.http().patch('/companies/current').set(h).send(body)).status).toBe(400);
    }
    const empty = await t.http().patch('/companies/current').set(h).send({ name: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.fields.name).toMatch(/[؀-ۿ]/);
  });
});

describe('التخصصات', () => {
  it('قراءة مصنّفة لكل مستخدم موثّق (7 مزروعة) وبلا كتابة', async () => {
    const f = await twoCompanyFixture();
    const h = await as(f.a.employee);
    const res = await t.http().get('/specializations').set(h);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(7);
    expect(res.body.items[0]).toEqual({ id: expect.any(String), name: expect.any(String), description: expect.anything() });
    expect((await t.http().post('/specializations').set(h).send({ name: 'x' })).status).toBe(404);
    expect((await t.http().get('/specializations')).status).toBe(401);
  });
});

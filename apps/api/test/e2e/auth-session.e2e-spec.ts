import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { bearer, loginAs, sleep } from '../helpers/auth.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser, TEST_PASSWORD } from '../helpers/factories.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await closeTestPool();
});
beforeEach(resetDb);

const setup = async (opts: { mustChangePassword?: boolean } = {}) => {
  const co = await createCompany();
  const u = await createUser({ companyId: co.id, role: 'PROJECT_MANAGER', ...opts });
  return { co, u };
};

describe('POST /auth/refresh (تدوير بالاستخدام الواحد)', () => {
  it('يُصدر رمزين جديدين ويُبطل القديم', async () => {
    const { u } = await setup();
    const first = await loginAs(t, u);
    const res = await t.http().post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.id).toBe(u.id);

    const sessions = await q(`SELECT revoked_at, replaced_by FROM refresh_sessions WHERE user_id = $1 ORDER BY created_at`, [u.id]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].revoked_at).not.toBeNull();
    expect(sessions[0].replaced_by).not.toBeNull();
    expect(sessions[1].revoked_at).toBeNull();

    const next = await t.http().post('/auth/refresh').send({ refreshToken: res.body.refreshToken });
    expect(next.status).toBe(200);
  });

  it('إعادة استخدام رمز مُدوَّر = سرقة محتملة: 401 ويُبطل كل جلسات المستخدم وكل رموز الوصول السابقة', async () => {
    const { u } = await setup();
    const first = await loginAs(t, u);
    const rotated = await t.http().post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);

    await sleep(1100); // tokens_invalid_before بالثواني الكاملة
    const replay = await t.http().post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('INVALID_REFRESH_TOKEN');

    // الرمز الجديد الذي أصدره التدوير الشرعي أُبطل أيضًا.
    const legit = await t.http().post('/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
    expect(legit.status).toBe(401);
    const open = await q(`SELECT 1 FROM refresh_sessions WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);
    expect(open).toHaveLength(0);
  });

  it('طلبان متزامنان بالرمز نفسه: ينجح واحد فقط', async () => {
    const { u } = await setup();
    const first = await loginAs(t, u);
    const results = await Promise.all([
      t.http().post('/auth/refresh').send({ refreshToken: first.refreshToken }),
      t.http().post('/auth/refresh').send({ refreshToken: first.refreshToken }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('يرفض رمز وصول مكان رمز التحديث، ورمزًا عشوائيًا، ورمزًا معدّلًا', async () => {
    const { u } = await setup();
    const tok = await loginAs(t, u);
    for (const bad of [tok.accessToken, 'garbage', tok.refreshToken.slice(0, -3) + 'abc', '']) {
      const res = await t.http().post('/auth/refresh').send({ refreshToken: bad });
      expect([400, 401], bad.slice(0, 12)).toContain(res.status);
      if (res.status === 401) expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
    }
  });

  it('يرفض التجديد للمستخدم المعطّل وللشركة الموقوفة', async () => {
    const { co, u } = await setup();
    const tok = await loginAs(t, u);
    await q(`UPDATE users SET is_active = FALSE WHERE id = $1`, [u.id]);
    expect((await t.http().post('/auth/refresh').send({ refreshToken: tok.refreshToken })).status).toBe(401);

    await q(`UPDATE users SET is_active = TRUE WHERE id = $1`, [u.id]);
    const tok2 = await loginAs(t, u);
    await q(`UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`, [co.id]);
    const res = await t.http().post('/auth/refresh').send({ refreshToken: tok2.refreshToken });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMPANY_NOT_ACTIVE');
  });

  it('الجلسة المنتهية في القاعدة تُرفض', async () => {
    const { u } = await setup();
    const tok = await loginAs(t, u);
    await q(`UPDATE refresh_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`, [u.id]);
    expect((await t.http().post('/auth/refresh').send({ refreshToken: tok.refreshToken })).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('يُبطل جلسة التحديث (204) ثم لا يصلح الرمز للتجديد', async () => {
    const { u } = await setup();
    const tok = await loginAs(t, u);
    const out = await t.http().post('/auth/logout').send({ refreshToken: tok.refreshToken });
    expect(out.status).toBe(204);
    const res = await t.http().post('/auth/refresh').send({ refreshToken: tok.refreshToken });
    expect(res.status).toBe(401);
  });

  it('لا يُبطل جلسات المستخدم الأخرى (جهاز آخر)', async () => {
    const { u } = await setup();
    const a = await loginAs(t, u);
    const b = await loginAs(t, u);
    await t.http().post('/auth/logout').send({ refreshToken: a.refreshToken });
    expect((await t.http().post('/auth/refresh').send({ refreshToken: b.refreshToken })).status).toBe(200);
  });

  it('idempotent: رمز غير صالح أو مكرر يعطي 204 دون خطأ', async () => {
    const { u } = await setup();
    const tok = await loginAs(t, u);
    expect((await t.http().post('/auth/logout').send({ refreshToken: tok.refreshToken })).status).toBe(204);
    expect((await t.http().post('/auth/logout').send({ refreshToken: tok.refreshToken })).status).toBe(204);
    expect((await t.http().post('/auth/logout').send({ refreshToken: 'garbage' })).status).toBe(204);
  });
});

describe('GET /auth/me', () => {
  it('يعيد المستخدم والشركة من القاعدة', async () => {
    const { co, u } = await setup();
    const tok = await loginAs(t, u);
    const res = await t.http().get('/auth/me').set(bearer(tok.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(u.id);
    expect(res.body.company.id).toBe(co.id);
    expect(JSON.stringify(res.body)).not.toMatch(/password_?hash|\$2[aby]\$|"password"/i);
  });

  it('بدون رمز: 401 بالشكل الموحد ورأس WWW-Authenticate', async () => {
    const res = await t.http().get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });
});

describe('POST /auth/change-password', () => {
  it('مستخدم بكلمة مؤقتة: mustChangePassword=true، يصل لـ /auth/me ويغيّرها، وتصبح الجلسات القديمة باطلة', async () => {
    const { u } = await setup({ mustChangePassword: true });
    const tok = await loginAs(t, u);
    expect(tok.body.mustChangePassword).toBe(true);
    expect((await t.http().get('/auth/me').set(bearer(tok.accessToken))).status).toBe(200);

    await sleep(1100); // لتسبق ثانية الإبطال ثانية إصدار رمز الوصول القديم
    const res = await t
      .http()
      .post('/auth/change-password')
      .set(bearer(tok.accessToken))
      .send({ currentPassword: u.password, newPassword: 'Brand-New-Pass-77' });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(false);
    expect(res.body.accessToken).toEqual(expect.any(String));

    // القديم: رمز الوصول والتحديث باطلان؛ الجديد يعمل.
    expect((await t.http().get('/auth/me').set(bearer(tok.accessToken))).status).toBe(401);
    expect((await t.http().post('/auth/refresh').send({ refreshToken: tok.refreshToken })).status).toBe(401);
    expect((await t.http().get('/auth/me').set(bearer(res.body.accessToken))).status).toBe(200);

    // كلمة المرور القديمة لا تدخل، والجديدة تدخل، وعلم الإلزام انطفأ في القاعدة.
    expect((await t.http().post('/auth/login').send({ email: u.email, password: u.password })).status).toBe(401);
    expect((await t.http().post('/auth/login').send({ email: u.email, password: 'Brand-New-Pass-77' })).status).toBe(200);
    const [row] = await q(`SELECT must_change_password, password_hash FROM users WHERE id = $1`, [u.id]);
    expect(row.must_change_password).toBe(false);
    expect(row.password_hash).toMatch(/^\$2a\$12\$/);
    expect(row.password_hash).not.toContain('Brand-New-Pass-77');
  });

  it('كلمة المرور الحالية الخاطئة: 401 بحقل currentPassword ولا تتغير كلمة المرور', async () => {
    const { u } = await setup();
    const tok = await loginAs(t, u);
    const res = await t
      .http()
      .post('/auth/change-password')
      .set(bearer(tok.accessToken))
      .send({ currentPassword: 'Wrong-Pass-999', newPassword: 'Brand-New-Pass-77' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect((await t.http().post('/auth/login').send({ email: u.email, password: u.password })).status).toBe(200);
  });

  it.each([
    ['قصيرة', 'Ab1'],
    ['بلا رقم', 'OnlyLettersHere'],
    ['بلا حرف', '1234567890123'],
    ['أطول من 72 بايت', 'A1' + 'y'.repeat(80)],
  ])('كلمة جديدة ضعيفة (%s): 400 WEAK_PASSWORD برسالة عربية', async (_n, weak) => {
    const { u } = await setup();
    const tok = await loginAs(t, u);
    const res = await t.http().post('/auth/change-password').set(bearer(tok.accessToken)).send({ currentPassword: u.password, newPassword: weak });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
    const fields = res.body.details?.fields ?? res.body.fields;
    expect(fields.newPassword).toMatch(/[؀-ۿ]/);
  });

  it('كلمة جديدة مساوية للحالية أو للبريد مرفوضة', async () => {
    const { u } = await setup();
    const tok = await loginAs(t, u);
    const same = await t.http().post('/auth/change-password').set(bearer(tok.accessToken)).send({ currentPassword: u.password, newPassword: u.password });
    expect(same.status).toBe(400);
    expect(TEST_PASSWORD).toBe(u.password);
  });

  it('يتطلب مصادقة', async () => {
    const res = await t.http().post('/auth/change-password').send({ currentPassword: 'x', newPassword: 'y' });
    expect(res.status).toBe(401);
  });
});

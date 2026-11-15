import { Controller, Get, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { CurrentUser, Public, Roles } from '../../src/common/decorators/index.js';
import type { AuthUser } from '../../src/common/auth-user.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { bearer, loginAs } from '../helpers/auth.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';

/** وحدة اختبار فقط: ثلاث مسارات تغطي الحراس العامة الحقيقية (JWT ثم الأدوار) فوق قاعدة حقيقية. */
@Controller('probe')
class ProbeController {
  @Public() @Get('public') pub() { return { ok: true }; }
  @Get('any') any(@CurrentUser() u: AuthUser) { return { id: u.id, companyId: u.companyId, role: u.role }; }
  @Roles('EXECUTIVE_MANAGER', 'PROJECT_MANAGER') @Get('managers') managers() { return { ok: true }; }
}
@Module({ imports: [AppModule], controllers: [ProbeController] })
class ProbeModule {}

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rootModule: ProbeModule });
});
afterAll(async () => {
  await t.close();
  await closeTestPool();
});
beforeEach(resetDb);

const forge = (payload: object, secret: string, opts: object = {}) => new JwtService().sign(payload, { secret, algorithm: 'HS256', ...opts });

describe('JwtAuthGuard (حقيقي، بلا محاكاة)', () => {
  it('المسار العام مفتوح، والمحمي يطلب رمزًا', async () => {
    expect((await t.http().get('/probe/public')).status).toBe(200);
    const res = await t.http().get('/probe/any');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('رمز صحيح: يُحمَّل المستخدم والشركة من القاعدة (لا من الرمز)', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id, role: 'SPECIALIZED_MANAGER' });
    const tok = await loginAs(t, u);
    const res = await t.http().get('/probe/any').set(bearer(tok.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: u.id, companyId: co.id, role: 'SPECIALIZED_MANAGER' });
  });

  it('تغيير الدور في القاعدة ينعكس فورًا على الرمز نفسه', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id, role: 'EMPLOYEE' });
    const tok = await loginAs(t, u);
    expect((await t.http().get('/probe/managers').set(bearer(tok.accessToken))).status).toBe(403);
    await q(`UPDATE users SET role = 'PROJECT_MANAGER' WHERE id = $1`, [u.id]);
    expect((await t.http().get('/probe/managers').set(bearer(tok.accessToken))).status).toBe(200);
  });

  it('رموز مزوّرة أو غير صالحة كلها 401', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    const tok = await loginAs(t, u);
    const accessSecret = process.env.JWT_ACCESS_SECRET!;
    const refreshSecret = process.env.JWT_REFRESH_SECRET!;
    const cases: Record<string, string> = {
      'رمز التحديث بدل الوصول': tok.refreshToken,
      'موقّع بمفتاح خاطئ': forge({ typ: 'access' }, 'x'.repeat(40), { subject: u.id, expiresIn: 60 }),
      'نوع typ خاطئ': forge({ typ: 'refresh' }, accessSecret, { subject: u.id, expiresIn: 60 }),
      'بلا typ': forge({}, accessSecret, { subject: u.id, expiresIn: 60 }),
      'منتهي': forge({ typ: 'access', iat: Math.floor(Date.now() / 1000) - 7200 }, accessSecret, { subject: u.id, expiresIn: 60 }),
      'موقّع بمفتاح التحديث': forge({ typ: 'access' }, refreshSecret, { subject: u.id, expiresIn: 60 }),
      'بلا sub': forge({ typ: 'access' }, accessSecret, { expiresIn: 60 }),
      'خوارزمية none': `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ typ: 'access', sub: u.id })).toString('base64url')}.`,
      'نص عشوائي': 'not.a.jwt',
    };
    for (const [name, token] of Object.entries(cases)) {
      const res = await t.http().get('/probe/any').set(bearer(token));
      expect(res.status, name).toBe(401);
      expect(res.body.code, name).toBe('UNAUTHORIZED');
    }
    const noScheme = await t.http().get('/probe/any').set('Authorization', tok.accessToken);
    expect(noScheme.status).toBe(401);
  });

  it('مستخدم معطّل بعد إصدار الرمز: 401', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    const tok = await loginAs(t, u);
    await q(`UPDATE users SET is_active = FALSE WHERE id = $1`, [u.id]);
    expect((await t.http().get('/probe/any').set(bearer(tok.accessToken))).status).toBe(401);
  });

  it('شركة موقوفة بعد الدخول: 403 COMPANY_NOT_ACTIVE', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    const tok = await loginAs(t, u);
    await q(`UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`, [co.id]);
    const res = await t.http().get('/probe/any').set(bearer(tok.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMPANY_NOT_ACTIVE');
  });

  it('tokens_invalid_before يُسقط الرموز الأقدم (بالثواني الكاملة)', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    const tok = await loginAs(t, u);
    await q(`UPDATE users SET tokens_invalid_before = NOW() + INTERVAL '2 seconds' WHERE id = $1`, [u.id]);
    expect((await t.http().get('/probe/any').set(bearer(tok.accessToken))).status).toBe(401);
  });

  it('إلزام تغيير كلمة المرور: كل مسار غير مستثنى يعطي 403 PASSWORD_MUST_CHANGE (من الخادم لا الواجهة)', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id, mustChangePassword: true });
    const tok = await loginAs(t, u);
    const res = await t.http().get('/probe/any').set(bearer(tok.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_MUST_CHANGE');
    expect((await t.http().get('/auth/me').set(bearer(tok.accessToken))).status).toBe(200);
  });
});

describe('RolesGuard', () => {
  it('الدور غير المسموح: 403 FORBIDDEN، والمسموح: 200', async () => {
    const co = await createCompany();
    const emp = await createUser({ companyId: co.id, role: 'EMPLOYEE' });
    const spec = await createUser({ companyId: co.id, role: 'SPECIALIZED_MANAGER' });
    const pm = await createUser({ companyId: co.id, role: 'PROJECT_MANAGER' });
    const exec = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    const status = async (u: typeof emp) => (await t.http().get('/probe/managers').set(bearer((await loginAs(t, u)).accessToken))).status;
    expect(await status(emp)).toBe(403);
    expect(await status(spec)).toBe(403);
    expect(await status(pm)).toBe(200);
    expect(await status(exec)).toBe(200);
  });
});

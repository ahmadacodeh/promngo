import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
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

describe('POST /auth/login', () => {
  it('ينجح بالبيانات الصحيحة ويعيد رمزين ومستخدمًا وشركة دون أي أثر لكلمة المرور', async () => {
    const co = await createCompany({ name: 'شركة الاختبار' });
    const u = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER', fullName: 'سارة' });

    const res = await t.http().post('/auth/login').send({ email: u.email, password: u.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.accessToken).not.toBe(res.body.refreshToken);
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.mustChangePassword).toBe(false);
    expect(res.body.user).toMatchObject({ id: u.id, email: u.email, role: 'EXECUTIVE_MANAGER', fullName: 'سارة' });
    expect(res.body.user).not.toHaveProperty('companyId'); // العقد: الشركة في حقل company المستقل
    expect(res.body.company).toMatchObject({ id: co.id, name: 'شركة الاختبار', status: 'ACTIVE' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(u.password);
    expect(raw.toLowerCase()).not.toContain('password_hash');
    expect(raw).not.toMatch(/\$2[aby]\$/);
  });

  it('البريد غير حساس لحالة الأحرف والمسافات الطرفية', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id, email: 'Mixed.Case@Example.Test' });
    const res = await t.http().post('/auth/login').send({ email: 'mixed.case@example.test', password: u.password });
    expect(res.status).toBe(200);
  });

  it('كلمة المرور محفوظة كتجزئة bcrypt داخل القاعدة ويتحقق منها PostgreSQL نفسه (pgcrypto)', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });

    const [row] = await q<{ password_hash: string; matches: boolean; wrong: boolean }>(
      `SELECT password_hash,
              (password_hash = crypt($2, password_hash)) AS matches,
              (password_hash = crypt($3, password_hash)) AS wrong
         FROM users WHERE id = $1`,
      [u.id, TEST_PASSWORD, 'not-the-password-1'],
    );
    expect(row!.password_hash).toMatch(/^\$2a\$12\$/);
    expect(row!.password_hash).not.toContain(TEST_PASSWORD);
    expect(row!.matches).toBe(true);
    expect(row!.wrong).toBe(false);
  });

  it('لا يمكن لدور التطبيق قراءة دوال التجزئة كـ PUBLIC: الدوال مقيّدة بصاحب الاتصال', async () => {
    const rows = await q<{ proname: string; public_exec: boolean }>(
      `SELECT proname, has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND proname LIKE 'auth\\_%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect(r.public_exec, r.proname).toBe(false);
  });

  it('كلمة المرور الخاطئة والبريد المجهول يعطيان الاستجابة نفسها (لا كشف لوجود الحساب)', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    const wrong = await t.http().post('/auth/login').send({ email: u.email, password: 'Wrong-Pass-999' });
    const unknown = await t.http().post('/auth/login').send({ email: 'nobody@example.test', password: 'Wrong-Pass-999' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(wrong.body.hint).toBe(unknown.body.hint);
    expect(wrong.body.message).toMatch(/[؀-ۿ]/); // عربي
  });

  it('المستخدم المعطّل لا يدخل حتى بكلمة مرور صحيحة، وبالرسالة العامة نفسها', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id, isActive: false });
    const res = await t.http().post('/auth/login').send({ email: u.email, password: u.password });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('الشركة الموقوفة أو المؤرشفة: 403 COMPANY_NOT_ACTIVE ولا تُنشأ جلسة', async () => {
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      const co = await createCompany({ status });
      const u = await createUser({ companyId: co.id });
      const res = await t.http().post('/auth/login').send({ email: u.email, password: u.password });
      expect(res.status, status).toBe(403);
      expect(res.body.code).toBe('COMPANY_NOT_ACTIVE');
      const sessions = await q(`SELECT 1 FROM refresh_sessions WHERE user_id = $1`, [u.id]);
      expect(sessions).toHaveLength(0);
    }
  });

  it('كلمة مرور أطول من 72 بايت تُرفض كبيانات خاطئة (لا اقتطاع صامت في bcrypt)', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id, password: 'A1' + 'x'.repeat(68) }); // 70 بايت
    const prefixOnly = await t.http().post('/auth/login').send({ email: u.email, password: 'A1' + 'x'.repeat(68) + 'extra-tail' });
    expect(prefixOnly.status).toBe(401);
    const exact = await t.http().post('/auth/login').send({ email: u.email, password: u.password });
    expect(exact.status).toBe(200);
  });

  it('يرفض مدخلات غير صالحة برسائل عربية لكل حقل (400 VALIDATION_FAILED)', async () => {
    const bad = await t.http().post('/auth/login').send({ email: 'not-an-email', password: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(bad.body.details?.fields ?? bad.body.fields).toBeDefined();
    const fields = bad.body.details?.fields ?? bad.body.fields;
    expect(fields.email).toMatch(/[؀-ۿ]/);
    expect(fields.password).toMatch(/[؀-ۿ]/);

    const extra = await t.http().post('/auth/login').send({ email: 'a@b.co', password: 'x', role: 'EXECUTIVE_MANAGER' });
    expect(extra.status).toBe(400);
    expect(extra.body.code).toBe('VALIDATION_FAILED');

    const missing = await t.http().post('/auth/login').send({});
    expect(missing.status).toBe(400);
  });

  it('يُسجَّل نجاح الدخول ويُنشأ سجل جلسة بتجزئة SHA-256 لا بالرمز نفسه', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    const res = await t.http().post('/auth/login').send({ email: u.email, password: u.password });
    const [s] = await q<{ token_hash: string; revoked_at: Date | null }>(`SELECT token_hash, revoked_at FROM refresh_sessions WHERE user_id = $1`, [u.id]);
    expect(s!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s!.token_hash).not.toBe(res.body.refreshToken);
    expect(s!.revoked_at).toBeNull();
  });
});

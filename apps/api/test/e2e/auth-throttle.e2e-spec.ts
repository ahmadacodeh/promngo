import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';

let t: TestApp; // trust proxy مفعّل لنتحكم بـ IP عبر X-Forwarded-For
beforeAll(async () => {
  t = await createTestApp({ trustProxy: true });
});
afterAll(async () => {
  await t.close();
  await closeTestPool();
});
beforeEach(resetDb);

const fail = (email: string, ip = '10.0.0.1') =>
  t.http().post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: 'Wrong-Pass-999' });

describe('حد محاولات الدخول (مخزَّن في القاعدة)', () => {
  it('بعد 5 محاولات فاشلة لنفس البريد يُحجب الدخول (حتى بكلمة صحيحة) مع Retry-After', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    for (let i = 0; i < 5; i++) expect((await fail(u.email)).status).toBe(401);

    const blocked = await t.http().post('/auth/login').set('X-Forwarded-For', '10.0.0.1').send({ email: u.email, password: u.password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(blocked.body.message).toMatch(/[؀-ۿ]/);
    expect(blocked.body.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.body.details.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(Number(blocked.headers['retry-after'])).toBe(blocked.body.details.retryAfterSeconds);
  });

  it('الحجب يطال البريد المستهدف فقط؛ بريد آخر من IP آخر يدخل بحرية', async () => {
    const co = await createCompany();
    const victim = await createUser({ companyId: co.id });
    const other = await createUser({ companyId: co.id });
    for (let i = 0; i < 5; i++) await fail(victim.email, '10.0.0.7');
    const res = await t.http().post('/auth/login').set('X-Forwarded-For', '10.0.0.8').send({ email: other.email, password: other.password });
    expect(res.status).toBe(200);
  });

  it('نجاح الدخول قبل بلوغ الحد يصفّر عدّاد البريد', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    for (let i = 0; i < 4; i++) await fail(u.email);
    const ok = await t.http().post('/auth/login').set('X-Forwarded-For', '10.0.0.1').send({ email: u.email, password: u.password });
    expect(ok.status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await fail(u.email)).status).toBe(401); // لا حجب: العدّاد بدأ من الصفر
  });

  it('حد الـ IP: 30 فشلًا من عنوان واحد على بريدات مختلفة يحجب العنوان', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    // نُدخل 30 محاولة فاشلة لهذا العنوان مباشرة (نفس الجدول الذي يكتبه التطبيق) لتسريع الاختبار.
    await q(
      `INSERT INTO login_attempts (email_key, ip, succeeded) SELECT 'spray' || g || '@example.test', '10.9.9.9', FALSE FROM generate_series(1, 30) g`,
    );
    const res = await t.http().post('/auth/login').set('X-Forwarded-For', '10.9.9.9').send({ email: u.email, password: u.password });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('TOO_MANY_ATTEMPTS');
    const fromElsewhere = await t.http().post('/auth/login').set('X-Forwarded-For', '10.9.9.10').send({ email: u.email, password: u.password });
    expect(fromElsewhere.status).toBe(200);
  });

  it('المحاولات الأقدم من 15 دقيقة لا تُحسب', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    await q(
      `INSERT INTO login_attempts (email_key, ip, succeeded, created_at)
       SELECT $1, '10.0.0.1', FALSE, NOW() - INTERVAL '16 minutes' FROM generate_series(1, 10)`,
      [u.email.toLowerCase()],
    );
    const res = await t.http().post('/auth/login').set('X-Forwarded-For', '10.0.0.1').send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
  });

  it('الحجب يصمد: الحالة في القاعدة لا في ذاكرة العملية (تطبيق جديد يرى الحجب نفسه)', async () => {
    const co = await createCompany();
    const u = await createUser({ companyId: co.id });
    for (let i = 0; i < 5; i++) await fail(u.email);
    const t2 = await createTestApp({ trustProxy: true });
    try {
      const res = await t2.http().post('/auth/login').set('X-Forwarded-For', '10.0.0.1').send({ email: u.email, password: u.password });
      expect(res.status).toBe(429);
    } finally {
      await t2.close();
    }
  });
});

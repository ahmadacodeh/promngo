import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool } from '../helpers/db.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await closeTestPool();
});

describe('الصحة والترويسات والأخطاء الموحدة', () => {
  it('GET /health مفتوح ويؤكد اتصال القاعدة', async () => {
    const res = await t.http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('ترويسات الأمان وX-Request-Id (ويُحترم معرّف العميل الآمن فقط)', async () => {
    const res = await t.http().get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const mine = await t.http().get('/health').set('X-Request-Id', 'client-req-42');
    expect(mine.headers['x-request-id']).toBe('client-req-42');
    const evil = await t.http().get('/health').set('X-Request-Id', 'bad id with spaces <script>');
    expect(evil.headers['x-request-id']).not.toContain('<');
    expect(evil.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('CORS: الأصل المسموح فقط يُعاد، وغيره لا يحصل على ترويسة السماح', async () => {
    const ok = await t.http().options('/auth/login').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await t.http().options('/auth/login').set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('مسار غير موجود وJSON تالف: أخطاء عربية بالشكل الموحد ودون stack', async () => {
    const nf = await t.http().get('/no/such/route');
    expect(nf.status).toBe(404);
    expect(nf.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(nf.body.message).toMatch(/[؀-ۿ]/);
    expect(nf.body.requestId).toBeDefined();
    expect(JSON.stringify(nf.body)).not.toMatch(/at .*\(.*:\d+:\d+\)|node_modules/);

    const bad = await t.http().post('/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/[؀-ۿ]/);
  });

  it('حجم الطلب الكبير جدًا مرفوض 413 بشكل موحد', async () => {
    const res = await t.http().post('/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect([400, 413]).toContain(res.status);
    expect(res.body.code).toMatch(/PAYLOAD_TOO_LARGE|VALIDATION_FAILED/);
  });
});

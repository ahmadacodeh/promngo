import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { createDataSource } from '../../src/database/data-source.js';
import { SEED_COMPANIES, SEED_USERS, seedDev, seedEmail } from '../../src/database/seed/seed-dev.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await closeTestPool();
});
beforeEach(resetDb);

describe('seed:dev', () => {
  it('يزرع شركتين × 6 مستخدمين بأدوارهم، ويدخلون بكلمة المرور، والعزل بين الشركتين سليم', async () => {
    const ds = createDataSource({ DATABASE_URL: process.env.DATABASE_URL!, DATABASE_SSL: 'false', DATABASE_SSL_CA: undefined, NODE_ENV: 'test' });
    await ds.initialize();
    try {
      await seedDev(ds, 'Seed-Pass-12345');
    } finally {
      await ds.destroy();
    }
    expect((await q(`SELECT 1 FROM companies`)).length).toBe(2);
    expect((await q(`SELECT 1 FROM users`)).length).toBe(12);
    const roles = await q<{ role: string; n: number }>(`SELECT role, COUNT(*)::int AS n FROM users GROUP BY role`);
    expect(Object.fromEntries(roles.map((r) => [r.role, r.n]))).toEqual({ EXECUTIVE_MANAGER: 2, PROJECT_MANAGER: 2, SPECIALIZED_MANAGER: 4, EMPLOYEE: 4 });

    const c = SEED_COMPANIES[0]!;
    const login = await t.http().post('/auth/login').send({ email: seedEmail('exec', c.domain), password: 'Seed-Pass-12345' });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(false);
    expect(login.body.company.slug).toBe('seed-alpha');
    const users = await t.http().get('/users').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(users.body.total).toBe(SEED_USERS.length);
    expect(users.body.items.every((u: { email: string }) => u.email.endsWith('@alpha.test'))).toBe(true);
  });
});

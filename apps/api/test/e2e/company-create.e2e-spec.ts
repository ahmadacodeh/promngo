import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { createDataSource } from '../../src/database/data-source.js';
import { CompanyCreateError, createCompany, normalizeCompanyInput, parseArgs } from '../../src/database/ops/company-create.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';

let t: TestApp;
let ds: DataSource;
beforeAll(async () => {
  t = await createTestApp();
  ds = createDataSource({ DATABASE_URL: process.env.DATABASE_URL!, DATABASE_SSL: 'false', DATABASE_SSL_CA: undefined, NODE_ENV: 'test' });
  await ds.initialize();
});
afterAll(async () => {
  await ds.destroy();
  await t.close();
  await closeTestPool();
});
beforeEach(resetDb);

const input = { name: 'شركة النور', slug: 'al-noor', adminName: 'سارة أحمد', adminEmail: 'Sara@AlNoor.example' };

describe('company:create (T21)', () => {
  it('ينشئ الشركة وأول مدير تنفيذي في معاملة واحدة؛ الكلمة المؤقتة تعمل مرة وتُلزم بالتغيير؛ ولا تُخزَّن نصًّا', async () => {
    const r = await createCompany(ds, input);
    expect(r.adminEmail).toBe('sara@alnoor.example');
    expect(r.temporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    const [co] = await q(`SELECT name, slug, status FROM companies WHERE id = $1`, [r.companyId]);
    expect(co).toEqual({ name: 'شركة النور', slug: 'al-noor', status: 'ACTIVE' });
    const [u] = await q(`SELECT company_id, role, can_create_projects, is_active FROM users WHERE id = $1`, [r.adminId]);
    expect(u).toEqual({ company_id: r.companyId, role: 'EXECUTIVE_MANAGER', can_create_projects: true, is_active: true });

    // لا أثر للكلمة النصية في أي عمود من أي جدول متعلق
    const dump = JSON.stringify(await q(`SELECT row_to_json(x) FROM (SELECT * FROM users) x`)) + JSON.stringify(await q(`SELECT meta FROM audit_events`));
    expect(dump).not.toContain(r.temporaryPassword);

    const login = await t.http().post('/auth/login').send({ email: 'sara@alnoor.example', password: r.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    expect(login.body.company.slug).toBe('al-noor');
    expect(login.body.user.role).toBe('EXECUTIVE_MANAGER');

    const [ev] = await q(`SELECT type, entity, entity_id, actor_id, meta FROM audit_events WHERE company_id = $1`, [r.companyId]);
    expect(ev).toMatchObject({ type: 'COMPANY_CREATED', entity: 'USER', entity_id: r.adminId, actor_id: null });
    expect(ev.meta).toMatchObject({ source: 'operator-cli', slug: 'al-noor' });
  });

  it('الشركة الجديدة معزولة: مديرها لا يرى مستخدمي شركة أخرى، والعكس', async () => {
    const a = await createCompany(ds, input);
    const b = await createCompany(ds, { name: 'شركة الأفق', slug: 'ufuq', adminName: 'عمر', adminEmail: 'omar@ufuq.example' });
    const token = async (email: string, pw: string) => {
      const l = await t.http().post('/auth/login').send({ email, password: pw });
      const ch = await t.http().post('/auth/change-password').set('Authorization', `Bearer ${l.body.accessToken}`).send({ currentPassword: pw, newPassword: 'New-Strong-Pass-123' });
      expect(ch.status).toBeLessThan(300);
      return (await t.http().post('/auth/login').send({ email, password: 'New-Strong-Pass-123' })).body.accessToken as string;
    };
    const ta = await token(a.adminEmail, a.temporaryPassword);
    const users = await t.http().get('/users').set('Authorization', `Bearer ${ta}`);
    expect(users.body.items.map((x: { email: string }) => x.email)).toEqual(['sara@alnoor.example']);
    expect((await t.http().get(`/users/${b.adminId}`).set('Authorization', `Bearer ${ta}`)).status).toBe(404);
  });

  it('يرفض slug أو بريدًا مكررًا دون أن يترك شركة يتيمة', async () => {
    await createCompany(ds, input);
    await expect(createCompany(ds, { ...input, adminEmail: 'other@x.example' })).rejects.toMatchObject({ kind: 'CONFLICT', message: expect.stringContaining('al-noor') });
    await expect(createCompany(ds, { ...input, slug: 'al-noor-2' })).rejects.toMatchObject({ kind: 'CONFLICT', message: expect.stringContaining('sara@alnoor.example') });
    expect((await q(`SELECT slug FROM companies ORDER BY slug`)).map((r) => r.slug)).toEqual(['al-noor']); // al-noor-2 لم تبقَ
  });

  it('يجمع كل مشكلات المدخلات في رسالة واحدة ويطبّع القيم', () => {
    expect(normalizeCompanyInput({ name: '  شركة  ', slug: ' AL-NOOR ', adminName: ' سارة ', adminEmail: ' A@B.CO ' })).toEqual({ name: 'شركة', slug: 'al-noor', adminName: 'سارة', adminEmail: 'a@b.co' });
    try {
      normalizeCompanyInput({ name: 'x', slug: 'bad slug!', adminName: '', adminEmail: 'nope' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CompanyCreateError);
      const msg = (e as Error).message;
      for (const k of ['--name', '--slug', '--admin-name', '--admin-email']) expect(msg).toContain(k);
    }
    expect(parseArgs(['--name', 'أ ب', '--slug=x-y', '--admin-name', 'م', '--admin-email', 'a@b.co', '--unknown', 'z'])).toEqual({ name: 'أ ب', slug: 'x-y', adminName: 'م', adminEmail: 'a@b.co' });
  });
});

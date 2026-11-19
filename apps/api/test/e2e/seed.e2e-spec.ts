import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { createDataSource } from '../../src/database/data-source.js';
import { SEED_COMPANIES, SEED_USERS, resetSeedData, seedDev, seedEmail } from '../../src/database/seed/seed-dev.js';
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

// ───────────────────────── المشاريع والمهام المزروعة ─────────────────────────

const PASSWORD = 'Seed-Pass-12345';
const uploadDir = (): string => process.env.UPLOAD_DIR!;

async function withDs<T>(fn: (ds: DataSource) => Promise<T>): Promise<T> {
  const ds = createDataSource({ DATABASE_URL: process.env.DATABASE_URL!, DATABASE_SSL: 'false', DATABASE_SSL_CA: undefined, NODE_ENV: 'test' });
  await ds.initialize();
  try {
    return await fn(ds);
  } finally {
    await ds.destroy();
  }
}

const seedAll = (): Promise<void> => withDs((ds) => seedDev(ds, PASSWORD, { uploadDir: uploadDir() }));

async function token(key: string, domain: string = SEED_COMPANIES[0].domain): Promise<{ Authorization: string }> {
  const r = await t.http().post('/auth/login').send({ email: seedEmail(key, domain), password: PASSWORD });
  expect(r.status, `login ${key}@${domain}`).toBe(200);
  return { Authorization: `Bearer ${r.body.accessToken}` };
}

const titles = (res: { body: { items: Array<{ title: string }> } }): string[] => res.body.items.map((i) => i.title).sort();

describe('seed:dev — المشاريع والمهام', () => {
  beforeEach(async () => {
    await rm(uploadDir(), { recursive: true, force: true });
    await seedAll();
  });

  it('لكل شركة 3 مشاريع و15 مهمة تغطي كل الحالات والأولويات، وبلا خلط بين الشركتين', async () => {
    const per = async (sql: string): Promise<Record<string, number>> =>
      Object.fromEntries((await q<{ slug: string; n: number }>(`SELECT c.slug, COUNT(*)::int AS n FROM (${sql}) x JOIN companies c ON c.id = x.company_id GROUP BY c.slug`)).map((r) => [r.slug, r.n]));
    const both = (n: number): Record<string, number> => ({ 'seed-alpha': n, 'seed-beta': n });

    expect(await per(`SELECT company_id FROM projects`)).toEqual(both(3));
    expect(await per(`SELECT company_id FROM tasks`)).toEqual(both(15));
    expect(await per(`SELECT company_id FROM tasks WHERE parent_task_id IS NOT NULL`)).toEqual(both(4));
    expect(await per(`SELECT company_id FROM tasks WHERE archived_at IS NOT NULL`)).toEqual(both(1));
    expect(await per(`SELECT company_id FROM task_dependencies`)).toEqual(both(5));
    expect(await per(`SELECT company_id FROM task_submissions`)).toEqual(both(7));
    expect(await per(`SELECT company_id FROM review_records`)).toEqual(both(6));
    expect(await per(`SELECT company_id FROM task_attachments`)).toEqual(both(5));
    expect(await per(`SELECT company_id FROM tasks WHERE needs_review`)).toEqual(both(1));

    const statuses = (await q<{ status: string }>(`SELECT DISTINCT status FROM tasks`)).map((r) => r.status).sort();
    expect(statuses).toEqual(['ASSIGNED', 'BLOCKED', 'CHANGES_REQUESTED', 'COMPLETED', 'IN_PROGRESS', 'PLANNED', 'UNDER_REVIEW']);
    const priorities = (await q<{ priority: string }>(`SELECT DISTINCT priority FROM tasks`)).map((r) => r.priority).sort();
    expect(priorities).toEqual(['HIGH', 'LOW', 'MEDIUM', 'URGENT']);
    const projectStatuses = (await q<{ status: string }>(`SELECT DISTINCT status FROM projects`)).map((r) => r.status).sort();
    expect(projectStatuses).toEqual(['ACTIVE', 'COMPLETED', 'PLANNED']);
  });

  it('السجلات متّسقة مع قواعد التطبيق: السوابق، التسليمات، المراجعات، وتتابع أحداث التدقيق', async () => {
    const none = async (label: string, sql: string): Promise<void> => expect(await q(sql), label).toEqual([]);

    await none('مهمة بدأت قبل اكتمال سابقتها بلا تعليم مراجعة', `
      SELECT s.title FROM task_dependencies d JOIN tasks s ON s.id = d.successor_task_id JOIN tasks p ON p.id = d.predecessor_task_id
      WHERE s.status IN ('IN_PROGRESS','SUBMITTED','UNDER_REVIEW','CHANGES_REQUESTED','COMPLETED')
        AND p.status <> 'COMPLETED' AND p.archived_at IS NULL AND NOT s.needs_review`);
    await none('مهمة مكتملة بلا اعتماد في آخر جولة', `
      SELECT t.title FROM tasks t WHERE t.status = 'COMPLETED' AND NOT EXISTS (
        SELECT 1 FROM review_records r WHERE r.task_id = t.id AND r.decision = 'APPROVED'
          AND r.round = (SELECT MAX(round) FROM task_submissions WHERE task_id = t.id))`);
    await none('جولات التسليم غير متتالية', `SELECT task_id FROM task_submissions GROUP BY task_id HAVING COUNT(*) <> MAX(round)`);
    await none('مراجعة بلا تسليم لجولتها', `SELECT r.id FROM review_records r WHERE NOT EXISTS (SELECT 1 FROM task_submissions s WHERE s.task_id = r.task_id AND s.round = r.round)`);
    await none('حالة المهمة لا تساوي آخر انتقال مسجَّل', `
      SELECT t.title FROM tasks t LEFT JOIN LATERAL (
        SELECT to_status FROM audit_events e WHERE e.task_id = t.id AND e.type = 'TASK_STATUS_CHANGED' ORDER BY created_at DESC LIMIT 1
      ) last ON TRUE WHERE COALESCE(last.to_status, 'PLANNED') <> t.status`);
    await none('سلسلة الانتقالات المسجَّلة متقطعة', `
      SELECT task_id FROM (SELECT task_id, from_status, LAG(to_status) OVER (PARTITION BY task_id ORDER BY created_at) AS prev
        FROM audit_events WHERE type = 'TASK_STATUS_CHANGED') x WHERE prev IS NOT NULL AND from_status <> prev`);
    await none('أول انتقال لا يبدأ من PLANNED', `
      SELECT task_id FROM (SELECT DISTINCT ON (task_id) task_id, from_status FROM audit_events WHERE type = 'TASK_STATUS_CHANGED' ORDER BY task_id, created_at) x WHERE from_status <> 'PLANNED'`);
    await none('مهمة بلا حدث إنشاء', `SELECT t.title FROM tasks t WHERE NOT EXISTS (SELECT 1 FROM audit_events e WHERE e.task_id = t.id AND e.type = 'TASK_CREATED')`);
    await none('طابع زمني في المستقبل', `
      SELECT 1 FROM audit_events WHERE created_at > NOW() UNION ALL SELECT 1 FROM tasks WHERE updated_at > NOW() OR created_at > NOW()
      UNION ALL SELECT 1 FROM projects WHERE updated_at > NOW() OR created_at > NOW()`);
    await none('مشروع مكتمل فيه مهمة غير مكتملة', `SELECT t.title FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.status = 'COMPLETED' AND t.archived_at IS NULL AND t.status <> 'COMPLETED'`);
    await none('مكتملة وفيها فرعية مطلوبة مفتوحة', `
      SELECT p.title FROM tasks p JOIN tasks c ON c.parent_task_id = p.id
      WHERE p.status = 'COMPLETED' AND c.is_required AND c.archived_at IS NULL AND c.status <> 'COMPLETED'`);

    // المرفقات ملفات حقيقية بحجمها المسجَّل، تحت مجلد شركتها.
    const atts = await q<{ company_id: string; storage_path: string; size_bytes: string }>(`SELECT company_id, storage_path, size_bytes FROM task_attachments`);
    expect(atts.length).toBe(10);
    for (const a of atts) {
      expect(a.storage_path.startsWith(`${a.company_id}/`)).toBe(true);
      expect((await stat(join(uploadDir(), a.storage_path))).size).toBe(Number(a.size_bytes));
    }
  });

  it('عبر الـ API: المتأخرة، تحتاج مراجعة، الفرز بالأولوية، المراجعة المنتظرة، ومهامي', async () => {
    const exec = await token('exec');
    const get = (key: Record<string, string>, url: string) => t.http().get(url).set(key);

    expect((await get(exec, '/projects')).body.total).toBe(3);
    expect(titles(await get(exec, '/tasks?overdue=true'))).toEqual(['تهيئة خدمة المصادقة', 'ربط الواجهة بالخدمات']);
    expect(titles(await get(exec, '/tasks?needsReview=true'))).toEqual(['ربط الواجهة بالخدمات']);
    const all = await get(exec, '/tasks?pageSize=100');
    expect(all.body.total).toBe(14); // 15 منها واحدة مؤرشفة لا تظهر افتراضيًا
    const byPriority = (await get(exec, '/tasks?parentOnly=true&sort=priority&order=desc&pageSize=100')).body.items.map((i: { priority: string }) => i.priority);
    expect(byPriority[0]).toBe('URGENT');
    expect(byPriority.at(-1)).toBe('LOW');

    const dash = (await get(exec, '/dashboard')).body;
    expect(dash.scope).toBe('COMPANY');
    expect(dash.projects.total).toBe(3);
    expect(dash.tasks.overdue).toBe(2);
    expect(Object.keys(dash.tasks.byPriority).sort()).toEqual(['HIGH', 'LOW', 'MEDIUM', 'URGENT']);

    const spec2 = await token('spec2');
    expect(titles(await get(spec2, '/tasks?scope=review'))).toEqual(['بناء مكوّنات لوحة التحكم']);
    expect((await get(spec2, '/dashboard')).body.awaitingMyReview).toBe(1);
    const emp1 = await token('emp1');
    expect((await get(emp1, '/tasks?scope=mine&pageSize=100')).body.total).toBe(7);
    expect((await get(emp1, '/dashboard')).body.scope).toBe('PERSONAL');
  });

  it('يُنزَّل مرفق التسليم المزروع كملف حقيقي بمحتواه العربي وترويسات الأمان', async () => {
    const emp1 = await token('emp1');
    const task = (await t.http().get('/tasks?q=مكوّنات').set(emp1)).body.items[0];
    const subs = (await t.http().get(`/tasks/${task.id}/submissions`).set(emp1)).body;
    expect(subs.length).toBe(1);
    const att = subs[0].attachments[0];
    expect(att.fileName).toBe('مكوّنات-لوحة-التحكم.md');
    const res = await t.http().get(`/attachments/${att.id}/download`).set(emp1).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect((res.body as Buffer).toString('utf8')).toContain('# مكوّنات لوحة التحكم');
  });

  it('العزل: مدير شركة ألفا لا يرى شيئًا من بيتا، والعكس، ومورد الآخر 404', async () => {
    const alpha = await token('exec');
    const beta = await token('exec', SEED_COMPANIES[1].domain);
    const aIds = (await t.http().get('/tasks?pageSize=100').set(alpha)).body.items.map((i: { id: string }) => i.id);
    const bIds = (await t.http().get('/tasks?pageSize=100').set(beta)).body.items.map((i: { id: string }) => i.id);
    expect(aIds.length).toBe(14);
    expect(bIds.length).toBe(14);
    expect(aIds.filter((id: string) => bIds.includes(id))).toEqual([]);
    expect((await t.http().get(`/tasks/${bIds[0]}`).set(alpha)).status).toBe(404);
    expect((await t.http().get(`/tasks/${aIds[0]}`).set(beta)).status).toBe(404);
    const audit = (await t.http().get('/audit/events?pageSize=100').set(alpha)).body;
    expect(audit.total).toBeGreaterThan(30);
    expect(await q(`SELECT 1 FROM audit_events e JOIN companies c ON c.id = e.company_id WHERE c.slug = 'seed-alpha' AND e.entity_id = ANY($1)`, [bIds])).toEqual([]);
  });
});

describe('seed:dev --reset', () => {
  it('يعيد بناء شركتي seed بالأعداد نفسها، ويحذف ملفاتهما القديمة، ولا يمس شركة أخرى', async () => {
    await rm(uploadDir(), { recursive: true, force: true });
    await seedAll();
    await q(`INSERT INTO companies (name, slug) VALUES ('شركة أخرى', 'not-seed')`);
    const before = (await readdir(uploadDir())).sort();
    expect(before.length).toBe(2);

    await withDs((ds) => resetSeedData(ds, uploadDir()));
    expect((await q(`SELECT slug FROM companies`)).map((r) => r.slug)).toEqual(['not-seed']);
    expect(await q(`SELECT 1 FROM tasks`)).toEqual([]);
    expect(await q(`SELECT 1 FROM audit_events`)).toEqual([]);
    expect(await readdir(uploadDir())).toEqual([]);

    await seedAll();
    expect((await q(`SELECT 1 FROM tasks`)).length).toBe(30);
    expect((await q(`SELECT 1 FROM companies`)).length).toBe(3);
    const after = (await readdir(uploadDir())).sort();
    expect(after.length).toBe(2);
    expect(after.filter((d) => before.includes(d))).toEqual([]); // معرّفات شركات جديدة، لا بقايا قديمة
    const sample = await q<{ storage_path: string }>(`SELECT storage_path FROM task_attachments LIMIT 1`);
    expect((await readFile(join(uploadDir(), sample[0]!.storage_path), 'utf8')).length).toBeGreaterThan(20);
  });
});

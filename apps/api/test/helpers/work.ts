import { randomUUID } from 'node:crypto';
import type { Test } from 'supertest';
import type { TestApp } from './app.js';
import { TokensService } from '../../src/auth/tokens.service.js';
import { bearer } from './auth.js';
import { q } from './db.js';
import { createCompany, TEST_PASSWORD, type TestUser } from './factories.js';

export interface Api {
  user: TestUser;
  get(url: string): Test;
  post(url: string, body?: object): Test;
  patch(url: string, body?: object): Test;
  del(url: string): Test;
  raw(): Record<string, string>;
}

/**
 * عميل HTTP موثّق لمستخدم معيّن. رمز الوصول يصدره TokensService نفسه (التوقيع والمدة كما في الإنتاج)
 * بدل تسجيل دخول bcrypt لكل مستخدم في كل اختبار؛ تسجيل الدخول الحقيقي مغطّى في auth-login.e2e-spec.
 * الحارس يعيد تحميل المستخدم والشركة من القاعدة في كل طلب كالمعتاد.
 */
export async function apiAs(t: TestApp, user: TestUser): Promise<Api> {
  const accessToken = t.app.get(TokensService, { strict: false }).signAccess(user.id);
  const h = bearer(accessToken);
  return {
    user,
    get: (u) => t.http().get(u).set(h),
    post: (u, b) => t.http().post(u).set(h).send(b ?? {}),
    patch: (u, b) => t.http().patch(u).set(h).send(b ?? {}),
    del: (u) => t.http().delete(u).set(h),
    raw: () => h,
  };
}

let cachedHash: string | undefined;
/** تجزئة bcrypt واحدة تُحسب مرة لكل عملية اختبار ثم تُعاد (التجزئة نفسها من PostgreSQL، وكلفة 12 كالإنتاج). */
async function sharedHash(): Promise<string> {
  cachedHash ??= (await q<{ h: string }>(`SELECT crypt($1, gen_salt('bf', 12)) AS h`, [TEST_PASSWORD]))[0]!.h;
  return cachedHash;
}

/** مستخدم نشط بلا إلزام تغيير كلمة المرور، بالتجزئة المشتركة (يجعل تجهيز الشركة بالملي ثانية). */
async function fastUser(companyId: string, role: TestUser['role'], fullName: string): Promise<TestUser> {
  const id = randomUUID();
  const email = `u-${id.slice(0, 8)}@example.test`;
  await q(
    `INSERT INTO users (id, company_id, full_name, email, role, is_active, password_hash, must_change_password) VALUES ($1, $2, $3, $4, $5, TRUE, $6, FALSE)`,
    [id, companyId, fullName, email, role, await sharedHash()],
  );
  return { id, companyId, email, password: TEST_PASSWORD, role };
}

export type WorkFixture = Awaited<ReturnType<typeof workFixture>>;

/**
 * شركة واحدة بكل الأدوار: مدير تنفيذي (exec) ومدير مشروع (pm) — كلاهما يملك canCreateProjects —
 * ومديران مختصان (sm1 مراجع، sm2 مدير مختص معيّن) وثلاثة موظفين.
 */
export async function workFixture(t: TestApp) {
  const company = await createCompany({ name: 'شركة العمل' });
  const mk = (role: TestUser['role'], fullName: string) => fastUser(company.id, role, fullName);
  const users = {
    exec: await mk('EXECUTIVE_MANAGER', 'المدير التنفيذي'),
    pm: await mk('PROJECT_MANAGER', 'مدير المشروع'),
    sm1: await mk('SPECIALIZED_MANAGER', 'مدير مختص ١'),
    sm2: await mk('SPECIALIZED_MANAGER', 'مدير مختص ٢'),
    e1: await mk('EMPLOYEE', 'موظف ١'),
    e2: await mk('EMPLOYEE', 'موظف ٢'),
    e3: await mk('EMPLOYEE', 'موظف ٣'),
  };
  await q(`UPDATE users SET can_create_projects = TRUE WHERE id = ANY($1)`, [[users.exec.id, users.pm.id]]);
  const api = {
    exec: await apiAs(t, users.exec),
    pm: await apiAs(t, users.pm),
    sm1: await apiAs(t, users.sm1),
    sm2: await apiAs(t, users.sm2),
    e1: await apiAs(t, users.e1),
    e2: await apiAs(t, users.e2),
    e3: await apiAs(t, users.e3),
  };

  /** ينشئ مشروعًا (يفشل الاختبار فورًا إن لم يُنشأ). */
  async function project(over: Record<string, unknown> = {}) {
    const res = await api.pm.post('/projects', { name: `مشروع ${Math.random().toString(36).slice(2, 7)}`, ...over });
    if (res.status !== 201) throw new Error(`إنشاء المشروع فشل (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body as { id: string; name: string; status: string };
  }
  /** ينشئ مهمة رئيسية. */
  async function task(projectId: string, over: Record<string, unknown> = {}) {
    const res = await api.pm.post(`/projects/${projectId}/tasks`, { title: `مهمة ${Math.random().toString(36).slice(2, 7)}`, ...over });
    if (res.status !== 201) throw new Error(`إنشاء المهمة فشل (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body as { id: string; status: string; [k: string]: any };
  }
  /** مهمة جاهزة للتنفيذ: مكلّف e1 ومراجع sm1 ومدير مختص sm2 وحالتها ASSIGNED. */
  async function assignedTask(projectId: string, over: Record<string, unknown> = {}) {
    const created = await task(projectId, { assignedToId: users.e1.id, reviewerId: users.sm1.id, assignedManagerId: users.sm2.id, ...over });
    const res = await api.pm.post(`/tasks/${created.id}/transitions`, { to: 'ASSIGNED' });
    if (res.status !== 200) throw new Error(`إسناد المهمة فشل (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body as { id: string; status: string; [k: string]: any };
  }
  /** يبدأ المهمة بيد المكلّف e1 (IN_PROGRESS). */
  async function startedTask(projectId: string, over: Record<string, unknown> = {}) {
    const a = await assignedTask(projectId, over);
    const res = await api.e1.post(`/tasks/${a.id}/transitions`, { to: 'IN_PROGRESS' });
    if (res.status !== 200) throw new Error(`بدء المهمة فشل (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body as { id: string; status: string; [k: string]: any };
  }

  return { company, users, api, project, task, assignedTask, startedTask };
}

export async function specializationIds(): Promise<[string, string]> {
  const rows = await q<{ id: string }>(`SELECT id FROM specializations ORDER BY name LIMIT 2`);
  return [rows[0]!.id, rows[1]!.id];
}

/** أحداث التدقيق لمهمة/مشروع كما في قاعدة الاختبار (للتحقق المباشر). */
export const auditTypes = async (where: string, params: unknown[]): Promise<string[]> =>
  (await q<{ type: string }>(`SELECT type FROM audit_events WHERE ${where} ORDER BY created_at, id`, params)).map((r) => r.type);

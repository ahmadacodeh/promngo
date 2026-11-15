import { randomUUID } from 'node:crypto';
import { q } from './db.js';

export type Role = 'EXECUTIVE_MANAGER' | 'PROJECT_MANAGER' | 'SPECIALIZED_MANAGER' | 'EMPLOYEE';
export const TEST_PASSWORD = 'Valid-Pass-123';

export async function createCompany(opts: { name?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' } = {}) {
  const id = randomUUID();
  const slug = `co-${id.slice(0, 8)}`;
  await q(`INSERT INTO companies (id, name, slug, status) VALUES ($1, $2, $3, $4)`, [id, opts.name ?? `شركة ${slug}`, slug, opts.status ?? 'ACTIVE']);
  return { id, slug };
}

export interface TestUser {
  id: string;
  companyId: string;
  email: string;
  password: string;
  role: Role;
}

/** ينشئ مستخدمًا وكلمة مروره تُجزَّأ داخل PostgreSQL نفسه (auth_set_password) كما في الإنتاج. */
export async function createUser(opts: {
  companyId: string;
  role?: Role;
  email?: string;
  password?: string;
  mustChangePassword?: boolean;
  isActive?: boolean;
  fullName?: string;
}): Promise<TestUser> {
  const id = randomUUID();
  const email = opts.email ?? `u-${id.slice(0, 8)}@example.test`;
  const password = opts.password ?? TEST_PASSWORD;
  const role = opts.role ?? 'EMPLOYEE';
  await q(
    `INSERT INTO users (id, company_id, full_name, email, role, is_active) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, opts.companyId, opts.fullName ?? 'مستخدم اختبار', email, role, opts.isActive ?? true],
  );
  await q(`SELECT auth_set_password($1, $2, $3)`, [id, password, opts.mustChangePassword ?? false]);
  return { id, companyId: opts.companyId, email, password, role };
}

/** شركتان معزولتان، كل منهما بمدير تنفيذي ومدير مشروع وموظف: أساس اختبارات العزل. */
export async function twoCompanyFixture() {
  const a = await createCompany({ name: 'شركة أ' });
  const b = await createCompany({ name: 'شركة ب' });
  const mk = async (companyId: string) => ({
    executive: await createUser({ companyId, role: 'EXECUTIVE_MANAGER' }),
    projectManager: await createUser({ companyId, role: 'PROJECT_MANAGER' }),
    employee: await createUser({ companyId, role: 'EMPLOYEE' }),
  });
  return { a: { company: a, ...(await mk(a.id)) }, b: { company: b, ...(await mk(b.id)) } };
}

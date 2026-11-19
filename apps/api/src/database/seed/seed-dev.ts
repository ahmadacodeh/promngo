/**
 * بيانات التطوير: node dist/database/seed/seed-dev.js [--reset]
 * - يرفض NODE_ENV=production.
 * - كلمة المرور من SEED_PASSWORD (البيئة) أو تُولَّد عشوائيًا وتُطبع مرة واحدة. لا تُكتب في الكود.
 * - التجزئة داخل PostgreSQL (auth_set_password) كما في الإنتاج.
 * - شركتان معزولتان (slug: seed-alpha / seed-beta). --reset يعيد بناءهما فقط ولا يمس غيرهما.
 * لكل شركة 3 مشاريع (نشط/مخطَّط/مكتمل) و15 مهمة تغطي كل الحالات والأولويات وتأخرًا واعتماديات وتسليمات ومراجعات
 * وأحداث تدقيق (انظر seed-work.ts). مرفقات التسليم ملفات حقيقية تُكتب تحت UPLOAD_DIR.
 */
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { loadEnvFile } from '../../config/load-env.js';
import { validateEnv } from '../../config/env.js';
import { passwordPolicyProblems } from '../../auth/password-policy.js';
import { createDataSource } from '../data-source.js';
import { seedWork, type SeededUser, type Who } from './seed-work.js';

export const SEED_COMPANIES = [
  { slug: 'seed-alpha', name: 'شركة ألفا (بيانات تطوير)', domain: 'alpha.test' },
  { slug: 'seed-beta', name: 'شركة بيتا (بيانات تطوير)', domain: 'beta.test' },
] as const;

interface SeedUser {
  key: string;
  fullName: string;
  role: 'EXECUTIVE_MANAGER' | 'PROJECT_MANAGER' | 'SPECIALIZED_MANAGER' | 'EMPLOYEE';
  canCreateProjects: boolean;
  spec: string | null;
}

export const SEED_USERS: SeedUser[] = [
  { key: 'exec', fullName: 'سارة المدير التنفيذي', role: 'EXECUTIVE_MANAGER', canCreateProjects: true, spec: null },
  { key: 'pm', fullName: 'خالد مدير المشاريع', role: 'PROJECT_MANAGER', canCreateProjects: true, spec: null },
  { key: 'spec1', fullName: 'نور مديرة الواجهات', role: 'SPECIALIZED_MANAGER', canCreateProjects: false, spec: 'الواجهات الأمامية' },
  { key: 'spec2', fullName: 'عمر مدير الخلفية', role: 'SPECIALIZED_MANAGER', canCreateProjects: false, spec: 'الواجهات الخلفية' },
  { key: 'emp1', fullName: 'ليلى الموظفة', role: 'EMPLOYEE', canCreateProjects: false, spec: 'الواجهات الأمامية' },
  { key: 'emp2', fullName: 'يوسف الموظف', role: 'EMPLOYEE', canCreateProjects: false, spec: 'ضمان الجودة' },
];

export const seedEmail = (key: string, domain: string): string => `${key}@${domain}`;

/** يحذف شركتي seed وكل ما يتبعهما (والمرفقات على القرص) دون المساس بغيرهما. */
export async function resetSeedData(ds: DataSource, uploadDir?: string): Promise<void> {
  const slugs = SEED_COMPANIES.map((c) => c.slug);
  await ds.transaction(async (m) => {
    const ids: Array<{ id: string }> = await m.query(`SELECT id FROM companies WHERE slug = ANY($1)`, [slugs]);
    const list = ids.map((r) => r.id);
    if (list.length === 0) return;
    // الفرعية قبل الرئيسية: المفتاح الأجنبي الذاتي RESTRICT يمنع حذف الأب والابن في عبارة واحدة بترتيب غير مضمون.
    await m.query(`DELETE FROM audit_reports WHERE company_id = ANY($1)`, [list]);
    await m.query(`DELETE FROM audit_events WHERE company_id = ANY($1)`, [list]);
    await m.query(`DELETE FROM task_attachments WHERE company_id = ANY($1)`, [list]);
    await m.query(`DELETE FROM task_submissions WHERE company_id = ANY($1)`, [list]);
    await m.query(`DELETE FROM review_records WHERE company_id = ANY($1)`, [list]);
    await m.query(`DELETE FROM task_dependencies WHERE company_id = ANY($1)`, [list]);
    await m.query(`DELETE FROM tasks WHERE company_id = ANY($1) AND parent_task_id IS NOT NULL`, [list]);
    await m.query(`DELETE FROM tasks WHERE company_id = ANY($1)`, [list]);
    for (const t of ['projects', 'refresh_sessions', 'users']) {
      await m.query(`DELETE FROM ${t} WHERE company_id = ANY($1)`, [list]);
    }
    await m.query(`DELETE FROM login_attempts WHERE email_key LIKE ANY($1)`, [SEED_COMPANIES.map((c) => `%@${c.domain}`)]);
    await m.query(`DELETE FROM companies WHERE id = ANY($1)`, [list]);
    // ملفات المرفقات تخص شركتي seed فقط (مسارها يبدأ بمعرّف الشركة).
    if (uploadDir) for (const id of list) await rm(join(uploadDir, id), { recursive: true, force: true });
  });
}

export async function seedDev(ds: DataSource, password: string, opts: { uploadDir?: string } = {}): Promise<void> {
  await ds.transaction(async (m) => {
    for (const c of SEED_COMPANIES) {
      const co = (await m.query(`INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`, [c.name, c.slug]))[0];
      const seeded = {} as Record<Who, SeededUser>;
      for (const u of SEED_USERS) {
        const spec = u.spec ? (await m.query(`SELECT id FROM specializations WHERE name = $1`, [u.spec]))[0]?.id ?? null : null;
        const row = (
          await m.query(
            `INSERT INTO users (company_id, full_name, email, role, can_create_projects, specialization_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [co.id, u.fullName, seedEmail(u.key, c.domain), u.role, u.canCreateProjects, spec],
          )
        )[0];
        await m.query(`SELECT auth_set_password($1, $2, FALSE)`, [row.id, password]);
        seeded[u.key as Who] = { id: row.id, role: u.role, specialization: u.spec };
      }
      await seedWork(m, co.id, seeded, opts.uploadDir);
    }
  });
}

async function main(): Promise<void> {
  loadEnvFile();
  if (process.env.NODE_ENV === 'production') {
    console.error('seed:dev مرفوض في الإنتاج (NODE_ENV=production).');
    process.exit(1);
  }
  const env = validateEnv(process.env);
  let password = (process.env.SEED_PASSWORD ?? '').trim();
  let generated = false;
  if (password) {
    const problems = passwordPolicyProblems(password);
    if (problems.length) {
      console.error(`SEED_PASSWORD لا يحقق السياسة: ${problems.join(' ')}`);
      process.exit(1);
    }
  } else {
    password = `${randomBytes(9).toString('base64url')}a1`; // عشوائية، تحقق الحرف والرقم
    generated = true;
  }

  const ds = createDataSource(env);
  await ds.initialize();
  try {
    const existing = Number((await ds.query(`SELECT COUNT(*)::int AS n FROM companies WHERE slug = ANY($1)`, [SEED_COMPANIES.map((c) => c.slug)]))[0].n);
    if (existing > 0 && !process.argv.includes('--reset')) {
      console.log('بيانات التطوير موجودة. استخدم --reset لإعادة بنائها (يمس شركتي seed فقط).');
      return;
    }
    if (existing > 0) await resetSeedData(ds, env.UPLOAD_DIR);
    await seedDev(ds, password, { uploadDir: env.UPLOAD_DIR });
    console.log('تم زرع بيانات التطوير: شركتان × (6 مستخدمين + 3 مشاريع + 15 مهمة).');
    console.log('البريد: <exec|pm|spec1|spec2|emp1|emp2>@alpha.test و@beta.test');
    console.log(generated ? `كلمة المرور (تُعرض مرة واحدة، دوّنها): ${password}` : 'كلمة المرور: قيمة SEED_PASSWORD من البيئة.');
  } finally {
    await ds.destroy();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

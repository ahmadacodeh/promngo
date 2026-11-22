/**
 * أمر المشغّل لإنشاء شركة جديدة وأول مدير تنفيذي لها (قرار المالك T21، 2026-11-22).
 *
 *   node dist/database/ops/company-create.js --name "شركة النور" --slug al-noor \
 *        --admin-name "سارة أحمد" --admin-email sara@alnoor.example
 *
 * - يعمل في الإنتاج أيضًا (هذا هو المسار المعتمد لإضافة شركة؛ لا تسجيل ذاتي في الـ API).
 * - كلمة مرور مؤقتة عشوائية تُطبع مرة واحدة على stdout ولا تُخزَّن إلا تجزئتها (داخل PostgreSQL)،
 *   ويُلزَم المدير بتغييرها عند أول دخول.
 * - كل شيء في معاملة واحدة: الشركة + المدير + كلمة المرور + حدث تدقيق COMPANY_CREATED.
 * - رموز الخروج: 0 نجاح، 2 مدخلات غير صالحة، 3 تعارض (slug أو بريد مستخدم)، 1 خطأ آخر.
 */
import { isEmail } from 'class-validator';
import type { DataSource } from 'typeorm';
import { loadEnvFile } from '../../config/load-env.js';
import { validateEnv } from '../../config/env.js';
import { generateTemporaryPassword } from '../../common/temp-password.js';
import { recordAudit } from '../../work/audit.js';
import { createDataSource } from '../data-source.js';

export interface CompanyCreateInput {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
}

export interface CompanyCreateResult {
  companyId: string;
  adminId: string;
  adminEmail: string;
  temporaryPassword: string;
}

export class CompanyCreateError extends Error {
  constructor(
    readonly kind: 'INVALID' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** يتحقق من المدخلات ويطبّعها، ويعيد كل المشكلات معًا (لا واحدة في كل مرة). */
export function normalizeCompanyInput(raw: Partial<CompanyCreateInput>): CompanyCreateInput {
  const name = (raw.name ?? '').trim();
  const slug = (raw.slug ?? '').trim().toLowerCase();
  const adminName = (raw.adminName ?? '').trim();
  const adminEmail = (raw.adminEmail ?? '').trim().toLowerCase();
  const problems: string[] = [];
  if (name.length < 2 || name.length > 180) problems.push('--name: اسم الشركة مطلوب (2–180 حرفًا).');
  if (!SLUG_RE.test(slug) || slug.length > 100) {
    problems.push('--slug: معرّف قصير بأحرف إنجليزية صغيرة وأرقام وشرطات فقط (مثل al-noor)، حتى 100 حرف.');
  }
  if (adminName.length < 2 || adminName.length > 150) problems.push('--admin-name: اسم المدير التنفيذي مطلوب (2–150 حرفًا).');
  if (!isEmail(adminEmail) || adminEmail.length > 255) problems.push('--admin-email: بريد إلكتروني صالح مطلوب.');
  if (problems.length) throw new CompanyCreateError('INVALID', problems.join('\n'));
  return { name, slug, adminName, adminEmail };
}

type PgErr = { code?: string; constraint?: string; detail?: string; driverError?: PgErr };
/** TypeORM يغلّف خطأ pg في QueryFailedError؛ نقرأ الأصل إن وُجد. */
const uniqueViolation = (e: unknown): PgErr | null => {
  if (typeof e !== 'object' || e === null) return null;
  const err = (e as PgErr).driverError ?? (e as PgErr);
  return err.code === '23505' ? err : null;
};

export async function createCompany(ds: DataSource, raw: Partial<CompanyCreateInput>): Promise<CompanyCreateResult> {
  const input = normalizeCompanyInput(raw);
  const temporaryPassword = generateTemporaryPassword();
  try {
    return await ds.transaction(async (m) => {
      const co = (await m.query(`INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`, [input.name, input.slug]))[0];
      const admin = (
        await m.query(
          `INSERT INTO users (company_id, full_name, email, role, can_create_projects)
           VALUES ($1, $2, $3, 'EXECUTIVE_MANAGER', TRUE) RETURNING id`,
          [co.id, input.adminName, input.adminEmail],
        )
      )[0];
      await m.query(`SELECT auth_set_password($1, $2, TRUE)`, [admin.id, temporaryPassword]); // التجزئة داخل PostgreSQL
      // لا فاعل من المستخدمين: المشغّل خارج النظام، فيبقى actor_id فارغًا ويُذكر المصدر.
      await recordAudit(m, {
        companyId: co.id,
        entity: 'USER',
        entityId: admin.id,
        type: 'COMPANY_CREATED',
        actorId: null,
        meta: { source: 'operator-cli', companyName: input.name, slug: input.slug, role: 'EXECUTIVE_MANAGER' },
      });
      return { companyId: co.id as string, adminId: admin.id as string, adminEmail: input.adminEmail, temporaryPassword };
    });
  } catch (e) {
    const dup = uniqueViolation(e);
    if (dup) {
      const where = `${dup.constraint ?? ''} ${dup.detail ?? ''}`;
      if (/slug/.test(where)) throw new CompanyCreateError('CONFLICT', `المعرّف "${input.slug}" مستخدم لشركة أخرى. اختر --slug مختلفًا.`);
      if (/email/.test(where)) throw new CompanyCreateError('CONFLICT', `البريد "${input.adminEmail}" مستخدم لحساب آخر. البريد فريد على مستوى المنصة كلها.`);
      throw new CompanyCreateError('CONFLICT', 'تعارض مع بيانات موجودة.');
    }
    throw e;
  }
}

/** يقرأ --key value أو --key=value. */
export function parseArgs(argv: string[]): Partial<CompanyCreateInput> {
  const map: Record<string, keyof CompanyCreateInput> = { name: 'name', slug: 'slug', 'admin-name': 'adminName', 'admin-email': 'adminEmail' };
  const out: Partial<CompanyCreateInput> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]!);
    if (!m) continue;
    const key = map[m[1]!];
    if (!key) continue;
    out[key] = m[2] ?? argv[++i] ?? '';
  }
  return out;
}

const USAGE = 'الاستخدام: npm run company:create -- --name "اسم الشركة" --slug short-id --admin-name "اسم المدير" --admin-email admin@example.com';

async function main(): Promise<number> {
  loadEnvFile();
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    console.log(USAGE);
    return args.length === 0 ? 2 : 0;
  }
  const env = validateEnv(process.env);
  const ds = createDataSource(env);
  await ds.initialize();
  try {
    const r = await createCompany(ds, parseArgs(args));
    console.log('تم إنشاء الشركة وأول مدير تنفيذي.');
    console.log(`معرّف الشركة: ${r.companyId}`);
    console.log(`البريد: ${r.adminEmail}`);
    console.log(`كلمة المرور المؤقتة (تُعرض مرة واحدة، سلّمها للمدير بقناة آمنة؛ سيُطلب تغييرها عند أول دخول): ${r.temporaryPassword}`);
    return 0;
  } catch (e) {
    if (e instanceof CompanyCreateError) {
      console.error(e.message);
      if (e.kind === 'INVALID') console.error(USAGE);
      return e.kind === 'INVALID' ? 2 : 3;
    }
    throw e;
  } finally {
    await ds.destroy();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

/** اتصال مباشر من الاختبارات بقاعدة الاختبار (للتجهيز والتحقق، لا لتجاوز التطبيق). */
export function testPool(): pg.Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

export async function q<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await testPool().query<T>(sql, params)).rows;
}

/** يمسح كل البيانات المتغيرة (التخصصات عامة وتبقى). يعمل فقط على قاعدة *_test. */
export async function resetDb(): Promise<void> {
  const name = (await q<{ n: string }>('SELECT current_database() AS n'))[0]!.n;
  if (!name.endsWith('_test')) throw new Error(`resetDb مرفوض على القاعدة «${name}»`);
  await q('TRUNCATE companies, login_attempts RESTART IDENTITY CASCADE');
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

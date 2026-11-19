/**
 * إعدادات البيئة: تحقق صارم عند الإقلاع. الخادم يرفض العمل إن غابت الأسرار أو كانت ضعيفة.
 * لا قيم سرية افتراضية هنا إطلاقًا.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  WEB_ORIGIN: string[];
  TRUST_PROXY: boolean;
  DATABASE_URL: string;
  DATABASE_SSL: 'false' | 'true' | 'no-verify';
  DATABASE_SSL_CA: string | undefined;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  BILLING_ENCRYPTION_KEY: string;
  /** جذر تخزين مرفقات التسليم (مسار مطلق). التخزين: <UPLOAD_DIR>/<companyId>/<taskId>/<uuid>.<ext>. */
  UPLOAD_DIR: string;
}

const MIN_SECRET_LENGTH = 32;

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`إعدادات البيئة غير صالحة:\n - ${problems.join('\n - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** يُستدعى من ConfigModule (validate) ومن الاختبارات الوحدوية مباشرة. */
export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const problems: string[] = [];
  const str = (k: string): string => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');

  const nodeEnv = str('NODE_ENV') || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    problems.push('NODE_ENV يجب أن يكون development أو test أو production');
  }

  const port = Number(str('PORT') || '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT غير صالح');

  const dbUrl = str('DATABASE_URL');
  if (!/^postgres(ql)?:\/\//.test(dbUrl)) problems.push('DATABASE_URL مطلوب ويجب أن يبدأ بـ postgresql://');

  const ssl = str('DATABASE_SSL') || 'false';
  if (!['false', 'true', 'no-verify'].includes(ssl)) problems.push('DATABASE_SSL يجب أن يكون false أو true أو no-verify');
  if (nodeEnv === 'production' && ssl === 'false') {
    problems.push('DATABASE_SSL=false غير مسموح في الإنتاج: يجب تشفير الاتصال بقاعدة البيانات');
  }

  const secrets: Array<'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET' | 'BILLING_ENCRYPTION_KEY'> = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'BILLING_ENCRYPTION_KEY',
  ];
  for (const k of secrets) {
    const v = str(k);
    if (v.length < MIN_SECRET_LENGTH) problems.push(`${k} مطلوب ولا يقل عن ${MIN_SECRET_LENGTH} حرفًا`);
    if (/^CHANGE_ME/i.test(v)) problems.push(`${k} ما زال قيمة المثال CHANGE_ME`);
  }
  const distinct = new Set(secrets.map((k) => str(k)));
  if (distinct.size !== secrets.length) problems.push('أسرار JWT ومفتاح الفوترة يجب أن تكون مختلفة عن بعضها');

  if (problems.length > 0) throw new EnvValidationError(problems);

  return {
    NODE_ENV: nodeEnv as AppEnv['NODE_ENV'],
    PORT: port,
    WEB_ORIGIN: (str('WEB_ORIGIN') || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    TRUST_PROXY: ['1', 'true'].includes(str('TRUST_PROXY')),
    DATABASE_URL: dbUrl,
    DATABASE_SSL: ssl as AppEnv['DATABASE_SSL'],
    DATABASE_SSL_CA: str('DATABASE_SSL_CA') || undefined,
    JWT_ACCESS_SECRET: str('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: str('JWT_REFRESH_SECRET'),
    BILLING_ENCRYPTION_KEY: str('BILLING_ENCRYPTION_KEY'),
    UPLOAD_DIR: resolve(str('UPLOAD_DIR') || './storage/uploads'),
  };
}

export type PgSslOption = false | { rejectUnauthorized: boolean; ca?: string };

/** يبني خيار ssl لمكتبة pg من البيئة. دالة نقية قابلة للاختبار. */
export function buildDbSslOptions(
  mode: AppEnv['DATABASE_SSL'] | string | undefined,
  caPath?: string,
  readFile: (p: string) => string = (p) => readFileSync(p, 'utf8'),
): PgSslOption {
  if (!mode || mode === 'false') return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  if (mode === 'true') {
    return caPath ? { rejectUnauthorized: true, ca: readFile(caPath) } : { rejectUnauthorized: true };
  }
  throw new EnvValidationError([`DATABASE_SSL قيمة غير معروفة: ${String(mode)}`]);
}

export const ENV_TOKEN = Symbol('APP_ENV');

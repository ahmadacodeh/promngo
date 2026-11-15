import { describe, expect, it } from 'vitest';
import { EnvValidationError, validateEnv } from './env.js';

const good = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BILLING_ENCRYPTION_KEY: 'c'.repeat(32),
};

describe('validateEnv', () => {
  it('يقبل إعدادًا صحيحًا مع القيم الافتراضية', () => {
    const env = validateEnv(good);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEB_ORIGIN).toEqual(['http://localhost:5173']);
  });
  it('يرفض غياب الأسرار أو قصرها', () => {
    expect(() => validateEnv({ ...good, JWT_ACCESS_SECRET: 'short' })).toThrow(EnvValidationError);
    expect(() => validateEnv({ ...good, BILLING_ENCRYPTION_KEY: undefined })).toThrow(EnvValidationError);
  });
  it('يرفض تطابق الأسرار وقيمة CHANGE_ME', () => {
    expect(() => validateEnv({ ...good, JWT_REFRESH_SECRET: good.JWT_ACCESS_SECRET })).toThrow(/مختلفة/);
    expect(() => validateEnv({ ...good, JWT_ACCESS_SECRET: 'CHANGE_ME' + 'x'.repeat(30) })).toThrow(/CHANGE_ME/);
  });
  it('يرفض DATABASE_SSL=false في الإنتاج', () => {
    expect(() => validateEnv({ ...good, NODE_ENV: 'production', DATABASE_SSL: 'false' })).toThrow(/الإنتاج/);
    expect(() => validateEnv({ ...good, NODE_ENV: 'production', DATABASE_SSL: 'true' })).not.toThrow();
  });
  it('يرفض منفذًا وURL قاعدة غير صالحين، ويفصل أصول CORS المتعددة', () => {
    expect(() => validateEnv({ ...good, PORT: '99999' })).toThrow(EnvValidationError);
    expect(() => validateEnv({ ...good, DATABASE_URL: 'mysql://x' })).toThrow(EnvValidationError);
    expect(validateEnv({ ...good, WEB_ORIGIN: 'http://a.test, http://b.test' }).WEB_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
  });
  it('رسالة الخطأ لا تحوي قيم الأسرار', () => {
    try {
      validateEnv({ ...good, JWT_ACCESS_SECRET: 'tooShortSecret' });
    } catch (e) {
      expect((e as Error).message).not.toContain('tooShortSecret');
    }
  });
});

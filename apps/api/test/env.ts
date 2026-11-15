import { loadEnvFile } from '../src/config/load-env.js';

/** يحمّل .env ويُلزم اتجاه الاختبارات إلى TEST_DATABASE_URL فقط، واسمها ينتهي بـ _test. */
export function prepareTestEnv(): { testDbUrl: string } {
  loadEnvFile();
  const testDbUrl = process.env.TEST_DATABASE_URL?.trim() ?? '';
  if (!testDbUrl) throw new Error('TEST_DATABASE_URL غير مضبوط: اختبارات E2E تحتاج قاعدة *_test منفصلة.');
  const dbName = new URL(testDbUrl).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`رفض التشغيل: اسم قاعدة الاختبار «${dbName}» لا ينتهي بـ _test (حماية لبيانات التطوير).`);
  }
  if (testDbUrl === process.env.DATABASE_URL) {
    throw new Error('رفض التشغيل: TEST_DATABASE_URL يساوي DATABASE_URL.');
  }
  return { testDbUrl };
}

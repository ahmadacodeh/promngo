import { execFileSync } from 'node:child_process';

/**
 * حد محاولات الدخول مخزّن في القاعدة (30 فشلًا/IP كل 15 دقيقة). لتبقى الجولات المتتالية قابلة للتكرار
 * نصفّر جدول المحاولات قبل التشغيل — فقط في قاعدة تطوير/اختبار صريحة وعبر E2E_DATABASE_URL.
 * إن لم يُضبط المتغير نكمل دون تصفير (وقد تظهر 429 إن أعدت التشغيل خلال 15 دقيقة).
 */
export default function globalSetup(): void {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) return;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/(_dev|_test)$/.test(dbName)) {
    throw new Error(`رفض تصفير login_attempts: اسم القاعدة "${dbName}" لا ينتهي بـ _dev أو _test.`);
  }
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', 'DELETE FROM login_attempts'], { stdio: 'ignore' });
}

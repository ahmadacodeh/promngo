import { cleanupE2eUsers, resetLoginAttempts } from './db';

/**
 * قبل التشغيل، وفقط في قاعدة تطوير/اختبار صريحة عبر E2E_DATABASE_URL:
 *  - نصفّر محاولات الدخول (الحد مخزّن في القاعدة) لتبقى الجولات المتتالية قابلة للتكرار؛
 *  - ننظّف مستخدمي E2E المتروكين من جولات سابقة (انظر db.ts).
 * إن لم يُضبط المتغير نكمل دون ذلك (وقد تظهر 429 إن أعدت التشغيل خلال 15 دقيقة).
 */
export default function globalSetup(): void {
  resetLoginAttempts();
  cleanupE2eUsers();
}

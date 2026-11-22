import { cleanupE2eUsers } from './db';

/** بعد التشغيل: نزيل مستخدمي E2E الذين أنشأتهم الاختبارات كي لا تلوّث قاعدة التطوير. */
export default function globalTeardown(): void {
  cleanupE2eUsers();
}

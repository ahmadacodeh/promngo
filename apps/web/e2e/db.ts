import { execFileSync } from 'node:child_process';

/**
 * وصول E2E إلى القاعدة لأغراض التهيئة والتنظيف فقط (لا تُقرأ نتائج الاختبارات منها).
 * مرفوض صراحةً على أي قاعدة لا ينتهي اسمها بـ _dev أو _test، ولا يعمل دون E2E_DATABASE_URL.
 */
export function e2eDatabaseUrl(): string | null {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) return null;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/(_dev|_test)$/.test(dbName)) {
    throw new Error(`رفض العمل على القاعدة "${dbName}": اسمها لا ينتهي بـ _dev أو _test.`);
  }
  return url;
}

/** مستخدمو الاختبارات يحملون هذه البادئة والنطاق حصرًا، فلا يُمَسّ مستخدم البذر. */
const E2E_USER_EMAIL = String.raw`^e2e-.*@alpha\.test$`;

/** المشاريع التي تنشئها الاختبارات تبدأ أسماؤها بهذه البادئة (لا يُمَسّ مشروع بذر). */
export const E2E_PROJECT_PREFIX = 'E2E ';

/**
 * يحذف المشاريع ثم المستخدمين الذين أنشأتهم اختبارات E2E حتى لا تتراكم في قاعدة التطوير (فتزاحم مستخدمي البذر في
 * القائمة المرقّمة وتجعل النتائج تعتمد على تاريخ التشغيلات السابقة).
 * أفضل جهد: إن منع حذفَهم قيدٌ (مثل مستخدم نفّذ إجراءً مدقَّقًا) نحذّر ولا نُفشل التشغيل.
 * يعيد عدد المحذوفين، أو null إن لم يُضبط E2E_DATABASE_URL.
 */
export function cleanupE2eUsers(): number | null {
  const url = e2eDatabaseUrl();
  if (!url) return null;
  try {
    // المشاريع أولًا (وما يتبعها)، ثم المستخدمون — حتى لا يمنع قيدٌ حذف من أنشأ مشروعًا.
    const projects = `SELECT id FROM projects WHERE name LIKE '${E2E_PROJECT_PREFIX}%'`;
    const sql = [
      'BEGIN',
      `DELETE FROM audit_events WHERE project_id IN (${projects})`,
      `DELETE FROM task_dependencies WHERE project_id IN (${projects})`,
      `DELETE FROM tasks WHERE project_id IN (${projects}) AND parent_task_id IS NOT NULL`,
      `DELETE FROM tasks WHERE project_id IN (${projects})`,
      `DELETE FROM projects WHERE name LIKE '${E2E_PROJECT_PREFIX}%'`,
      'COMMIT',
    ].join('; ');
    execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'ignore' });
    const out = execFileSync(
      'psql',
      [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', `WITH d AS (DELETE FROM users WHERE email ~ '${E2E_USER_EMAIL}' RETURNING 1) SELECT count(*) FROM d`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return Number.parseInt(out.trim(), 10);
  } catch (e) {
    process.stderr.write(`تنبيه: تعذّر تنظيف مستخدمي E2E (${(e as Error).message.split('\n')[0]}). سيبقى بعضهم في القاعدة.\n`);
    return null;
  }
}

/** تصفير جدول محاولات الدخول (حدّ 30 فشلًا/IP كل 15 دقيقة) لتتكرر الجولات المتتالية. */
export function resetLoginAttempts(): void {
  const url = e2eDatabaseUrl();
  if (!url) return;
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', 'DELETE FROM login_attempts'], { stdio: 'ignore' });
}

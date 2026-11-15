/**
 * مشغّل الـ migrations: node dist/database/migrate.js run | revert | show
 * يقرأ DATABASE_URL من البيئة (.env). ملاحظة: يحتاج الدور مالكًا لقاعدة البيانات لإنشاء pgcrypto (إضافة موثوقة).
 */
import { loadEnvFile } from '../config/load-env.js';
import { validateEnv } from '../config/env.js';
import { createDataSource } from './data-source.js';

async function main(): Promise<void> {
  loadEnvFile();
  const cmd = process.argv[2] ?? 'show';
  if (!['run', 'revert', 'show'].includes(cmd)) {
    console.error('الاستخدام: migrate.js run | revert | show');
    process.exit(2);
  }
  const env = validateEnv(process.env);
  const ds = createDataSource(env);
  await ds.initialize();
  try {
    if (cmd === 'run') {
      const done = await ds.runMigrations({ transaction: 'each' });
      console.log(done.length ? `طُبّقت: ${done.map((m) => m.name).join(', ')}` : 'لا migrations جديدة.');
    } else if (cmd === 'revert') {
      await ds.undoLastMigration({ transaction: 'each' });
      console.log('تم التراجع عن آخر migration.');
    } else {
      const pending = await ds.showMigrations();
      console.log(pending ? 'توجد migrations غير مطبّقة.' : 'كل الـ migrations مطبّقة.');
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

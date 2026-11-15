import 'reflect-metadata';
import { createDataSource } from '../src/database/data-source.js';
import { prepareTestEnv } from './env.js';

/** مرة واحدة قبل كل الاختبارات: تطبيق الـ migrations على قاعدة *_test (والتحقق من اسمها أولًا). */
export default async function globalSetup(): Promise<void> {
  const { testDbUrl } = prepareTestEnv();
  const ds = createDataSource({ DATABASE_URL: testDbUrl, DATABASE_SSL: 'false', DATABASE_SSL_CA: undefined, NODE_ENV: 'test' });
  await ds.initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}

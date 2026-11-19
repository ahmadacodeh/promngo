import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareTestEnv } from './env.js';

// قبل أي استيراد للتطبيق: كل اتصال بالقاعدة يذهب لقاعدة الاختبار.
const { testDbUrl } = prepareTestEnv();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDbUrl;
process.env.DATABASE_SSL = 'false';
process.env.WEB_ORIGIN = 'http://localhost:5173';
// مرفقات الاختبار في مجلد مؤقت منفصل (لا تلمس storage/ الخاص بالتطوير).
process.env.UPLOAD_DIR = join(tmpdir(), 'promango-test-uploads');

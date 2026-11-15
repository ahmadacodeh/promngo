import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

/** يحمّل apps/api/.env إن وُجد (لا يطغى على متغيرات البيئة الفعلية). */
export function loadEnvFile(): void {
  loadDotenv({ path: resolve(process.cwd(), '.env'), quiet: true });
}

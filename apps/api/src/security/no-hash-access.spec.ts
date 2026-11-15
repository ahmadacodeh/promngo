import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

/**
 * حارس معماري: التجزئة وكلمات المرور تُعالَج داخل PostgreSQL فقط. لا كود تطبيق (خارج migrations
 * وهذا الملف) يقرأ العمود password_hash أو يستدعي crypt/gen_salt مباشرة.
 */
describe('كلمة المرور لا تُقرأ ولا تُجزَّأ في كود التطبيق', () => {
  const offenders = walk(SRC)
    .filter((f) => !f.includes(`${join('src', 'database', 'migrations')}`) && !f.endsWith('no-hash-access.spec.ts') && !f.includes(join('src', 'database', 'seed')))
    .filter((f) => /password_hash|gen_salt\(|\bcrypt\(/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f));
  it('لا ملفات مخالفة', () => expect(offenders).toEqual([]));
});

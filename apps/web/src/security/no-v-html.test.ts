import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

describe('حماية XSS والهوية في الواجهة', () => {
  // فقط الكود المشحون للمتصفح (الاختبارات وأدواتها خارج النطاق).
  const files = walk(SRC).filter((f) => /\.(vue|ts)$/.test(f) && !f.endsWith('.test.ts') && !f.includes(`${join('src', 'test')}`));
  it('لا v-html ولا innerHTML ولا eval في الكود', () => {
    const bad = files.filter((f) => /v-html|\.innerHTML\s*=|\beval\(|new Function\(/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('لا ألوان الهوية مكتوبة مباشرة داخل المكوّنات (var(--…) فقط)', () => {
    const bad = files.filter((f) => f.endsWith('.vue')).filter((f) => /#(123b35|16845b|f28c28)/i.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('لا خصائص left/right الفيزيائية في ستايلات المكوّنات (RTL-first: خصائص منطقية فقط)', () => {
    const offenders = files
      .filter((f) => f.endsWith('.vue'))
      .filter((f) => /^\s*(margin|padding)-(left|right)\s*:|^\s*(left|right)\s*:|text-align:\s*(left|right)/m.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

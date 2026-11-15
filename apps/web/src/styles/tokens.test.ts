import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
const token = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1]!;
};
const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(token(a)), lum(token(b))].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('الهوية: قيم Figma', () => {
  it('الألوان الأساسية كما في Figma', () => {
    expect(token('forest').toLowerCase()).toBe('#123b35');
    expect(token('emerald').toLowerCase()).toBe('#16845b');
    expect(token('mango').toLowerCase()).toBe('#f28c28');
    expect(token('canvas').toLowerCase()).toBe('#f8faf9');
  });
  it('الخط Cairo أولًا', () => expect(css).toMatch(/--font-sans:\s*'Cairo'/));
});

describe('تباين النصوص (WCAG AA ≥ 4.5:1) للأزواج المستخدمة فعليًا', () => {
  const pairs: Array<[string, string, string]> = [
    ['surface', 'emerald', 'نص أبيض على زر Emerald'],
    ['surface', 'emerald-hover', 'نص أبيض على زر Emerald (hover)'],
    ['surface', 'red-ink', 'نص أبيض على زر الخطر'],
    ['ink', 'canvas', 'النص الأساسي على Canvas'],
    ['ink', 'surface', 'النص الأساسي على البطاقة'],
    ['muted', 'surface', 'النص الثانوي على البطاقة'],
    ['muted', 'canvas', 'النص الثانوي على Canvas'],
    ['forest', 'surface', 'العناوين'],
    ['emerald-ink', 'mint', 'شارة النجاح'],
    ['emerald-ink', 'emerald-soft', 'زر ghost عند hover'],
    ['mango-ink', 'mango-soft', 'تنبيه/شارة تحذير'],
    ['red-ink', 'red-soft', 'خطأ'],
    ['blue-ink', 'blue-soft', 'معلومة'],
    ['red-ink', 'surface', 'رسالة خطأ الحقل'],
    ['emerald-ink', 'surface', 'رابط'],
  ];
  it.each(pairs)('%s على %s — %s', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('Mango وحده لا يصلح لنص صغير (يُستخدم للتأكيد فقط) — موثّق', () => {
    expect(ratio('mango', 'surface')).toBeLessThan(3);
  });
});

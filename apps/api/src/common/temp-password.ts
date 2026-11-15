import { randomInt } from 'node:crypto';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const ALL = LETTERS + DIGITS;
const pick = (s: string): string => s[randomInt(s.length)]!;

/**
 * كلمة مرور مؤقتة عشوائية (CSPRNG) بصيغة XXXX-XXXX-XXXX، بلا رموز ملتبسة، وتضمن حرفًا ورقمًا.
 * تُعرض مرة واحدة فقط ولا تُخزَّن ولا تُسجَّل (القاعدة تحفظ تجزئتها فقط).
 */
export function generateTemporaryPassword(): string {
  const chars = Array.from({ length: 12 }, () => pick(ALL));
  chars[randomInt(12)] = pick(DIGITS);
  let i = randomInt(12);
  while (/\d/.test(chars[i]!)) i = randomInt(12);
  chars[i] = pick(LETTERS);
  const s = chars.join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from '../common/messages.js';

/** طول كلمة المرور بالبايت (UTF-8). bcrypt يقتطع عند 72 بايت، فنرفض الأطول بدل اقتطاعه بصمت. */
export const passwordByteLength = (p: string): number => Buffer.byteLength(p, 'utf8');

/**
 * سياسة كلمة المرور الجديدة. تعيد قائمة بمشكلات عربية (فارغة = مقبولة).
 * لا تُسجَّل كلمة المرور في أي رسالة.
 */
export function passwordPolicyProblems(password: string, email?: string): string[] {
  const problems: string[] = [];
  if ([...password].length < PASSWORD_MIN_LENGTH) problems.push(`يجب ألا تقل عن ${PASSWORD_MIN_LENGTH} أحرف.`);
  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) problems.push(`يجب ألا تتجاوز ${PASSWORD_MAX_BYTES} بايت (حوالي 36 حرفًا عربيًا أو 72 حرفًا لاتينيًا).`);
  if (!/\p{L}/u.test(password)) problems.push('يجب أن تتضمن حرفًا واحدًا على الأقل.');
  if (!/\p{N}/u.test(password)) problems.push('يجب أن تتضمن رقمًا واحدًا على الأقل.');
  if (email && password.toLowerCase() === email.trim().toLowerCase()) problems.push('يجب ألا تساوي بريدك الإلكتروني.');
  return problems;
}

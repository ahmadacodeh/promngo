import { describe, expect, it } from 'vitest';
import { passwordPolicyProblems } from '../auth/password-policy.js';
import { generateTemporaryPassword } from './temp-password.js';

describe('generateTemporaryPassword', () => {
  it('تحقق سياسة كلمة المرور دائمًا وبصيغة XXXX-XXXX-XXXX بلا رموز ملتبسة', () => {
    for (let i = 0; i < 500; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
      expect(p).not.toMatch(/[0O1lI]/); // لا رموز ملتبسة
      expect(passwordPolicyProblems(p)).toEqual([]);
    }
  });
  it('فريدة عمليًا', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
    expect(set.size).toBe(200);
  });
});

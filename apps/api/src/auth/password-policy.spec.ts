import { describe, expect, it } from 'vitest';
import { passwordByteLength, passwordPolicyProblems } from './password-policy.js';

describe('passwordPolicyProblems', () => {
  it('تقبل كلمة قوية', () => expect(passwordPolicyProblems('Valid-Pass-123')).toEqual([]));
  it('ترفض القصيرة وبلا رقم وبلا حرف', () => {
    expect(passwordPolicyProblems('Ab1').length).toBeGreaterThan(0);
    expect(passwordPolicyProblems('OnlyLettersHere')).toHaveLength(1);
    expect(passwordPolicyProblems('1234567890123')).toHaveLength(1);
  });
  it('تقبل الحروف العربية كحرف', () => expect(passwordPolicyProblems('كلمةمرور12345')).toEqual([]));
  it('تحسب الطول بالبايت: 40 حرفًا عربيًا (80 بايت) مرفوضة', () => {
    const p = 'ك'.repeat(40) + '1';
    expect(passwordByteLength(p)).toBeGreaterThan(72);
    expect(passwordPolicyProblems(p).some((m) => m.includes('72'))).toBe(true);
  });
  it('72 بايت بالضبط مقبولة و73 مرفوضة', () => {
    expect(passwordPolicyProblems('a1' + 'x'.repeat(70))).toEqual([]);
    expect(passwordPolicyProblems('a1' + 'x'.repeat(71))).not.toEqual([]);
  });
  it('ترفض المساوية للبريد', () => {
    expect(passwordPolicyProblems('Person1234@x.com', 'person1234@X.com').length).toBeGreaterThan(0);
  });
});

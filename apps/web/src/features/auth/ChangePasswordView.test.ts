import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch, mountView } from '@/test/utils';
import { newPasswordProblem } from './passwordRules';
import ChangePasswordView from './ChangePasswordView.vue';

let ctx: ReturnType<typeof freshApp>;
beforeEach(() => {
  ctx = freshApp();
  ctx.auth.apply(authResponse({ mustChangePassword: true }));
});

const open = () => mountView(ChangePasswordView, { router: ctx.router, path: '/change-password' });
type W = Awaited<ReturnType<typeof open>>;
const inputs = (w: W) => w.findAll('input');
async function fillAll(w: W, cur: string, next: string, conf: string) {
  const [a, b, c] = inputs(w);
  await a!.setValue(cur);
  await b!.setValue(next);
  await c!.setValue(conf);
  await w.find('form').trigger('submit');
  await flushPromises();
}

describe('newPasswordProblem (مرآة سياسة الخادم)', () => {
  it.each([
    ['', 'x', 'a@b.co', 'أدخل'],
    ['Ab1', 'x', 'a@b.co', 'قصيرة'],
    ['OnlyLettersHere', 'x', 'a@b.co', 'حرفًا ورقمًا'],
    ['1234567890123', 'x', 'a@b.co', 'حرفًا ورقمًا'],
    ['A1' + 'y'.repeat(80), 'x', 'a@b.co', '72'],
    ['Same-Pass-123', 'Same-Pass-123', 'a@b.co', 'تختلف'],
  ])('%s', (pw, cur, email, fragment) => {
    expect(newPasswordProblem(pw, cur, email)).toContain(fragment);
  });
  it('تقبل القوية والعربية', () => {
    expect(newPasswordProblem('Valid-Pass-123', 'old', 'a@b.co')).toBe('');
    expect(newPasswordProblem('كلمةمرور12345', 'old', 'a@b.co')).toBe('');
  });
});

describe('ChangePasswordView', () => {
  it('الوضع الإلزامي يعرض سبب الإلزام وزر تسجيل الخروج', async () => {
    const w = await open();
    expect(w.text()).toContain('يجب تعيين كلمة مرور جديدة');
    expect(w.text()).toContain('تسجيل الخروج');
  });

  it('تأكيد غير مطابق وكلمة ضعيفة تُرفضان محليًا دون طلب', async () => {
    const f = mockFetch(() => jsonResponse(200, authResponse()));
    const w = await open();
    await fillAll(w, 'Temp-1234-aa', 'Valid-Pass-123', 'Different-123');
    expect(w.text()).toContain('تأكيد كلمة المرور لا يطابق');
    await fillAll(w, 'Temp-1234-aa', 'short1', 'short1');
    expect(w.text()).toContain('قصيرة');
    expect(f).not.toHaveBeenCalled();
  });

  it('نجاح: يرسل الحالية والجديدة فقط، يخزّن الرموز الجديدة، ينتقل للوحة', async () => {
    const f = mockFetch(() => jsonResponse(200, authResponse({ accessToken: 'new-a', refreshToken: 'new-r', mustChangePassword: false })));
    const w = await open();
    await fillAll(w, 'Temp-1234-aa', 'Valid-Pass-123', 'Valid-Pass-123');
    expect(String(f.mock.calls[0]![0])).toBe('/api/auth/change-password');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ currentPassword: 'Temp-1234-aa', newPassword: 'Valid-Pass-123' });
    expect(ctx.auth.mustChangePassword).toBe(false);
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.name).toBe('dashboard'));
  });

  it('خطأ الخادم على الحالية يُربط بحقلها برسالة عربية', async () => {
    mockFetch(() =>
      jsonResponse(401, { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'كلمة المرور الحالية غير صحيحة.', hint: 'أعد الكتابة.', fields: { currentPassword: 'كلمة المرور الحالية غير صحيحة.' } }),
    );
    const w = await open();
    await fillAll(w, 'Wrong-Pass-1', 'Valid-Pass-123', 'Valid-Pass-123');
    expect(w.text()).toContain('كلمة المرور الحالية غير صحيحة.');
    expect(ctx.auth.mustChangePassword).toBe(true);
  });
});

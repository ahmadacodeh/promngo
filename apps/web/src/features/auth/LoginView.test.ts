import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRefreshToken } from '@/api/session';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch, mountView } from '@/test/utils';
import LoginView from './LoginView.vue';

let ctx: ReturnType<typeof freshApp>;
beforeEach(() => {
  ctx = freshApp();
});
afterEach(() => vi.useRealTimers());

async function open(path = '/login') {
  ctx.auth.expire(); // زائر
  return mountView(LoginView, { router: ctx.router, path });
}
const fill = async (w: Awaited<ReturnType<typeof open>>, email: string, pw: string) => {
  await w.find('input[type="email"]').setValue(email);
  await w.find('input[autocomplete="current-password"]').setValue(pw);
};
const submit = async (w: Awaited<ReturnType<typeof open>>) => {
  await w.find('form').trigger('submit');
  await flushPromises();
};

describe('LoginView', () => {
  it('الإرسال الفارغ: رسائل عربية للحقلين ولا طلب شبكة', async () => {
    const f = mockFetch(() => jsonResponse(200, {}));
    const w = await open();
    await submit(w);
    expect(w.text()).toContain('أدخل بريدك الإلكتروني.');
    expect(w.text()).toContain('أدخل كلمة المرور.');
    expect(f).not.toHaveBeenCalled();
  });

  it('بريد بصيغة خاطئة يُرفض محليًا', async () => {
    const f = mockFetch(() => jsonResponse(200, {}));
    const w = await open();
    await fill(w, 'not-an-email', 'x');
    await submit(w);
    expect(w.text()).toContain('صيغة البريد غير صحيحة');
    expect(f).not.toHaveBeenCalled();
  });

  it('نجاح: POST /api/auth/login ثم الانتقال للوحة، ومسح حقل كلمة المرور', async () => {
    const f = mockFetch(() => jsonResponse(200, authResponse()));
    const w = await open();
    await fill(w, 'sara@alpha.test', 'Secret-Pass-1');
    await submit(w);
    expect(String(f.mock.calls[0]![0])).toBe('/api/auth/login');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ email: 'sara@alpha.test', password: 'Secret-Pass-1' });
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.name).toBe('dashboard'));
    expect(getRefreshToken()).toBe('refresh-1');
  });

  it('mustChangePassword → /change-password', async () => {
    mockFetch(() => jsonResponse(200, authResponse({ mustChangePassword: true })));
    const w = await open();
    await fill(w, 'sara@alpha.test', 'Temp-Pass-1');
    await submit(w);
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.name).toBe('change-password'));
  });

  it('يحترم redirect الداخلي ويتجاهل الخارجي', async () => {
    mockFetch(() => jsonResponse(200, authResponse()));
    const w = await open('/login?redirect=/change-password');
    await fill(w, 'sara@alpha.test', 'x');
    await submit(w);
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.path).toBe('/change-password'));

    ctx.auth.expire();
    await ctx.router.push('/login?redirect=//evil.com');
    const w2 = await mountView(LoginView, { router: ctx.router });
    await fill(w2, 'sara@alpha.test', 'x');
    await submit(w2);
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.name).toBe('dashboard'));
  });

  it('بيانات خاطئة: ماذا/لماذا/كيف بالعربية، تُمسح كلمة المرور، ولا زر إعادة محاولة', async () => {
    mockFetch(() => jsonResponse(401, { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'بيانات الدخول غير صحيحة.', hint: 'تأكد من البريد وكلمة المرور.' }));
    const w = await open();
    await fill(w, 'sara@alpha.test', 'bad-pass');
    await submit(w);
    expect(w.text()).toContain('بيانات الدخول غير صحيحة');
    expect(w.text()).toContain('السبب المحتمل');
    expect(w.text()).toContain('كيف تعالجه');
    expect((w.find('input[autocomplete="current-password"]').element as HTMLInputElement).value).toBe('');
    expect(w.text()).not.toContain('إعادة المحاولة');
    expect(ctx.auth.isAuthenticated).toBe(false);
  });

  it('حجب المحاولات 429: عدّاد تنازلي يعطّل الزر ثم يعيد تفعيله', async () => {
    vi.useFakeTimers();
    mockFetch(() => jsonResponse(429, { statusCode: 429, code: 'TOO_MANY_ATTEMPTS', message: 'محاولات كثيرة.', details: { retryAfterSeconds: 3 } }, { 'Retry-After': '3' }));
    const w = await open();
    await fill(w, 'sara@alpha.test', 'x');
    await submit(w);
    expect(w.text()).toContain('00:03');
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    await vi.advanceTimersByTimeAsync(3100);
    await flushPromises();
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(w.text()).not.toContain('00:0');
  });

  it('انقطاع الشبكة: رسالة عربية وزر إعادة المحاولة الذي يعيد الإرسال', async () => {
    let n = 0;
    const f = mockFetch(() => {
      n += 1;
      if (n === 1) throw new TypeError('Failed to fetch');
      return jsonResponse(200, authResponse());
    });
    const w = await open();
    await fill(w, 'sara@alpha.test', 'x');
    await submit(w);
    expect(w.text()).toContain('تعذّر الاتصال بالخادم');
    const retry = w.findAll('button').find((b) => b.text().includes('إعادة المحاولة'));
    expect(retry).toBeDefined();
    // كلمة المرور مُسحت بعد الفشل: نعيد إدخالها ثم نعيد المحاولة
    await w.find('input[autocomplete="current-password"]').setValue('x');
    await retry!.trigger('click');
    await flushPromises();
    expect(f).toHaveBeenCalledTimes(2);
    expect(ctx.auth.isAuthenticated).toBe(true);
  });

  it('النقر المزدوج لا يرسل طلبين', async () => {
    let release!: (r: Response) => void;
    const f = mockFetch(() => new Promise<Response>((r) => (release = r)));
    const w = await open();
    await fill(w, 'sara@alpha.test', 'x');
    await w.find('form').trigger('submit');
    await w.find('form').trigger('submit');
    expect(f).toHaveBeenCalledTimes(1);
    release(jsonResponse(200, authResponse()));
    await flushPromises();
  });

  it('?reason=expired يعرض تنبيه انتهاء الجلسة', async () => {
    mockFetch(() => jsonResponse(200, {}));
    const w = await open('/login?reason=expired');
    expect(w.text()).toContain('انتهت جلستك');
  });

  it('حقل البريد LTR وكلمة المرور مخفية مع زر إظهار بتسمية وصول', async () => {
    mockFetch(() => jsonResponse(200, {}));
    const w = await open();
    expect(w.find('input[type="email"]').classes()).toContain('is-ltr');
    const pw = w.find('input[autocomplete="current-password"]');
    expect(pw.attributes('type')).toBe('password');
    await w.find('button[aria-label="إظهار كلمة المرور"]').trigger('click');
    expect(pw.attributes('type')).toBe('text');
  });
});

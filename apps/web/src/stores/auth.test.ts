import { beforeEach, describe, expect, it } from 'vitest';
import { getAccessToken, getRefreshToken, setTokens } from '@/api/session';
import { authResponse, freshApp, jsonResponse, mockFetch } from '@/test/utils';

let ctx: ReturnType<typeof freshApp>;
beforeEach(() => {
  ctx = freshApp();
});

describe('auth store', () => {
  it('restore بلا رمز تحديث → زائر دون أي طلب شبكة', async () => {
    const f = mockFetch(() => jsonResponse(500, {}));
    await ctx.auth.restore();
    expect(ctx.auth.status).toBe('anonymous');
    expect(f).not.toHaveBeenCalled();
  });

  it('restore برمز تحديث صالح → جلسة، وتُدوَّر الرموز', async () => {
    setTokens({ accessToken: 'old-a', refreshToken: 'old-r' });
    const f = mockFetch(() => jsonResponse(200, authResponse({ accessToken: 'new-a', refreshToken: 'new-r' })));
    await ctx.auth.restore();
    expect(ctx.auth.isAuthenticated).toBe(true);
    expect(getAccessToken()).toBe('new-a');
    expect(getRefreshToken()).toBe('new-r');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ refreshToken: 'old-r' });
  });

  it('استدعاءات restore المتزامنة تشترك في طلب تحديث واحد (الرمز أحادي الاستخدام)', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    const f = mockFetch(() => jsonResponse(200, authResponse()));
    await Promise.all([ctx.auth.restore(), ctx.auth.restore(), ctx.auth.restore()]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('restore بفشل (رمز مبطل) → زائر ومسح الرموز', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'dead' });
    mockFetch(() => jsonResponse(401, { statusCode: 401, code: 'INVALID_REFRESH_TOKEN', message: 'x' }));
    await ctx.auth.restore();
    expect(ctx.auth.status).toBe('anonymous');
    expect(getRefreshToken()).toBeNull();
  });

  it('login يخزّن الرموز ويضبط المستخدم، ولا يحتفظ بكلمة المرور في أي مكان', async () => {
    mockFetch(() => jsonResponse(200, authResponse({ mustChangePassword: true })));
    await ctx.auth.login(' sara@alpha.test ', 'Secret-Pass-1');
    expect(ctx.auth.mustChangePassword).toBe(true);
    expect(getRefreshToken()).toBe('refresh-1');
    expect(JSON.stringify(ctx.auth.$state)).not.toContain('Secret-Pass-1');
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('Secret-Pass-1');
  });

  it('logout يمسح الحالة محليًا حتى لو فشل الخادم، ويُبطل الجلسة عند نجاحه', async () => {
    mockFetch(() => jsonResponse(200, authResponse()));
    await ctx.auth.login('a@b.co', 'x');
    const f = mockFetch(() => {
      throw new TypeError('offline');
    });
    await ctx.auth.logout();
    expect(ctx.auth.status).toBe('anonymous');
    expect(getRefreshToken()).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).toBe('/api/auth/logout');
  });

  it('شركة موقوفة في الاستجابة تضبط companyBlocked', async () => {
    mockFetch(() => jsonResponse(200, authResponse({ company: { id: 'c', name: 'ش', slug: 's', status: 'SUSPENDED', createdAt: '2026-01-01T00:00:00.000Z' } })));
    await ctx.auth.login('a@b.co', 'x');
    expect(ctx.auth.companyBlocked).toBe(true);
  });
});

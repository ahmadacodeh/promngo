import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '@/api/http';
import { setTokens } from '@/api/session';
import { authResponse, flushPromises, freshApp, jsonResponse } from '@/test/utils';
import { installSessionHooks } from './hooks';

let ctx: ReturnType<typeof freshApp>;
beforeEach(() => {
  ctx = freshApp();
});

function clientWith(handler: (url: string) => Response) {
  const client = createHttpClient({ baseUrl: '/api', fetchImpl: (async (u: RequestInfo | URL) => handler(String(u))) as typeof fetch });
  installSessionHooks(client, ctx.router);
  return client;
}

describe('installSessionHooks', () => {
  it('انتهاء الجلسة غير القابل للتعافي → /login?reason=expired مع redirect', async () => {
    ctx.auth.apply(authResponse());
    await ctx.router.push('/change-password');
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    const client = clientWith((u) => (u.endsWith('/auth/refresh') ? jsonResponse(401, { statusCode: 401, code: 'INVALID_REFRESH_TOKEN', message: 'x' }) : jsonResponse(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'x' })));
    await expect(client.get('/users')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.name).toBe('login'));
    expect(ctx.router.currentRoute.value.query).toMatchObject({ reason: 'expired', redirect: '/change-password' });
    expect(ctx.auth.isAuthenticated).toBe(false);
  });

  it('COMPANY_NOT_ACTIVE أثناء الجلسة → /company-suspended', async () => {
    ctx.auth.apply(authResponse());
    await ctx.router.push('/dashboard');
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    const client = clientWith(() => jsonResponse(403, { statusCode: 403, code: 'COMPANY_NOT_ACTIVE', message: 'x' }));
    await expect(client.get('/users')).rejects.toMatchObject({ code: 'COMPANY_NOT_ACTIVE' });
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.name).toBe('company-suspended'));
  });

  it('PASSWORD_MUST_CHANGE → /change-password', async () => {
    ctx.auth.apply(authResponse());
    await ctx.router.push('/dashboard');
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    const client = clientWith(() => jsonResponse(403, { statusCode: 403, code: 'PASSWORD_MUST_CHANGE', message: 'x' }));
    await expect(client.get('/users')).rejects.toBeDefined();
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.name).toBe('change-password'));
  });

  it('خطأ الدخول (زائر) لا يُحدث إعادة توجيه', async () => {
    ctx.auth.expire();
    await ctx.router.push('/login');
    const client = clientWith(() => jsonResponse(403, { statusCode: 403, code: 'COMPANY_NOT_ACTIVE', message: 'x' }));
    await expect(client.post('/auth/login', {}, { auth: false })).rejects.toBeDefined();
    await flushPromises();
    expect(ctx.router.currentRoute.value.name).toBe('login');
  });

  it('401 ثم تجديد صامت ناجح: يُعاد الطلب مرة واحدة ويُحدَّث المستخدم', async () => {
    ctx.auth.apply(authResponse());
    setTokens({ accessToken: 'old', refreshToken: 'r1' });
    let calls = 0;
    const client = clientWith((u) => {
      if (u.endsWith('/auth/refresh')) return jsonResponse(200, authResponse({ accessToken: 'fresh', refreshToken: 'r2' }));
      calls += 1;
      return calls === 1 ? jsonResponse(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'x' }) : jsonResponse(200, { ok: true });
    });
    await expect(client.get('/users')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});

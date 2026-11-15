import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { vi } from 'vitest';
import type { AuthResponse } from '@/api/types';
import { clearTokens } from '@/api/session';
import { featureRoutes } from '@/router';
import { decideNavigation } from '@/router/guards';
import { useAuthStore } from '@/stores/auth';
import type { Component } from 'vue';

export function authResponse(over: Partial<AuthResponse> = {}): AuthResponse {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresIn: 900,
    mustChangePassword: false,
    user: { id: 'u1', fullName: 'سارة', email: 'sara@alpha.test', role: 'EXECUTIVE_MANAGER', canCreateProjects: true, isActive: true, mustChangePassword: false, specialization: null, createdAt: '2026-01-01T00:00:00.000Z' },
    company: { id: 'c1', name: 'شركة ألفا', slug: 'alpha', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z' },
    ...over,
  };
}

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function freshApp(): { router: Router; auth: ReturnType<typeof useAuthStore> } {
  clearTokens();
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', redirect: { name: 'dashboard' } }, ...featureRoutes, { path: '/:pathMatch(.*)*', name: 'not-found', component: { template: '<p>404</p>' } }],
  });
  const auth = useAuthStore();
  router.beforeEach(async (to) => {
    await auth.restore();
    return decideNavigation(to, auth);
  });
  return { router, auth };
}

export async function mountView(component: Component, opts: { router: Router; path?: string }): Promise<VueWrapper> {
  if (opts.path) await opts.router.push(opts.path);
  await opts.router.isReady();
  const w = mount(component, { global: { plugins: [opts.router, [{ install: () => undefined }]] }, attachTo: document.body });
  await flushPromises();
  return w;
}

export { flushPromises };

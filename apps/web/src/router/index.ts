import { createRouter, createWebHistory, type RouteRecordRaw, type Router } from 'vue-router';
import type { Role } from '@/api/types';
import type { IconName } from '@/components/AppIcon.vue';
import { useAuthStore } from '@/stores/auth';
import { decideNavigation } from './guards';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    /** reachable without a session (login only) */
    public?: boolean;
    /** if set, only these roles may open it (UI only; the API enforces it again) */
    roles?: Role[];
    /** 'auth' = centred card layout (default 'app' = sidebar shell) */
    layout?: 'auth' | 'app';
    /** present => shown in the sidebar */
    nav?: { label: string; icon: IconName; order: number };
  }
}

// Each feature owns its routes: src/features/<name>/routes.ts exports `default RouteRecordRaw[]`.
const modules = import.meta.glob<{ default: RouteRecordRaw[] }>('../features/*/routes.ts', { eager: true });
export const featureRoutes: RouteRecordRaw[] = Object.values(modules).flatMap((m) => m.default);

export function createAppRouter(history = createWebHistory()): Router {
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: { name: 'dashboard' } },
      ...featureRoutes,
      { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/features/errors/NotFoundView.vue'), meta: { title: 'الصفحة غير موجودة' } },
    ],
    scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  });

  router.beforeEach(async (to) => {
    const auth = useAuthStore();
    await auth.restore();
    return decideNavigation(to, auth);
  });
  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} — PROMANGO` : 'PROMANGO';
  });
  return router;
}

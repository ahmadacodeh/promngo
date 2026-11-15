import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router';
import type { useAuthStore } from '@/stores/auth';

type AuthStore = ReturnType<typeof useAuthStore>;

/**
 * Pure navigation decision (unit-tested). Returns a redirect or `true` to proceed.
 * Order matters: anonymous → forced password change → suspended company → role check.
 * This only shapes the UI: every API call is authorised again by the server.
 */
export function decideNavigation(to: RouteLocationNormalized, auth: AuthStore): RouteLocationRaw | true {
  const isPublic = to.meta.public === true;

  if (!auth.isAuthenticated) {
    if (isPublic) return true;
    return { name: 'login', query: to.fullPath === '/' || to.fullPath === '/dashboard' ? {} : { redirect: to.fullPath } };
  }

  if (to.name === 'login') return { name: 'dashboard' };
  if (auth.mustChangePassword && to.name !== 'change-password') return { name: 'change-password' };
  if (auth.companyBlocked && to.name !== 'company-suspended') return { name: 'company-suspended' };
  if (!auth.companyBlocked && to.name === 'company-suspended') return { name: 'dashboard' };

  const roles = to.meta.roles;
  if (roles && auth.role && !roles.includes(auth.role)) return { name: 'forbidden' };
  return true;
}

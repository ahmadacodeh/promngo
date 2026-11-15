import type { Router } from 'vue-router';
import type { HttpClient } from '@/api/http';
import { useAuthStore } from '@/stores/auth';

/**
 * Global reactions to server verdicts, wired once at start-up:
 *  - session cannot be recovered      → back to /login (remember where the user was)
 *  - COMPANY_NOT_ACTIVE while signed in → /company-suspended
 *  - PASSWORD_MUST_CHANGE              → /change-password
 */
export function installSessionHooks(client: HttpClient, router: Router): void {
  client.configure({
    onTokensRefreshed: (res) => useAuthStore().apply(res),
    onSessionExpired: () => {
      const auth = useAuthStore();
      const wasIn = auth.isAuthenticated;
      auth.expire();
      if (wasIn) {
        const here = router.currentRoute.value.fullPath;
        void router.replace({ name: 'login', query: { reason: 'expired', ...(here && here !== '/' ? { redirect: here } : {}) } });
      }
    },
    onApiError: (err) => {
      const auth = useAuthStore();
      if (!auth.isAuthenticated) return;
      if (err.code === 'COMPANY_NOT_ACTIVE') {
        auth.companyBlocked = true;
        void router.replace({ name: 'company-suspended' });
      } else if (err.code === 'PASSWORD_MUST_CHANGE') {
        auth.mustChangePassword = true;
        void router.replace({ name: 'change-password' });
      }
    },
  });
}

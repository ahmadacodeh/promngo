import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { authApi } from '@/api/endpoints/auth';
import { clearTokens, getRefreshToken, setTokens } from '@/api/session';
import type { AuthResponse, CompanyDto, Role, UserDto } from '@/api/types';

type Status = 'unknown' | 'anonymous' | 'authenticated';

/**
 * Session state. The server is the only authority (roles/permissions are re-checked on every request);
 * this store only drives navigation and display. Tokens live in src/api/session.ts, never here.
 */
export const useAuthStore = defineStore('auth', () => {
  const status = ref<Status>('unknown');
  const user = ref<UserDto | null>(null);
  const company = ref<CompanyDto | null>(null);
  const mustChangePassword = ref(false);
  /** set when the company turned suspended/archived mid-session (COMPANY_NOT_ACTIVE from any endpoint) */
  const companyBlocked = ref(false);
  let restoring: Promise<void> | null = null;

  const isAuthenticated = computed(() => status.value === 'authenticated');
  const role = computed<Role | null>(() => user.value?.role ?? null);
  const isManager = computed(() => role.value === 'EXECUTIVE_MANAGER' || role.value === 'PROJECT_MANAGER');
  const isExecutive = computed(() => role.value === 'EXECUTIVE_MANAGER');

  function apply(res: Pick<AuthResponse, 'user' | 'company' | 'mustChangePassword'>): void {
    user.value = res.user;
    company.value = res.company;
    mustChangePassword.value = res.mustChangePassword;
    companyBlocked.value = res.company.status !== 'ACTIVE';
    status.value = 'authenticated';
  }

  function reset(): void {
    user.value = null;
    company.value = null;
    mustChangePassword.value = false;
    companyBlocked.value = false;
    status.value = 'anonymous';
  }

  /** Runs once per page load: turns a stored refresh token into a live session (or anonymous). Concurrent calls share one promise. */
  function restore(): Promise<void> {
    if (status.value !== 'unknown') return Promise.resolve();
    restoring ??= (async () => {
      const rt = getRefreshToken();
      if (!rt) {
        reset();
        return;
      }
      try {
        const res = await authApi.refresh(rt);
        setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        apply(res);
      } catch {
        clearTokens();
        reset();
      }
    })();
    return restoring;
  }

  async function login(email: string, password: string): Promise<void> {
    const res = await authApi.login(email.trim(), password);
    setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    apply(res);
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await authApi.changePassword(currentPassword, newPassword);
    setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    apply(res);
  }

  /** Best-effort server logout (revokes the refresh session), then always clears local state. */
  async function logout(): Promise<void> {
    const rt = getRefreshToken();
    clearTokens();
    reset();
    if (rt) {
      try {
        await authApi.logout(rt);
      } catch {
        /* offline: the local session is already gone; the server session expires by itself */
      }
    }
  }

  /** Called by the http client when the session cannot be recovered. */
  function expire(): void {
    clearTokens();
    reset();
  }

  /** Test helper / hot reload. */
  function $reset(): void {
    restoring = null;
    status.value = 'unknown';
    user.value = null;
    company.value = null;
    mustChangePassword.value = false;
    companyBlocked.value = false;
  }

  return { status, user, company, mustChangePassword, companyBlocked, isAuthenticated, role, isManager, isExecutive, apply, restore, login, changePassword, logout, expire, $reset };
});

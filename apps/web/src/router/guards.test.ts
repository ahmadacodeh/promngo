import { createPinia, setActivePinia } from 'pinia';
import type { RouteLocationNormalized } from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CompanyDto, UserDto } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { decideNavigation } from './guards';
import { safeRedirect } from './redirect';

const route = (name: string, meta: Record<string, unknown> = {}, fullPath = `/${name}`) => ({ name, meta, fullPath }) as unknown as RouteLocationNormalized;
const user = (role: UserDto['role']): UserDto => ({ id: 'u', fullName: 'س', email: 's@x.co', role, canCreateProjects: false, isActive: true, mustChangePassword: false, specialization: null, createdAt: '2026-01-01T00:00:00.000Z' });
const company = (status: CompanyDto['status'] = 'ACTIVE'): CompanyDto => ({ id: 'c', name: 'ش', slug: 's', status, createdAt: '2026-01-01T00:00:00.000Z' });

beforeEach(() => setActivePinia(createPinia()));

function signIn(role: UserDto['role'], opts: { must?: boolean; status?: CompanyDto['status'] } = {}) {
  const a = useAuthStore();
  a.apply({ user: user(role), company: company(opts.status), mustChangePassword: opts.must ?? false });
  return a;
}

describe('decideNavigation', () => {
  it('زائر على صفحة محمية → /login مع redirect', () => {
    const a = useAuthStore();
    a.expire();
    expect(decideNavigation(route('projects', {}, '/projects?x=1'), a)).toEqual({ name: 'login', query: { redirect: '/projects?x=1' } });
  });
  it('زائر على /login عام يمر', () => {
    const a = useAuthStore();
    a.expire();
    expect(decideNavigation(route('login', { public: true }), a)).toBe(true);
  });
  it('مستخدم مسجّل على /login → لوحة التحكم', () => {
    expect(decideNavigation(route('login', { public: true }), signIn('EMPLOYEE'))).toEqual({ name: 'dashboard' });
  });
  it('تغيير كلمة مرور إلزامي يحجب كل شيء عدا change-password', () => {
    const a = signIn('EMPLOYEE', { must: true });
    expect(decideNavigation(route('dashboard'), a)).toEqual({ name: 'change-password' });
    expect(decideNavigation(route('change-password'), a)).toBe(true);
  });
  it('شركة موقوفة تحجب كل شيء عدا company-suspended، والعكس يُعاد للوحة', () => {
    const a = signIn('EXECUTIVE_MANAGER', { status: 'SUSPENDED' });
    expect(decideNavigation(route('dashboard'), a)).toEqual({ name: 'company-suspended' });
    expect(decideNavigation(route('company-suspended'), a)).toBe(true);
    expect(decideNavigation(route('company-suspended'), signIn('EMPLOYEE'))).toEqual({ name: 'dashboard' });
  });
  it('الدور غير المسموح → forbidden، والمسموح يمر', () => {
    const meta = { roles: ['EXECUTIVE_MANAGER'] };
    expect(decideNavigation(route('users', meta), signIn('EMPLOYEE'))).toEqual({ name: 'forbidden' });
    expect(decideNavigation(route('users', meta), signIn('EXECUTIVE_MANAGER'))).toBe(true);
  });
});

describe('safeRedirect (يمنع إعادة التوجيه المفتوحة)', () => {
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/login', '/login?x=1', '', undefined, 42, '/a\nb'])('يرفض %s', (v) => {
    expect(safeRedirect(v)).toBe('/dashboard');
  });
  it('يقبل مسارًا داخليًا ومعاملاته', () => expect(safeRedirect('/projects/12?tab=tasks')).toBe('/projects/12?tab=tasks'));
});

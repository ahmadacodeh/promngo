import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserDto } from '@/api/types';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch } from '@/test/utils';
import { mkDetail, mkProject } from '@/test/fixtures';
import TaskFormModal from './TaskFormModal.vue';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const u = (id: string, fullName: string, role: UserDto['role'], spec: { id: string; name: string } | null = null): UserDto => ({
  id, fullName, email: `${id}@alpha.test`, role, canCreateProjects: false, isActive: true, mustChangePassword: false, specialization: spec, createdAt: '2026-01-01T00:00:00Z',
});
const FE = { id: 'sp-fe', name: 'Frontend' };
const BE = { id: 'sp-be', name: 'Backend' };
const USERS = [u('m1', 'خالد', 'SPECIALIZED_MANAGER', FE), u('m2', 'عمر', 'SPECIALIZED_MANAGER', BE), u('e1', 'مريم', 'EMPLOYEE', FE), u('e2', 'سامي', 'EMPLOYEE', BE)];

interface Call { method: string; path: string; body: unknown }
function setup(onWrite?: (path: string, body: unknown) => Response) {
  const calls: Call[] = [];
  mockFetch((url, init) => {
    const p = new URL(url, 'http://x').pathname;
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: p, body });
    if (method !== 'GET') return onWrite?.(p, body) ?? jsonResponse(201, mkDetail({ id: 'new', title: 'جديدة' }));
    if (p.endsWith('/users')) return jsonResponse(200, { items: USERS, total: USERS.length, page: 1, pageSize: 200 });
    if (p.endsWith('/specializations')) return jsonResponse(200, { items: [{ ...FE, description: null }, { ...BE, description: null }], total: 2, page: 1, pageSize: 200 });
    if (p.endsWith('/projects')) return jsonResponse(200, { items: [mkProject({ id: 'p1', name: 'مفتوح' }), mkProject({ id: 'p2', name: 'مغلق', status: 'COMPLETED' })], total: 2, page: 1, pageSize: 200 });
    return jsonResponse(404, {});
  });
  return calls;
}
async function open(props: Record<string, unknown>) {
  const ctx = freshApp();
  ctx.auth.apply(authResponse());
  const w = mount(TaskFormModal, { props: { open: true, ...props }, global: { plugins: [ctx.router] }, attachTo: document.body });
  await flushPromises();
  return w;
}
const field = (label: string) => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent?.replace('*', '').trim() === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
};
async function set(label: string, value: string) {
  const el = field(label);
  el.value = value;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
  await flushPromises();
}
const submit = async () => {
  (document.querySelector('button[type="submit"]') as HTMLButtonElement).click();
  await flushPromises();
};
const optionValues = (label: string) => [...(field(label) as HTMLSelectElement).options].map((o) => o.value);

describe('TaskFormModal', () => {
  it('إنشاء مهمة رئيسية في مشروع محدد: تحقق عربي ثم POST بالحقول المعبأة فقط', async () => {
    const calls = setup();
    const w = await open({ projectId: 'p1' });
    await submit();
    expect(document.body.textContent).toContain('عنوان المهمة مطلوب.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await set('عنوان المهمة', '  تطوير الدخول ');
    await set('الأولوية', 'URGENT');
    await set('تاريخ الاستحقاق', '2026-12-10');
    await set('الموظف المكلّف', 'e1');
    await set('المراجع', 'm2');
    await submit();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/api/projects/p1/tasks');
    expect(post.body).toEqual({ title: 'تطوير الدخول', priority: 'URGENT', dueDate: '2026-12-10', assignedToId: 'e1', reviewerId: 'm2' });
    expect(w.emitted('saved')).toHaveLength(1);
  });

  it('بلا مشروع ثابت: يُطلب اختيار مشروع وتظهر المفتوحة فقط', async () => {
    setup();
    await open({});
    expect(optionValues('المشروع')).toEqual(['', 'p1']);
    await set('عنوان المهمة', 'م');
    await submit();
    expect(document.body.textContent).toContain('اختر المشروع الذي تتبع له المهمة.');
  });

  it('القوائم تساعد ولا تقرر: المدير المختص والمراجع بدور «مدير مختص»، والمراجع ليس المكلّف، والمكلّف يطابق التخصص', async () => {
    setup();
    await open({ projectId: 'p1' });
    expect(optionValues('المدير المختص')).toEqual(['', 'm1', 'm2']);
    await set('الموظف المكلّف', 'm1');
    expect(optionValues('المراجع')).toEqual(['', 'm2']);
    await set('الموظف المكلّف', '');
    await set('التخصص', BE.id);
    expect(optionValues('الموظف المكلّف')).toEqual(['', 'm2', 'e2']);
  });

  it('فرعية: الإلزامية تُرسل، والمسار هو subtasks للمهمة الأم', async () => {
    const calls = setup();
    await open({ projectId: 'p1', parent: { id: 'm9', title: 'الأم' } });
    expect(document.body.textContent).toContain('ضمن المهمة الرئيسية: الأم');
    await set('عنوان المهمة', 'فرعية');
    (field('مهمة إلزامية') as HTMLInputElement).click();
    await flushPromises();
    await submit();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/api/projects/p1/tasks/m9/subtasks');
    expect(post.body).toMatchObject({ title: 'فرعية', isRequired: false });
  });

  it('التعديل يرسل المتغير فقط (والمسح null)، وبلا تغيير لا طلب', async () => {
    const task = mkDetail({ id: 't1', title: 'قديم', priority: 'LOW', dueDate: '2026-12-01', reviewer: { id: 'm2', fullName: 'عمر', role: 'SPECIALIZED_MANAGER' } });
    const calls = setup((_p) => jsonResponse(200, task));
    const w = await open({ projectId: 'p1', task });
    await submit();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(w.emitted('close')).toHaveLength(1);
    await set('عنوان المهمة', 'جديد');
    await set('تاريخ الاستحقاق', '');
    await set('المراجع', '');
    await submit();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/api/tasks/t1', body: { title: 'جديد', dueDate: null, reviewerId: null } });
  });

  it('peopleOnly (المدير المختص المعيّن): المكلّف والمراجع فقط', async () => {
    const task = mkDetail({ id: 't1', title: 'م', assignedTo: null });
    const calls = setup(() => jsonResponse(200, task));
    await open({ projectId: 'p1', task, peopleOnly: true });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('إسناد المهمة');
    expect([...document.querySelectorAll('label')].map((l) => l.textContent?.replace('*', '').trim())).toEqual(['الموظف المكلّف', 'المراجع']);
    await set('الموظف المكلّف', 'e1');
    await set('المراجع', 'm1');
    await submit();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ assignedToId: 'e1', reviewerId: 'm1' });
    expect(calls.some((c) => c.path.endsWith('/specializations'))).toBe(false);
  });

  it('أخطاء الخادم تُربط بالحقول (REVIEWER_NOT_ELIGIBLE) وتبقى كتلة ماذا/لماذا/كيف', async () => {
    setup(() => jsonResponse(409, { statusCode: 409, code: 'REVIEWER_NOT_ELIGIBLE', message: 'المراجع غير مؤهل.', hint: 'اختر مديرًا مختصًا آخر.', fields: { reviewerId: 'المراجع يجب أن يكون مديرًا مختصًا نشطًا وغير المكلّف.' } }));
    await open({ projectId: 'p1' });
    await set('عنوان المهمة', 'م');
    await set('المراجع', 'm1');
    await submit();
    expect(document.body.textContent).toContain('المراجع يجب أن يكون مديرًا مختصًا نشطًا وغير المكلّف.');
    expect(document.body.textContent).toContain('اختر مديرًا مختصًا آخر.');
  });
});

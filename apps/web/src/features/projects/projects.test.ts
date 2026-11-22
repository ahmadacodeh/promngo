import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDto, Role } from '@/api/types';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch, mountView } from '@/test/utils';
import { mkProject, mkTask } from '@/test/fixtures';
import ProjectsView from './ProjectsView.vue';
import ProjectDetailView from './ProjectDetailView.vue';

interface Call { method: string; path: string; query: URLSearchParams; body: unknown }
afterEach(() => vi.unstubAllGlobals());
const dlg = () => document.querySelector('[role="dialog"]:last-of-type') as HTMLElement;
const btnIn = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text)) as HTMLButtonElement | undefined;

function server(handler: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  mockFetch((url, init) => {
    const u = new URL(url, 'http://x');
    const c = { method: init.method ?? 'GET', path: u.pathname.replace(/^\/api/, ''), query: u.searchParams, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return handler(c) ?? jsonResponse(404, { code: 'NOT_FOUND', message: 'غير موجود' });
  });
  return calls;
}
async function as(role: Role, canCreate = true) {
  const ctx = freshApp();
  ctx.auth.apply(authResponse({ user: { ...authResponse().user, role, canCreateProjects: canCreate } }));
  return ctx;
}
async function set(el: Element, v: string) {
  (el as HTMLInputElement).value = v;
  el.dispatchEvent(new Event('input'));
  await flushPromises();
}
const page = (items: unknown[], total = items.length) => jsonResponse(200, { items, total, page: 1, pageSize: 20 });

describe('ProjectsView', () => {
  const P = [mkProject({ id: 'p1', name: 'بوابة العملاء', progressPct: 33, overdueCount: 2, taskCounts: { total: 9 }, dueDate: '2026-12-30' })];

  it('يعرض المشاريع بالتقدم والتأخر والتاريخ، ويرسل التصفية والترتيب للخادم ويعيد الصفحة 1', async () => {
    const calls = server((c) => (c.path === '/projects' ? page(P) : undefined));
    const ctx = await as('PROJECT_MANAGER');
    const w = await mountView(ProjectsView, { router: ctx.router, path: '/projects' });
    const row = w.find('tbody tr');
    expect(row.text()).toContain('بوابة العملاء');
    expect(row.text()).toContain('2 متأخرة');
    expect(row.text()).toContain('30 ديسمبر 2026');
    expect(row.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('33');
    expect(row.find('a').attributes('href')).toBe('/projects/p1');
    await w.findAll('select')[0]!.setValue('ON_HOLD');
    await w.findAll('select')[1]!.setValue('dueDate');
    await flushPromises();
    const last = calls.filter((c) => c.path === '/projects').at(-1)!;
    expect(Object.fromEntries(last.query)).toMatchObject({ status: 'ON_HOLD', sort: 'dueDate', order: 'asc', page: '1' });
  });

  it.each([
    ['EXECUTIVE_MANAGER', true, true],
    ['PROJECT_MANAGER', false, false],
    ['SPECIALIZED_MANAGER', true, false],
    ['EMPLOYEE', true, false],
  ] as const)('%s (canCreate=%s): زر «مشروع جديد» ظاهر=%s', async (role, canCreate, shown) => {
    server((c) => (c.path === '/projects' ? page(P) : undefined));
    const ctx = await as(role, canCreate);
    const w = await mountView(ProjectsView, { router: ctx.router, path: '/projects' });
    expect(!!btnIn(w.element, 'مشروع جديد')).toBe(shown);
  });

  it('الإنشاء: تحقق التواريخ محليًا، ثم POST بالحقول المعبأة فقط والانتقال إلى التفاصيل', async () => {
    const created = mkProject({ id: 'p9', name: 'مشروع جديد تمامًا' });
    const calls = server((c) => (c.path === '/projects' && c.method === 'POST' ? jsonResponse(201, created) : c.path === '/projects' ? page(P) : c.path === '/projects/p9' ? jsonResponse(200, created) : c.path === '/projects/p9/tasks' ? page([]) : undefined));
    const ctx = await as('EXECUTIVE_MANAGER');
    const w = await mountView(ProjectsView, { router: ctx.router, path: '/projects?new=1' });
    await flushPromises();
    const inputs = dlg().querySelectorAll('input');
    await set(inputs[0]!, '  مشروع جديد تمامًا ');
    await set(inputs[1]!, '2026-12-10');
    await set(inputs[2]!, '2026-12-01');
    btnIn(dlg(), 'إنشاء المشروع')!.click();
    await flushPromises();
    expect(dlg().textContent).toContain('تاريخ التسليم يجب ألا يسبق تاريخ البداية');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await set(inputs[2]!, '2026-12-20');
    btnIn(dlg(), 'إنشاء المشروع')!.click();
    await flushPromises();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'مشروع جديد تمامًا', startDate: '2026-12-10', dueDate: '2026-12-20' });
    await vi.waitFor(() => expect(ctx.router.currentRoute.value.fullPath).toBe('/projects/p9'));
    w.unmount();
  });
});

describe('ProjectDetailView', () => {
  const base: ProjectDto = mkProject({ id: 'p1', name: 'بوابة العملاء', description: 'وصف', progressPct: 17, taskCounts: { total: 9, COMPLETED: 2 }, overdueCount: 2, allowedNextStatuses: ['ON_HOLD', 'COMPLETED', 'CANCELLED'] });
  const tasks = [mkTask({ id: 't1', title: 'مهمة عاجلة', priority: 'URGENT' }), mkTask({ id: 't2', title: 'متأخرة', isOverdue: true, status: 'PLANNED' })];

  it('الملخص والمهام مرتبة بالأولوية من الخادم؛ وتصفية الأولوية تُرسل', async () => {
    const calls = server((c) => (c.path === '/projects/p1' ? jsonResponse(200, base) : c.path === '/projects/p1/tasks' ? page(tasks) : undefined));
    const ctx = await as('PROJECT_MANAGER');
    const w = await mountView(ProjectDetailView, { router: ctx.router, path: '/projects/p1' });
    expect(w.text()).toContain('9 مهمة • 2 مكتملة');
    expect(w.text()).toContain('2 مهمة متأخرة');
    const tq = calls.find((c) => c.path === '/projects/p1/tasks')!.query;
    expect(Object.fromEntries(tq)).toMatchObject({ parentOnly: 'true', sort: 'priority', order: 'desc' });
    expect(w.findAll('tbody tr')[0]!.text()).toContain('عاجلة');
    expect(w.findAll('tbody tr')[1]!.text()).toContain('متأخرة');
    await w.find('select').setValue('HIGH');
    await flushPromises();
    expect(calls.filter((c) => c.path === '/projects/p1/tasks').at(-1)!.query.get('priority')).toBe('HIGH');
  });

  it('أزرار الانتقال من allowedNextStatuses فقط وللمدراء فقط؛ والموظف لا يرى أي إجراء', async () => {
    server((c) => (c.path === '/projects/p1' ? jsonResponse(200, base) : c.path === '/projects/p1/tasks' ? page(tasks) : undefined));
    const pm = await mountView(ProjectDetailView, { router: (await as('PROJECT_MANAGER')).router, path: '/projects/p1' });
    expect(['تعديل البيانات', 'تعليق المشروع', 'إكمال المشروع', 'إلغاء المشروع'].every((t) => btnIn(pm.element, t))).toBe(true);
    expect(btnIn(pm.element, 'تفعيل المشروع')).toBeUndefined();
    pm.unmount();
    const emp = await mountView(ProjectDetailView, { router: (await as('EMPLOYEE')).router, path: '/projects/p1' });
    expect(emp.findAll('.overview__acts')).toHaveLength(0);
  });

  it('الإكمال مع مهام مفتوحة: يبقى الحوار مفتوحًا بشرح الخطأ، ثم ينجح التعليق ويحدّث الحالة', async () => {
    let fail = true;
    const calls = server((c) => {
      if (c.path === '/projects/p1' && c.method === 'PATCH') {
        if (fail) return jsonResponse(409, { code: 'PROJECT_HAS_OPEN_TASKS', message: 'مهام مفتوحة' });
        return jsonResponse(200, { ...base, status: 'ON_HOLD', allowedNextStatuses: ['ACTIVE', 'CANCELLED'] });
      }
      if (c.path === '/projects/p1') return jsonResponse(200, base);
      if (c.path === '/projects/p1/tasks') return page(tasks);
      return undefined;
    });
    const w = await mountView(ProjectDetailView, { router: (await as('EXECUTIVE_MANAGER')).router, path: '/projects/p1' });
    await w.findAll('button').find((b) => b.text() === 'إكمال المشروع')!.trigger('click');
    await flushPromises();
    expect(dlg().textContent).toContain('حالة نهائية');
    btnIn(dlg(), 'إكمال المشروع')!.click();
    await flushPromises();
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)!.body).toEqual({ status: 'COMPLETED' });
    expect(dlg().textContent).toContain('كيف تعالجه');
    btnIn(dlg(), 'إلغاء')!.click();
    await flushPromises();
    fail = false;
    await w.findAll('button').find((b) => b.text() === 'تعليق المشروع')!.trigger('click');
    await flushPromises();
    btnIn(dlg(), 'تعليق المشروع')!.click();
    await flushPromises();
    await vi.waitFor(() => expect(w.find('.overview__head').text()).toContain('معلّق'));
    expect(btnIn(w.element, 'استئناف') ?? btnIn(w.element, 'تفعيل المشروع')).toBeTruthy();
    w.unmount();
  });

  it('مشروع غير موجود/خارج الصلاحية: رسالة واضحة لا خطأ عام', async () => {
    server(() => jsonResponse(404, { code: 'NOT_FOUND', message: 'غير موجود' }));
    const w = await mountView(ProjectDetailView, { router: (await as('EMPLOYEE')).router, path: '/projects/zz' });
    expect(w.text()).toContain('المشروع غير موجود');
  });
});

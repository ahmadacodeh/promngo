import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/api/types';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch, mountView } from '@/test/utils';
import { mkProject, mkTask } from '@/test/fixtures';
import TasksView from './TasksView.vue';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const calls: URL[] = [];
  mockFetch((url) => {
    const u = new URL(url, 'http://x');
    calls.push(u);
    if (u.pathname.endsWith('/projects')) return jsonResponse(200, { items: [mkProject({ id: 'p1', name: 'بوابة العملاء' })], total: 1, page: 1, pageSize: 100 });
    if (u.pathname.endsWith('/tasks')) {
      return jsonResponse(200, {
        items: [mkTask({ id: 't1', title: 'عاجلة متأخرة', priority: 'URGENT', isOverdue: true, dueDate: '2026-11-18', needsReview: true }), mkTask({ id: 't2', title: 'فرعية', priority: 'LOW', parentTaskId: 't1', assignedTo: null })],
        total: 2, page: 1, pageSize: 20,
      });
    }
    return jsonResponse(404, {});
  });
  const taskCalls = () => calls.filter((u) => u.pathname.endsWith('/tasks'));
  return { taskCalls };
}
async function mountAs(role: Role, path = '/tasks') {
  const ctx = freshApp();
  ctx.auth.apply(authResponse({ user: { ...authResponse().user, role } }));
  const w = await mountView(TasksView, { router: ctx.router, path });
  return { w, ctx };
}

describe('TasksView', () => {
  it('الافتراضي: ترتيب بالأولوية تنازليًا (قرار T4)، وعرض الأولوية والتأخر وعلامة إعادة النظر نصًّا', async () => {
    const { taskCalls } = setup();
    const { w } = await mountAs('SPECIALIZED_MANAGER');
    expect(Object.fromEntries(taskCalls()[0]!.searchParams)).toMatchObject({ scope: 'all', sort: 'priority', order: 'desc', page: '1', pageSize: '20' });
    const [r1, r2] = w.findAll('tbody tr');
    expect(r1!.text()).toContain('عاجلة');
    expect(r1!.text()).toContain('متأخرة');
    expect(r1!.text()).toContain('تحتاج إعادة نظر');
    expect(r2!.text()).toContain('مهمة فرعية');
    expect(r2!.text()).toContain('غير مسندة');
  });

  it('التصفية والنطاق تُرسل للخادم وتُحفظ في الرابط، والمسح يعيدها', async () => {
    const { taskCalls } = setup();
    const { w, ctx } = await mountAs('SPECIALIZED_MANAGER');
    const selects = w.findAll('select');
    await selects[0]!.setValue('p1');
    await selects[2]!.setValue('URGENT');
    await w.find('input[type="checkbox"]').setValue(true);
    await w.findAll('button').find((b) => b.text() === 'للمراجعة')!.trigger('click');
    await flushPromises();
    expect(Object.fromEntries(taskCalls().at(-1)!.searchParams)).toMatchObject({ scope: 'review', projectId: 'p1', priority: 'URGENT', overdue: 'true' });
    expect(ctx.router.currentRoute.value.query).toMatchObject({ scope: 'review', project: 'p1', priority: 'URGENT', overdue: '1' });
    await w.findAll('button').find((b) => b.text() === 'مسح التصفية')!.trigger('click');
    await flushPromises();
    const q = Object.fromEntries(taskCalls().at(-1)!.searchParams);
    expect(q.priority).toBeUndefined();
    expect(q.overdue).toBeUndefined();
  });

  it('يقرأ التصفية الأولية من الرابط ويتجاهل القيم غير الصالحة', async () => {
    const { taskCalls } = setup();
    await mountAs('EMPLOYEE', '/tasks?scope=mine&priority=HIGH&status=NOPE&overdue=1&sort=dueDate');
    expect(Object.fromEntries(taskCalls()[0]!.searchParams)).toMatchObject({ scope: 'mine', priority: 'HIGH', overdue: 'true', sort: 'dueDate', order: 'asc' });
    expect(taskCalls()[0]!.searchParams.get('status')).toBeNull();
  });

  it('الموظف لا يرى نطاق «للمراجعة»', async () => {
    setup();
    const { w } = await mountAs('EMPLOYEE');
    expect(w.findAll('.tab').map((b) => b.text())).toEqual(['كل المهام', 'مهامي']);
    expect(w.find('.tab').attributes('aria-pressed')).toBe('true');
  });
});

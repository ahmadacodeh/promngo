import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail, TaskEventDto } from '@/api/types';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch, mountView } from '@/test/utils';
import { mkDetail, mkTask } from '@/test/fixtures';
import TaskDetailView from './TaskDetailView.vue';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

interface Call { method: string; path: string; body: unknown }
function setup(detail: TaskDetail, opts: { events?: TaskEventDto[]; onPost?: (path: string, body: unknown) => Response | undefined } = {}) {
  const calls: Call[] = [];
  let current = detail;
  mockFetch((url, init) => {
    const u = new URL(url, 'http://x');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, body });
    if (method !== 'GET') {
      const r = opts.onPost?.(u.pathname, body);
      if (r) return r;
      return jsonResponse(204, undefined);
    }
    if (u.pathname.endsWith(`/tasks/${detail.id}/events`)) return jsonResponse(200, opts.events ?? []);
    if (u.pathname.endsWith(`/tasks/${detail.id}`)) return jsonResponse(200, current);
    if (u.pathname.endsWith('/tasks')) return jsonResponse(200, { items: [mkTask({ id: 'other', title: 'تصميم الواجهات', status: 'COMPLETED' })], total: 1, page: 1, pageSize: 200 });
    return jsonResponse(404, { statusCode: 404, code: 'NOT_FOUND', message: 'غير موجود' });
  });
  return { calls, set: (d: TaskDetail) => (current = d) };
}
async function mount(id = 't1') {
  const ctx = freshApp();
  ctx.auth.apply(authResponse());
  const w = await mountView(TaskDetailView, { router: ctx.router, path: `/tasks/${id}` });
  return { w, ctx };
}
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const dialog = () => document.querySelector('[role="dialog"]');

describe('TaskDetailView', () => {
  it('يعرض بيانات المهمة كما في Figma (المسؤول، المدير المختص، المراجع، التسليم) والحالة والأولوية نصًّا', async () => {
    setup(mkDetail({
      id: 't1', title: 'تطوير واجهة الدخول', description: 'واجهة آمنة', status: 'IN_PROGRESS', priority: 'HIGH', dueDate: '2026-11-18', isOverdue: true,
      assignedManager: { id: 'm1', fullName: 'خالد يوسف', role: 'SPECIALIZED_MANAGER' }, reviewer: { id: 'r1', fullName: 'أحمد خالد', role: 'SPECIALIZED_MANAGER' },
    }));
    const { w } = await mount();
    const t = w.text();
    expect(t).toContain('تطوير واجهة الدخول');
    expect(t).toContain('واجهة آمنة');
    expect(t).toContain('قيد التنفيذ');
    expect(t).toContain('أولوية عالية');
    expect(t).toContain('متأخرة');
    expect(t).toContain('ليلى');
    expect(t).toContain('خالد يوسف');
    expect(t).toContain('أحمد خالد');
    expect(t).toContain('18 نوفمبر 2026');
  });

  it('بلا صلاحيات: لا زر إجراء واحد (الأزرار من can/allowedNext فقط)', async () => {
    setup(mkDetail({ id: 't1', title: 'م', allowedNext: [] }));
    const { w } = await mount();
    expect(w.find('.summary__acts').findAll('button')).toHaveLength(0);
    expect(w.text()).not.toContain('إضافة اعتمادية');
    expect(w.text()).not.toContain('مهمة فرعية جديدة');
  });

  it('الانتقال: زر لكل allowedNext، وتأكيد يرسل to إلى الخادم ويحدّث الحالة والسجل', async () => {
    const after = mkDetail({ id: 't1', title: 'م', status: 'IN_PROGRESS' });
    const { calls } = setup(mkDetail({ id: 't1', title: 'م', status: 'ASSIGNED', allowedNext: ['IN_PROGRESS'], can: { start: true } }), {
      onPost: (p) => (p.endsWith('/transitions') ? jsonResponse(200, after) : undefined),
    });
    const { w } = await mount();
    button('بدء التنفيذ')!.click();
    await flushPromises();
    expect(dialog()?.textContent).toContain('قيد التنفيذ');
    const confirm = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'بدء التنفيذ')!;
    confirm.click();
    await flushPromises();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/tasks/t1/transitions'));
    expect(post?.body).toEqual({ to: 'IN_PROGRESS' });
    expect(w.find('.summary__badges').text()).toContain('قيد التنفيذ');
    expect(calls.filter((c) => c.path.endsWith('/events')).length).toBe(2);
  });

  it('استئناف العمل بعد طلب التعديلات يحمل تسمية واضحة', async () => {
    setup(mkDetail({ id: 't1', title: 'م', status: 'CHANGES_REQUESTED', allowedNext: ['IN_PROGRESS'], can: { start: true } }));
    await mount();
    expect(button('استئناف العمل على التعديلات')).toBeTruthy();
  });

  it('رفض الخادم يبقى داخل الحوار بماذا/لماذا/كيف، وزر التأكيد يعيد المحاولة', async () => {
    setup(mkDetail({ id: 't1', title: 'م', status: 'ASSIGNED', allowedNext: ['IN_PROGRESS'], can: { start: true } }), {
      onPost: () => jsonResponse(409, { statusCode: 409, code: 'DEPENDENCIES_NOT_ACCEPTED', message: 'لم تُعتمد المهام السابقة بعد.', hint: 'انتظر اعتمادها ثم أعد المحاولة.' }),
    });
    await mount();
    button('بدء التنفيذ')!.click();
    await flushPromises();
    [...dialog()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'بدء التنفيذ')!.click();
    await flushPromises();
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('لا يمكن بدء المهمة بعد.'); // ماذا
    expect(text).toContain('السبب المحتمل'); // لماذا
    expect(text).toContain('انتظر اعتمادها ثم أعد المحاولة.'); // كيف
    // the dialog stays open, so its confirm button is the retry
    expect([...dialog()!.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'بدء التنفيذ')).toBe(true);
  });

  it('مهمة قابلة للبدء لكن محجوبة بسوابق: يشرح السبب ولا يعرض زر البدء', async () => {
    setup(mkDetail({ id: 't1', title: 'م', status: 'ASSIGNED', allowedNext: [], can: { start: true }, blockedBy: [{ id: 'p', title: 'اعتماد التصميم', status: 'UNDER_REVIEW' }] }));
    const { w } = await mount();
    expect(button('بدء التنفيذ')).toBeUndefined();
    expect(w.text()).toContain('لا يمكن بدء التنفيذ قبل اعتماد: اعتماد التصميم');
  });

  it('المدير المختص المعيّن (assign بلا edit) يرى «الإسناد» لا «تعديل المهمة»، ومهمة مكتملة لا تُعدَّل', async () => {
    setup(mkDetail({ id: 't1', title: 'م', status: 'PLANNED', assignedTo: null, can: { assign: true } }));
    const { w } = await mount();
    expect(button('الإسناد')).toBeTruthy();
    expect(button('تعديل المهمة')).toBeUndefined();
    expect(w.text()).toContain('لإسناد المهمة حدّد المكلّف والمراجع أولًا');
    w.unmount();
    vi.unstubAllGlobals();
    setup(mkDetail({ id: 't1', title: 'م', status: 'COMPLETED', can: { edit: true } }));
    await mount();
    expect(button('تعديل المهمة')).toBeUndefined();
  });

  it('حذف فرعية: تأكيد بنبرة خطر ثم DELETE والعودة إلى المهمة الرئيسية', async () => {
    const { calls } = setup(mkDetail({ id: 't1', title: 'فرعية', parentTaskId: 'm1', parent: { id: 'm1', title: 'رئيسية' }, status: 'PLANNED', can: { delete: true, archive: true } }));
    const { ctx } = await mount();
    button('حذف')!.click();
    await flushPromises();
    expect(dialog()?.textContent).toContain('لا رجعة فيه');
    [...dialog()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'حذف نهائي')!.click();
    await flushPromises();
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/tasks/t1'))).toBe(true);
    expect(ctx.router.currentRoute.value.fullPath).toBe('/tasks/m1');
  });

  it('الاعتماديات: الإضافة ترسل predecessor→هذه المهمة، والحذف يمر بتأكيد', async () => {
    const dep = { id: 'd1', projectId: 'p1', predecessor: { id: 'x', title: 'التحليل', status: 'COMPLETED' as const }, successor: { id: 't1', title: 'م', status: 'PLANNED' as const }, dependencyType: 'FINISH_TO_START_WITH_ACCEPTANCE' as const, createdAt: '2026-11-01T00:00:00Z' };
    const { calls } = setup(mkDetail({ id: 't1', title: 'م', status: 'PLANNED', predecessors: [dep], can: { manageDependencies: true } }), {
      onPost: (p) => (p.endsWith('/dependencies') ? jsonResponse(201, { ...dep, id: 'd2' }) : undefined),
    });
    const { w } = await mount();
    expect(w.text()).toContain('التحليل');
    button('إضافة اعتمادية')!.click();
    await flushPromises();
    const select = dialog()!.querySelector('select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'other']); // self and existing predecessor excluded
    select.value = 'other';
    select.dispatchEvent(new Event('change'));
    await flushPromises();
    [...dialog()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'إضافة')!.click();
    await flushPromises();
    expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/projects/p1/dependencies'))?.body).toEqual({ predecessorTaskId: 'other', successorTaskId: 't1' });

    (document.querySelector('[aria-label="حذف الاعتماد على التحليل"]') as HTMLButtonElement).click();
    await flushPromises();
    [...dialog()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'حذف الاعتمادية')!.click();
    await flushPromises();
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/dependencies/d1'))).toBe(true);
  });

  it('الفرعيات روابط إلى تفاصيلها، والسجل بأحدث حدث أولًا مع تسميات عربية للأحداث', async () => {
    setup(mkDetail({ id: 't1', title: 'رئيسية', subtasks: [mkTask({ id: 's1', title: 'تصميم الواجهات', status: 'COMPLETED' })], can: { createSubtask: true } }), {
      events: [
        { id: 'e1', taskId: 't1', type: 'TASK_CREATED', fromStatus: null, toStatus: 'PLANNED', actor: { id: 'u1', fullName: 'سارة', role: 'EXECUTIVE_MANAGER' }, meta: {}, createdAt: '2026-11-01T00:00:00Z' },
        { id: 'e2', taskId: 't1', type: 'TASK_STATUS_CHANGED', fromStatus: 'PLANNED', toStatus: 'ASSIGNED', actor: null, meta: { reason: 'DEPENDENCY_ADDED_AFTER_START' }, createdAt: '2026-11-02T00:00:00Z' },
      ],
    });
    const { w } = await mount();
    expect(w.find('a[href="/tasks/s1"]').text()).toBe('تصميم الواجهات');
    expect(button('مهمة فرعية جديدة')).toBeTruthy();
    const items = w.findAll('.timeline li');
    expect(items[0]!.text()).toContain('تغيّر الحالة');
    expect(items[0]!.text()).toContain('مخططة ← مسندة');
    expect(items[0]!.text()).toContain('أُضيفت اعتمادية بعد بدء العمل');
    expect(items[0]!.text()).toContain('النظام');
    expect(items[1]!.text()).toContain('إنشاء المهمة');
    expect(w.text()).not.toContain('TASK_STATUS_CHANGED');
  });

  it('مهمة غير مرئية/غير موجودة (404) ← رسالة واضحة لا صفحة فارغة', async () => {
    mockFetch(() => jsonResponse(404, { statusCode: 404, code: 'NOT_FOUND', message: 'غير موجود' }));
    const { w } = await mount('missing');
    expect(w.text()).toContain('المهمة غير موجودة');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardResponse, ProjectDto, Role, TaskListItem } from '@/api/types';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch, mountView } from '@/test/utils';
import { relativeTime } from '@/utils/format';
import DashboardView from './DashboardView.vue';

const task = (over: Partial<TaskListItem> & Pick<TaskListItem, 'id' | 'title'>): TaskListItem => ({
  projectId: 'p1', parentTaskId: null, description: null, status: 'IN_PROGRESS', isRequired: true, priority: 'MEDIUM',
  dueDate: null, isOverdue: false, specialization: null,
  createdBy: { id: 'u1', fullName: 'سارة', role: 'EXECUTIVE_MANAGER' }, assignedManager: null,
  assignedTo: { id: 'u9', fullName: 'ليلى', role: 'EMPLOYEE' }, reviewer: null, needsReview: false, archivedAt: null,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  projectName: 'بوابة العملاء', subtaskCount: 0, completedSubtaskCount: 0, ...over,
});

const dash = (role: Role, over: Partial<DashboardResponse> = {}): DashboardResponse => ({
  role, scope: role === 'EMPLOYEE' ? 'PERSONAL' : 'COMPANY',
  projects: { total: 3, byStatus: { ACTIVE: 1, PLANNED: 1, COMPLETED: 1 } },
  tasks: { total: 14, byStatus: { COMPLETED: 4, IN_PROGRESS: 2, PLANNED: 3, UNDER_REVIEW: 1, SUBMITTED: 1, CHANGES_REQUESTED: 1, ASSIGNED: 2 }, byPriority: { URGENT: 2, HIGH: 5, MEDIUM: 5, LOW: 2 }, overdue: 2 },
  myOpenTasks: 5, awaitingMyReview: 1, flaggedForReview: 1,
  recentTasks: [task({ id: 't1', title: 'ربط الواجهة', isOverdue: true }), task({ id: 't2', title: 'مراجعة الأداء', status: 'CHANGES_REQUESTED' })],
  awaitingReviewTasks: [task({ id: 't3', title: 'لوحة التحكم', status: 'UNDER_REVIEW' })],
  ...over,
});

const project = (id: string, name: string, progressPct: number, status: ProjectDto['status'] = 'ACTIVE'): ProjectDto => ({
  id, name, description: null, status, startDate: null, dueDate: null, createdBy: { id: 'u1', fullName: 'سارة', role: 'EXECUTIVE_MANAGER' },
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', taskCounts: { total: 0 }, progressPct, overdueCount: 0, allowedNextStatuses: [],
});

async function mountAs(role: Role, d: DashboardResponse | (() => Response) = dash(role)) {
  const calls: string[] = [];
  mockFetch((url) => {
    calls.push(url);
    if (url.includes('/dashboard')) return typeof d === 'function' ? d() : jsonResponse(200, d);
    if (url.includes('/projects')) return jsonResponse(200, { items: [project('p1', 'بوابة العملاء', 33), project('p2', 'ملغى', 10, 'CANCELLED')], total: 2, page: 1, pageSize: 5 });
    return jsonResponse(404, {});
  });
  const ctx = freshApp();
  ctx.auth.apply(authResponse({ user: { ...authResponse().user, role, fullName: 'سارة أحمد', canCreateProjects: role === 'EXECUTIVE_MANAGER' } }));
  const w = await mountView(DashboardView, { router: ctx.router, path: '/dashboard' });
  return { w, calls };
}

const stats = (w: Awaited<ReturnType<typeof mountAs>>['w']) =>
  w.findAll('.stat').map((s) => [s.find('.stat__label').text(), s.find('.stat__value').text(), s.find('.stat__hint').exists() ? s.find('.stat__hint').text() : '']);

afterEach(() => vi.unstubAllGlobals());

describe('DashboardView', () => {
  it('المدير التنفيذي: عنوان باسمه الأول ومؤشرات محسوبة من الخادم لا أرقام تصميم', async () => {
    const { w, calls } = await mountAs('EXECUTIVE_MANAGER');
    expect(w.find('h1').text()).toBe('مرحبًا بك، سارة');
    expect(stats(w)).toEqual([
      ['إجمالي المشاريع', '3', '1 نشطة'],
      ['مشاريع نشطة', '1', '33% من الإجمالي'],
      ['المهام المكتملة', '4', 'من أصل 14'],
      ['معدل الإنجاز', '29%', '2 متأخرة عن موعدها'],
    ]);
    expect(calls.some((u) => u.includes('/projects') && u.includes('sort=updatedAt') && u.includes('order=desc'))).toBe(true);
  });

  it.each([
    ['PROJECT_MANAGER', 'مساحة إدارة المشاريع', ['المشاريع', 'مهام مفتوحة', 'مهام قيد التنفيذ', 'تسليمات للمراجعة'], ['3', '10', '2', '2']],
    ['SPECIALIZED_MANAGER', 'لوحة إدارة التخصص', ['مهام التخصص', 'قيد التنفيذ', 'بانتظار مراجعتي', 'إنجاز الفريق'], ['14', '2', '1', '29%']],
    ['EMPLOYEE', 'مهامي اليوم', ['مهامي المفتوحة', 'قيد التنفيذ', 'تحتاج تعديلات', 'مكتملة'], ['5', '2', '1', '4']],
  ] as const)('%s: عنوان Figma ومؤشرات الدور', async (role, title, labels, values) => {
    const { w } = await mountAs(role);
    expect(w.find('h1').text()).toBe(title);
    expect(stats(w).map((s) => s[0])).toEqual(labels);
    expect(stats(w).map((s) => s[1])).toEqual(values);
  });

  it('آخر التحديثات: الحالة نصًّا والتأخر والمكلَّف والوقت النسبي؛ والمشروع الملغى لا يظهر في التقدّم', async () => {
    const { w } = await mountAs('EXECUTIVE_MANAGER');
    const rows = w.findAll('.recent .activity__row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('ربط الواجهة');
    expect(rows[0]!.text()).toContain('متأخرة');
    expect(rows[0]!.text()).toContain('قيد التنفيذ');
    expect(rows[0]!.text()).toContain(`ليلى • ${relativeTime(new Date(Date.now() - 20 * 60_000).toISOString())}`);
    expect(rows[1]!.text()).toContain('تعديلات مطلوبة');
    const bars = w.findAll('[role="progressbar"]');
    expect(bars.map((b) => b.attributes('aria-label'))).toEqual(['بوابة العملاء']);
    expect(bars[0]!.attributes('aria-valuenow')).toBe('33');
  });

  it('عنوان بطاقة المراجعة حسب الدور: «بانتظار مراجعتك» للمراجع فقط', async () => {
    expect((await mountAs('SPECIALIZED_MANAGER')).w.text()).toContain('بانتظار مراجعتك');
    const exec = (await mountAs('EXECUTIVE_MANAGER')).w.text();
    expect(exec).toContain('تسليمات بانتظار المراجعة');
    expect(exec).not.toContain('بانتظار مراجعتك');
  });

  it('لا روابط ميتة: كل رابط في اللوحة يشير إلى مسار مسجّل', async () => {
    const { w } = await mountAs('EXECUTIVE_MANAGER');
    for (const a of w.findAll('a')) expect(a.attributes('href')).toBeTruthy();
  });

  it('صفر مهام: «معدل الإنجاز» = — لا 0% مضلّل، وحالة فارغة لآخر التحديثات', async () => {
    const empty = dash('EXECUTIVE_MANAGER', { tasks: { total: 0, byStatus: {}, byPriority: {}, overdue: 0 }, recentTasks: [], awaitingReviewTasks: [] });
    const { w } = await mountAs('EXECUTIVE_MANAGER', empty);
    expect(stats(w)[3]).toEqual(['معدل الإنجاز', '—', 'لا مهام متأخرة']);
    expect(w.text()).toContain('لا مهام بعد');
  });

  it('فشل الخادم: ماذا/لماذا/كيف مع إعادة محاولة تنجح', async () => {
    let fail = true;
    const { w } = await mountAs('EXECUTIVE_MANAGER', () => (fail ? jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'خطأ' }) : jsonResponse(200, dash('EXECUTIVE_MANAGER'))));
    expect(w.text()).toContain('كيف تعالجه');
    fail = false;
    await w.findAll('button').find((b) => b.text().includes('إعادة المحاولة'))!.trigger('click');
    await flushPromises();
    expect(stats(w)).toHaveLength(4);
  });
});

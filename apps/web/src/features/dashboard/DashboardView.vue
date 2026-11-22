<script setup lang="ts">
/**
 * Role dashboards (Figma: 4 "Dashboard" screens). One view, four configurations: heading + 4 KPI cards +
 * "آخر تحديثات العمل" + "ملخص الأداء". Every number comes from GET /dashboard and GET /projects;
 * design-only figures that would need history the API does not keep (e.g. "+2 هذا الشهر") are not shown.
 */
import { computed, onMounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { dashboardApi, projectsApi } from '@/api/endpoints';
import type { DashboardResponse, Priority, ProjectDto, TaskListItem, TaskStatus } from '@/api/types';
import { PRIORITIES } from '@/api/types';
import AppCard from '@/components/AppCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatCard from '@/components/StatCard.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useAuthStore } from '@/stores/auth';
import { formatNumber, percent, relativeTime } from '@/utils/format';
import { PRIORITY_LABELS, PRIORITY_TONE, taskStatusBadge } from '@/features/work/labels';
import { HEADINGS } from './copy';

interface Kpi { label: string; value: string; hint?: string; tone?: 'positive' | 'attention' | 'muted' }

const auth = useAuthStore();
const router = useRouter();

const { data, error, loading, settled, load } = useAsyncData(async () => {
  const [dash, projects] = await Promise.all([
    dashboardApi.get(),
    projectsApi.list({ pageSize: 5, sort: 'updatedAt', order: 'desc' }),
  ]);
  return { dash, projects: projects.items };
});
onMounted(load);

const n = (d: DashboardResponse, s: TaskStatus): number => d.tasks.byStatus[s] ?? 0;
const fmt = (v: number): string => formatNumber(v);
const pctText = (v: number | null): string => (v === null ? '—' : `${v}%`);

const heading = computed(() => {
  const role = auth.role ?? 'EMPLOYEE';
  const h = HEADINGS[role];
  const first = (auth.user?.fullName ?? '').split(/\s+/)[0] ?? '';
  return { title: role === 'EXECUTIVE_MANAGER' ? `${h.title}، ${first}` : h.title, subtitle: h.subtitle };
});

const kpis = computed<Kpi[]>(() => {
  const d = data.value?.dash;
  if (!d) return [];
  const completed = n(d, 'COMPLETED');
  const done = percent(completed, d.tasks.total);
  const overdueHint: Pick<Kpi, 'hint' | 'tone'> = d.tasks.overdue
    ? { hint: `${fmt(d.tasks.overdue)} متأخرة عن موعدها`, tone: 'attention' }
    : { hint: 'لا مهام متأخرة', tone: 'positive' };
  const active = d.projects.byStatus.ACTIVE ?? 0;
  switch (d.role) {
    case 'EXECUTIVE_MANAGER':
      return [
        { label: 'إجمالي المشاريع', value: fmt(d.projects.total), hint: `${fmt(active)} نشطة`, tone: 'muted' },
        { label: 'مشاريع نشطة', value: fmt(active), hint: d.projects.total ? `${percent(active, d.projects.total)}% من الإجمالي` : undefined },
        { label: 'المهام المكتملة', value: fmt(completed), hint: `من أصل ${fmt(d.tasks.total)}`, tone: 'muted' },
        { label: 'معدل الإنجاز', value: pctText(done), ...overdueHint },
      ];
    case 'PROJECT_MANAGER': {
      const reviewQueue = n(d, 'SUBMITTED') + n(d, 'UNDER_REVIEW');
      return [
        { label: 'المشاريع', value: fmt(d.projects.total), hint: `${fmt(active)} نشطة`, tone: 'muted' },
        { label: 'مهام مفتوحة', value: fmt(d.tasks.total - completed), hint: `${fmt(n(d, 'PLANNED'))} بانتظار الإسناد`, tone: n(d, 'PLANNED') ? 'attention' : 'muted' },
        { label: 'مهام قيد التنفيذ', value: fmt(n(d, 'IN_PROGRESS')), ...overdueHint },
        { label: 'تسليمات للمراجعة', value: fmt(reviewQueue), hint: d.flaggedForReview ? `${fmt(d.flaggedForReview)} تحتاج إعادة نظر` : 'لا تنبيهات مراجعة', tone: d.flaggedForReview ? 'attention' : 'muted' },
      ];
    }
    case 'SPECIALIZED_MANAGER':
      return [
        { label: 'مهام التخصص', value: fmt(d.tasks.total), hint: `${fmt(n(d, 'ASSIGNED'))} مسندة لم تبدأ`, tone: 'muted' },
        { label: 'قيد التنفيذ', value: fmt(n(d, 'IN_PROGRESS')), ...overdueHint },
        { label: 'بانتظار مراجعتي', value: fmt(d.awaitingMyReview), hint: d.awaitingMyReview ? 'تحتاج قرارك' : 'لا شيء بانتظارك', tone: d.awaitingMyReview ? 'attention' : 'muted' },
        { label: 'إنجاز الفريق', value: pctText(done), hint: `${fmt(completed)} من ${fmt(d.tasks.total)} مكتملة`, tone: 'muted' },
      ];
    default:
      return [
        { label: 'مهامي المفتوحة', value: fmt(d.myOpenTasks), ...overdueHint },
        { label: 'قيد التنفيذ', value: fmt(n(d, 'IN_PROGRESS')), hint: n(d, 'IN_PROGRESS') ? 'تابع التقدم' : undefined, tone: 'muted' },
        { label: 'تحتاج تعديلات', value: fmt(n(d, 'CHANGES_REQUESTED')), hint: n(d, 'CHANGES_REQUESTED') ? 'راجع الملاحظات' : 'لا تعديلات مطلوبة', tone: n(d, 'CHANGES_REQUESTED') ? 'attention' : 'muted' },
        { label: 'مكتملة', value: fmt(completed), hint: completed ? 'أحسنت العمل' : undefined },
      ];
  }
});

const recent = computed<TaskListItem[]>(() => (data.value?.dash.recentTasks ?? []).slice(0, 6));
const reviewQueue = computed<TaskListItem[]>(() => (data.value?.dash.awaitingReviewTasks ?? []).slice(0, 5));
const projects = computed<ProjectDto[]>(() => (data.value?.projects ?? []).filter((p) => p.status !== 'CANCELLED'));
const priorities = computed<Array<{ p: Priority; count: number }>>(() =>
  PRIORITIES.map((p) => ({ p, count: data.value?.dash.tasks.byPriority?.[p] ?? 0 })),
);

/** Links only to screens that exist (no dead links while later screens are being built). */
const taskLink = (id: string) => (router.hasRoute('task-detail') ? { name: 'task-detail', params: { id } } : null);
const projectLink = (id: string) => (router.hasRoute('project-detail') ? { name: 'project-detail', params: { id } } : null);
const canCreateProject = computed(() => !!auth.user?.canCreateProjects && router.hasRoute('projects'));
const who = (t: TaskListItem): string => t.assignedTo?.fullName ?? t.assignedManager?.fullName ?? 'غير مسندة';
</script>

<template>
  <PageHeader :title="heading.title" :subtitle="heading.subtitle">
    <RouterLink v-if="canCreateProject" class="btn-link btn-link--primary" :to="{ name: 'projects', query: { new: '1' } }">＋ مشروع جديد</RouterLink>
    <RouterLink v-if="router.hasRoute('tasks')" class="btn-link" :to="{ name: 'tasks' }">كل المهام</RouterLink>
  </PageHeader>

  <ErrorState v-if="error && !data" :error="error" :retrying="loading" @retry="load" />

  <template v-else-if="!settled || !data">
    <div class="kpis" aria-busy="true" aria-label="جارٍ تحميل المؤشرات">
      <SkeletonBlock v-for="i in 4" :key="i" height="112px" radius="12px" />
    </div>
    <div class="body"><SkeletonBlock height="320px" radius="12px" /><SkeletonBlock height="320px" radius="12px" /></div>
  </template>

  <template v-else>
    <section class="kpis" aria-label="المؤشرات الرئيسية">
      <StatCard v-for="k in kpis" :key="k.label" :label="k.label" :value="k.value" :hint="k.hint" :tone="k.tone" />
    </section>

    <div class="body">
      <AppCard class="recent">
        <h2 class="card-title">آخر تحديثات العمل</h2>
        <EmptyState v-if="!recent.length" title="لا مهام بعد" description="ستظهر هنا آخر المهام التي تغيّرت حالتها أو بياناتها." icon="clock" />
        <ul v-else class="activity">
          <li v-for="t in recent" :key="t.id" class="activity__row">
            <div class="activity__main">
              <component :is="taskLink(t.id) ? RouterLink : 'span'" :to="taskLink(t.id) ?? undefined" class="activity__title">{{ t.title }}</component>
              <p class="activity__meta">{{ who(t) }} • {{ relativeTime(t.updatedAt) }} • {{ t.projectName }}</p>
            </div>
            <div class="activity__tags">
              <StatusBadge v-if="t.isOverdue" tone="warning" label="متأخرة" />
              <StatusBadge v-bind="taskStatusBadge(t.status)" />
            </div>
          </li>
        </ul>
      </AppCard>

      <div class="side">
        <AppCard>
          <h2 class="card-title">ملخص الأداء</h2>
          <h3 class="sub-title">تقدّم المشاريع</h3>
          <EmptyState v-if="!projects.length" title="لا مشاريع ظاهرة لك" icon="info" />
          <div v-else class="bars">
            <component :is="projectLink(p.id) ? RouterLink : 'div'" v-for="p in projects" :key="p.id" :to="projectLink(p.id) ?? undefined" class="bar-link">
              <ProgressBar :value="p.progressPct" :label="p.name" />
            </component>
          </div>
          <h3 class="sub-title">المهام حسب الأولوية</h3>
          <ul class="prio">
            <li v-for="x in priorities" :key="x.p" :class="`prio--${PRIORITY_TONE[x.p]}`">
              <span>{{ PRIORITY_LABELS[x.p] }}</span><strong>{{ formatNumber(x.count) }}</strong>
            </li>
          </ul>
        </AppCard>

        <AppCard v-if="reviewQueue.length">
          <h2 class="card-title">{{ auth.role === 'SPECIALIZED_MANAGER' ? 'بانتظار مراجعتك' : 'تسليمات بانتظار المراجعة' }}</h2>
          <ul class="activity">
            <li v-for="t in reviewQueue" :key="t.id" class="activity__row">
              <div class="activity__main">
                <component :is="taskLink(t.id) ? RouterLink : 'span'" :to="taskLink(t.id) ?? undefined" class="activity__title">{{ t.title }}</component>
                <p class="activity__meta">{{ t.projectName }} • {{ relativeTime(t.updatedAt) }}</p>
              </div>
              <StatusBadge v-bind="taskStatusBadge(t.status)" />
            </li>
          </ul>
        </AppCard>
      </div>
    </div>
  </template>
</template>

<style scoped>
.kpis { display: grid; gap: var(--sp-3); grid-template-columns: repeat(4, minmax(0, 1fr)); margin-block-end: var(--sp-4); }
.body { display: grid; gap: 14px; grid-template-columns: minmax(0, 7fr) minmax(0, 4fr); align-items: start; }
.side { display: grid; gap: 14px; }
.card-title { color: var(--forest); font-size: 1.0625rem; font-weight: 700; margin-block-end: var(--sp-3); }
.sub-title { color: var(--muted); font-size: 0.8125rem; font-weight: 500; margin-block: var(--sp-3) var(--sp-2); }
.activity { list-style: none; margin: 0; padding: 0; display: grid; }
.activity__row { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); padding: var(--sp-2); border-block-end: 1px solid var(--row-line); min-block-size: 62px; }
.activity__row:last-child { border-block-end: 0; }
.activity__main { min-inline-size: 0; }
.activity__title { color: var(--ink); font-size: var(--fs-sm); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
a.activity__title:hover, a.activity__title:focus-visible { color: var(--emerald-ink); text-decoration: underline; }
.activity__meta { color: var(--muted); font-size: var(--fs-xs); margin-block-start: 2px; }
.activity__tags { display: flex; gap: var(--sp-1); flex-wrap: wrap; justify-content: flex-end; flex: none; }
.bars { display: grid; gap: var(--sp-3); }
.bar-link { color: inherit; text-decoration: none; border-radius: var(--radius-sm); }
a.bar-link:hover .pb__label { text-decoration: underline; }
.prio { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); }
.prio li { display: flex; justify-content: space-between; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); font-size: var(--fs-sm); }
.prio--danger { background: var(--red-soft); color: var(--red-ink); }
.prio--warning { background: var(--mango-soft); color: var(--mango-ink); }
.prio--info { background: var(--blue-soft); color: var(--blue-ink); }
.prio--neutral { background: #eef2ef; color: #46564f; }
.btn-link { display: inline-flex; align-items: center; min-block-size: 40px; padding-inline: var(--sp-4); border-radius: var(--radius-md); border: 1px solid var(--line); background: var(--surface); color: var(--forest); font-weight: 600; font-size: var(--fs-sm); text-decoration: none; }
.btn-link--primary { background: var(--forest); color: #fff; border-color: var(--forest); }
.btn-link:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
@media (max-width: 1100px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .body { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .kpis { grid-template-columns: 1fr 1fr; gap: var(--sp-2); } .activity__row { flex-direction: column; align-items: flex-start; } .activity__tags { justify-content: flex-start; } }
</style>

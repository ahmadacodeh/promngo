<script setup lang="ts">
/**
 * Figma "Tasks Management": search + project + status + priority filters, sort (priority first by default,
 * owner decision T4), scope tabs (all / mine / to review), overdue-only toggle. Server-side filters, sort
 * and paging (GET /tasks). Filters live in the URL so dashboard links and reloads keep them.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import { projectsApi, tasksApi } from '@/api/endpoints';
import { PRIORITIES, TASK_STATUSES, type Priority, type TaskListItem, type TaskListQuery, type TaskScope, type TaskStatus } from '@/api/types';
import AppCard from '@/components/AppCard.vue';
import CheckboxField from '@/components/CheckboxField.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import SelectField from '@/components/SelectField.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import TextField from '@/components/TextField.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useDebounced } from '@/composables/useDebounced';
import { TASK_STATUS_LABELS } from '@/i18n/ar';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils/format';
import { PRIORITY_LABELS, PRIORITY_TONE, taskStatusBadge } from '@/features/work/labels';

const PAGE_SIZE = 20;
const SORTS = {
  priority: { label: 'الأولوية (الأعلى أولًا)', sort: 'priority', order: 'desc' },
  dueDate: { label: 'أقرب استحقاق', sort: 'dueDate', order: 'asc' },
  updatedAt: { label: 'آخر تحديث', sort: 'updatedAt', order: 'desc' },
  title: { label: 'العنوان (أ–ي)', sort: 'title', order: 'asc' },
} as const satisfies Record<string, { label: string; sort: TaskListQuery['sort']; order: TaskListQuery['order'] }>;
type SortKey = keyof typeof SORTS;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T | ''): T | '' => (allowed.includes(str(v) as T) ? (str(v) as T) : fallback);

const scopes = computed<Array<{ value: TaskScope; label: string }>>(() => [
  { value: 'all', label: 'كل المهام' },
  { value: 'mine', label: 'مهامي' },
  ...(auth.role === 'SPECIALIZED_MANAGER' || auth.role === 'EXECUTIVE_MANAGER' || auth.role === 'PROJECT_MANAGER' ? [{ value: 'review' as const, label: 'للمراجعة' }] : []),
]);

const scope = ref<TaskScope>((pick(route.query.scope, ['all', 'mine', 'review'] as const, 'all') || 'all') as TaskScope);
const q = ref(str(route.query.q));
const debouncedQ = useDebounced(q);
const projectId = ref(str(route.query.project));
const status = ref<'' | TaskStatus>(pick(route.query.status, TASK_STATUSES, ''));
const priority = ref<'' | Priority>(pick(route.query.priority, PRIORITIES, ''));
const overdue = ref(route.query.overdue === '1');
const sortKey = ref<SortKey>((pick(route.query.sort, Object.keys(SORTS) as SortKey[], 'priority') || 'priority') as SortKey);
const page = ref(Math.max(1, Number(route.query.page) || 1));

const projects = useAsyncData(() => projectsApi.list({ pageSize: 100, sort: 'name', order: 'asc' }));
const projectOptions = computed(() => [{ value: '', label: 'كل المشاريع' }, ...(projects.data.value?.items ?? []).map((p) => ({ value: p.id, label: p.name }))]);
const statusOptions = [{ value: '', label: 'كل الحالات' }, ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))];
const priorityOptions = [{ value: '', label: 'كل الأولويات' }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))];
const sortOptions = Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label }));

const { data, error, loading, settled, load } = useAsyncData(() =>
  tasksApi.list({
    scope: scope.value,
    page: page.value,
    pageSize: PAGE_SIZE,
    q: debouncedQ.value.trim() || undefined,
    projectId: projectId.value || undefined,
    status: status.value || undefined,
    priority: priority.value || undefined,
    overdue: overdue.value || undefined,
    sort: SORTS[sortKey.value].sort,
    order: SORTS[sortKey.value].order,
  }),
);

function syncUrl() {
  const query: LocationQueryRaw = {
    scope: scope.value === 'all' ? undefined : scope.value,
    q: debouncedQ.value.trim() || undefined,
    project: projectId.value || undefined,
    status: status.value || undefined,
    priority: priority.value || undefined,
    overdue: overdue.value ? '1' : undefined,
    sort: sortKey.value === 'priority' ? undefined : sortKey.value,
    page: page.value > 1 ? String(page.value) : undefined,
  };
  void router.replace({ query });
}

onMounted(() => {
  void projects.load();
  void load();
});
watch([scope, debouncedQ, projectId, status, priority, overdue, sortKey], () => {
  syncUrl();
  if (page.value !== 1) page.value = 1;
  else void load();
});
watch(page, () => {
  syncUrl();
  void load();
});

const items = computed<TaskListItem[]>(() => data.value?.items ?? []);
const filtered = computed(() => !!(debouncedQ.value.trim() || projectId.value || status.value || priority.value || overdue.value));
function resetFilters() {
  q.value = '';
  projectId.value = '';
  status.value = '';
  priority.value = '';
  overdue.value = false;
}
const taskLink = (id: string) => (router.hasRoute('task-detail') ? { name: 'task-detail', params: { id } } : null);
const owner = (t: TaskListItem) => t.assignedTo?.fullName ?? t.assignedManager?.fullName ?? 'غير مسندة';
</script>

<template>
  <PageHeader title="إدارة المهام" subtitle="تابع المهام حسب الحالة والمسؤول والأولوية." />

  <div class="tabs" role="group" aria-label="نطاق المهام">
    <button
      v-for="s in scopes"
      :key="s.value"
      type="button"
      class="tab"
      :aria-pressed="scope === s.value"
      :class="{ 'is-active': scope === s.value }"
      @click="scope = s.value"
    >{{ s.label }}</button>
  </div>

  <AppCard class="filters-card">
    <div class="filters">
      <TextField v-model="q" type="search" label="بحث عن مهمة" placeholder="عنوان المهمة أو وصفها" :maxlength="100" />
      <SelectField v-model="projectId" label="المشروع" :options="projectOptions" :disabled="!!projects.error.value" :hint="projects.error.value ? 'تعذّر تحميل المشاريع؛ التصفية بالمشروع غير متاحة.' : ''" />
      <SelectField v-model="status" label="الحالة" :options="statusOptions" />
      <SelectField v-model="priority" label="الأولوية" :options="priorityOptions" />
      <SelectField v-model="sortKey" label="الترتيب" :options="sortOptions" />
    </div>
    <div class="filters-foot">
      <CheckboxField v-model="overdue" label="المتأخرة عن موعدها فقط" />
      <button v-if="filtered" type="button" class="linkish" @click="resetFilters">مسح التصفية</button>
    </div>
  </AppCard>

  <AppCard :padded="false">
    <h2 class="card-title">قائمة المهام <span v-if="data" class="count">({{ data.total }})</span></h2>
    <ErrorState v-if="error" class="pad" :error="error" :retrying="loading" @retry="load" />
    <div v-else-if="!settled" class="pad skel" aria-busy="true" aria-label="جارٍ تحميل المهام"><SkeletonBlock v-for="i in 5" :key="i" height="48px" /></div>
    <EmptyState
      v-else-if="!items.length"
      class="pad"
      :title="filtered ? 'لا مهام مطابقة' : scope === 'mine' ? 'لا مهام مسندة إليك' : scope === 'review' ? 'لا شيء بانتظار المراجعة' : 'لا مهام بعد'"
      :description="filtered ? 'غيّر التصفية أو امسحها.' : ''"
      icon="tasks"
    />
    <template v-else>
      <div class="dt-wrap" :aria-busy="loading">
        <table class="dt">
          <caption class="sr-only">قائمة المهام</caption>
          <thead><tr><th scope="col">المهمة</th><th scope="col">المسؤول</th><th scope="col">الحالة</th><th scope="col">الأولوية</th><th scope="col">الاستحقاق</th></tr></thead>
          <tbody>
            <tr v-for="t in items" :key="t.id">
              <td class="dt-main">
                <component :is="taskLink(t.id) ? RouterLink : 'span'" :to="taskLink(t.id) ?? undefined" class="dt-title">{{ t.title }}</component>
                <span class="dt-sub">{{ t.projectName }}<template v-if="t.parentTaskId"> • مهمة فرعية</template><template v-if="t.subtaskCount"> • {{ t.completedSubtaskCount }}/{{ t.subtaskCount }} فرعية</template></span>
              </td>
              <td data-label="المسؤول">{{ owner(t) }}</td>
              <td data-label="الحالة">
                <div class="dt-badges">
                  <StatusBadge v-bind="taskStatusBadge(t.status)" />
                  <StatusBadge v-if="t.needsReview" tone="warning" label="تحتاج إعادة نظر" />
                </div>
              </td>
              <td data-label="الأولوية"><StatusBadge :label="PRIORITY_LABELS[t.priority]" :tone="PRIORITY_TONE[t.priority]" /></td>
              <td data-label="الاستحقاق" class="dt-num">
                <span :class="{ late: t.isOverdue }">{{ formatDate(t.dueDate, true) || '—' }}</span>
                <span v-if="t.isOverdue" class="late-tag">متأخرة</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="dt-pager"><PaginationBar v-model:page="page" :page-size="PAGE_SIZE" :total="data?.total ?? 0" :disabled="loading" /></div>
    </template>
  </AppCard>
</template>

<style scoped>
.tabs { display: flex; gap: var(--sp-1); margin-block-end: var(--sp-3); border-block-end: 1px solid var(--line); overflow-x: auto; }
.tab { font: inherit; font-weight: 600; color: var(--muted); background: none; border: 0; border-block-end: 3px solid transparent; padding: var(--sp-2) var(--sp-4); cursor: pointer; white-space: nowrap; }
.tab.is-active { color: var(--forest); border-block-end-color: var(--mango); }
.tab:focus-visible { outline: none; box-shadow: var(--shadow-focus); border-radius: var(--radius-sm); }
.filters-card { margin-block-end: var(--sp-4); }
.filters { display: grid; gap: var(--sp-3); grid-template-columns: 2fr repeat(4, minmax(0, 1fr)); align-items: end; }
.filters-foot { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); margin-block-start: var(--sp-3); flex-wrap: wrap; }
.linkish { font: inherit; background: none; border: 0; color: var(--emerald-ink); font-weight: 600; cursor: pointer; text-decoration: underline; }
.card-title { color: var(--forest); font-size: 1.0625rem; font-weight: 700; padding: var(--sp-4) var(--sp-4) var(--sp-3); }
.count { color: var(--muted); font-weight: 500; font-size: var(--fs-sm); }
.pad { margin: var(--sp-4); }
.skel { display: grid; gap: var(--sp-3); }
.late { color: var(--mango-ink); font-weight: 700; }
.late-tag { display: block; color: var(--mango-ink); font-size: var(--fs-xs); }
@media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .filters > :first-child { grid-column: 1 / -1; } }
</style>

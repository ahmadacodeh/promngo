<script setup lang="ts">
/**
 * Figma "Projects Management": search + status filter + sort + "مشروع جديد", table of
 * project / owner / status / progress / due date. Data: GET /projects (server-side paging and filters).
 * The design's "مدير المشروع" filter is not offered: the API has no owner filter (see docs/backlog.md).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { projectsApi } from '@/api/endpoints';
import { PROJECT_STATUSES, type ProjectDto, type ProjectListQuery, type ProjectStatus } from '@/api/types';
import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import SelectField from '@/components/SelectField.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import TextField from '@/components/TextField.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useDebounced } from '@/composables/useDebounced';
import { useToast } from '@/composables/useToast';
import { PROJECT_STATUS_LABELS } from '@/i18n/ar';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils/format';
import { projectStatusBadge } from '@/features/work/labels';
import ProjectFormModal from './ProjectFormModal.vue';

const PAGE_SIZE = 20;
const SORTS = {
  updatedAt: { label: 'آخر تحديث', sort: 'updatedAt', order: 'desc' },
  dueDate: { label: 'أقرب تسليم', sort: 'dueDate', order: 'asc' },
  name: { label: 'الاسم (أ–ي)', sort: 'name', order: 'asc' },
  createdAt: { label: 'الأحدث إنشاءً', sort: 'createdAt', order: 'desc' },
} as const satisfies Record<string, { label: string; sort: ProjectListQuery['sort']; order: ProjectListQuery['order'] }>;
type SortKey = keyof typeof SORTS;

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const q = ref('');
const debouncedQ = useDebounced(q);
const status = ref<'' | ProjectStatus>('');
const sortKey = ref<SortKey>('updatedAt');
const page = ref(1);

const canCreate = computed(() => (auth.role === 'EXECUTIVE_MANAGER' || auth.role === 'PROJECT_MANAGER') && !!auth.user?.canCreateProjects);
const statusOptions = [{ value: '', label: 'جميع الحالات' }, ...PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))];
const sortOptions = Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label }));

const { data, error, loading, settled, load } = useAsyncData(() =>
  projectsApi.list({
    page: page.value,
    pageSize: PAGE_SIZE,
    q: debouncedQ.value.trim() || undefined,
    status: status.value || undefined,
    sort: SORTS[sortKey.value].sort,
    order: SORTS[sortKey.value].order,
  }),
);
onMounted(load);
watch([debouncedQ, status, sortKey], () => {
  if (page.value !== 1) page.value = 1;
  else void load();
});
watch(page, () => void load());

const items = computed<ProjectDto[]>(() => data.value?.items ?? []);
const filtered = computed(() => !!(debouncedQ.value.trim() || status.value));

/* create: opened by the button or by ?new=1 (dashboard shortcut) */
const formOpen = ref(false);
watch(
  () => route.query.new,
  (v) => {
    if (v === '1' && canCreate.value) formOpen.value = true;
  },
  { immediate: true },
);
function closeForm() {
  formOpen.value = false;
  if (route.query.new) void router.replace({ query: { ...route.query, new: undefined } });
}
function onSaved(p: ProjectDto) {
  closeForm();
  toast.success(`أُنشئ المشروع «${p.name}».`);
  void router.push({ name: 'project-detail', params: { id: p.id } });
}
</script>

<template>
  <PageHeader title="إدارة المشاريع" subtitle="تابع المشاريع ومسؤوليها ونسب الإنجاز ومواعيد التسليم.">
    <AppButton v-if="canCreate" icon="plus" @click="formOpen = true">مشروع جديد</AppButton>
  </PageHeader>

  <AppCard class="filters-card">
    <div class="filters">
      <TextField v-model="q" type="search" label="ابحث عن مشروع" placeholder="اسم المشروع أو وصفه" :maxlength="100" />
      <SelectField v-model="status" label="الحالة" :options="statusOptions" />
      <SelectField v-model="sortKey" label="الترتيب" :options="sortOptions" />
    </div>
  </AppCard>

  <AppCard :padded="false">
    <h2 class="card-title">المشاريع الحالية</h2>
    <ErrorState v-if="error" class="pad" :error="error" :retrying="loading" @retry="load" />
    <div v-else-if="!settled" class="pad skel" aria-busy="true" aria-label="جارٍ تحميل المشاريع">
      <SkeletonBlock v-for="i in 4" :key="i" height="52px" />
    </div>
    <EmptyState
      v-else-if="!items.length"
      class="pad"
      :title="filtered ? 'لا مشاريع مطابقة' : 'لا مشاريع بعد'"
      :description="filtered ? 'غيّر كلمة البحث أو الحالة.' : canCreate ? 'ابدأ بإنشاء أول مشروع.' : 'ستظهر هنا المشاريع التي لك فيها مهام أو صلاحية اطلاع.'"
      icon="folder"
    />
    <template v-else>
      <div class="dt-wrap" :aria-busy="loading">
        <table class="dt">
          <caption class="sr-only">قائمة المشاريع</caption>
          <thead>
            <tr><th scope="col">المشروع</th><th scope="col">المسؤول</th><th scope="col">الحالة</th><th scope="col" class="col-progress">التقدم</th><th scope="col">تاريخ التسليم</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in items" :key="p.id">
              <td class="dt-main">
                <RouterLink class="dt-title" :to="{ name: 'project-detail', params: { id: p.id } }">{{ p.name }}</RouterLink>
                <span class="dt-sub">{{ p.taskCounts.total }} مهمة<template v-if="p.overdueCount"> • <span class="late">{{ p.overdueCount }} متأخرة</span></template></span>
              </td>
              <td data-label="المسؤول">{{ p.createdBy.fullName }}</td>
              <td data-label="الحالة"><StatusBadge v-bind="projectStatusBadge(p.status)" /></td>
              <td data-label="التقدم" class="col-progress"><ProgressBar :value="p.progressPct" :label="`تقدم ${p.name}`" class="bar" /></td>
              <td data-label="تاريخ التسليم" class="dt-num">{{ formatDate(p.dueDate) || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="dt-pager">
        <PaginationBar v-model:page="page" :page-size="PAGE_SIZE" :total="data?.total ?? 0" :disabled="loading" />
      </div>
    </template>
  </AppCard>

  <ProjectFormModal :open="formOpen" :project="null" @close="closeForm" @saved="onSaved" />
</template>

<style scoped>
.filters-card { margin-block-end: var(--sp-4); }
.filters { display: grid; gap: var(--sp-4); grid-template-columns: 2fr 1fr 1fr; align-items: end; }
.card-title { color: var(--forest); font-size: 1.0625rem; font-weight: 700; padding: var(--sp-4) var(--sp-4) var(--sp-3); }
.pad { margin: var(--sp-4); }
.skel { display: grid; gap: var(--sp-3); }
.col-progress { min-inline-size: 180px; }
.bar :deep(.pb__head .pb__label) { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
.late { color: var(--mango-ink); font-weight: 600; }
@media (max-width: 860px) {
  .filters { grid-template-columns: 1fr 1fr; }
  .filters > :first-child { grid-column: 1 / -1; }
  .col-progress { min-inline-size: 0; }
  .bar { inline-size: 55%; }
}
</style>

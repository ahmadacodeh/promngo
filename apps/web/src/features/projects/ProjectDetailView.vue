<script setup lang="ts">
/**
 * Figma "Project Details": overview (name, description, status, progress), "ملخص المشروع" and the
 * project's main tasks (Figma "المراحل الرئيسية") sorted by priority. Managers (EXEC/PM, re-checked by
 * the API) can edit and move the project through allowedNextStatuses with an explicit confirmation.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { isHttpError } from '@/api/http';
import { projectsApi, tasksApi } from '@/api/endpoints';
import { PRIORITIES, type Priority, type ProjectDto, type ProjectStatus, type TaskListItem } from '@/api/types';
import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import SelectField from '@/components/SelectField.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useToast } from '@/composables/useToast';
import { PROJECT_STATUS_LABELS } from '@/i18n/ar';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils/format';
import { PRIORITY_LABELS, PRIORITY_TONE, projectStatusBadge, taskStatusBadge } from '@/features/work/labels';
import ProjectFormModal from './ProjectFormModal.vue';
import TaskFormModal from '@/features/tasks/TaskFormModal.vue';
import type { TaskDetail } from '@/api/types';

const TRANSITION: Record<ProjectStatus, { label: string; impact: string; tone: 'primary' | 'danger' }> = {
  ACTIVE: { label: 'تفعيل المشروع', impact: 'يصبح المشروع نشطًا ويمكن العمل على مهامه.', tone: 'primary' },
  ON_HOLD: { label: 'تعليق المشروع', impact: 'يتوقف المشروع مؤقتًا. يمكن استئنافه لاحقًا.', tone: 'primary' },
  COMPLETED: { label: 'إكمال المشروع', impact: 'حالة نهائية: يُغلق المشروع ولا تُعدّل مهامه بعد ذلك. يرفض الخادم الإكمال إن بقيت مهام مفتوحة.', tone: 'primary' },
  CANCELLED: { label: 'إلغاء المشروع', impact: 'حالة نهائية لا رجعة فيها: يُغلق المشروع وتتوقف كل التعديلات على مهامه.', tone: 'danger' },
  PLANNED: { label: 'إعادة إلى التخطيط', impact: '', tone: 'primary' },
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const id = computed(() => String(route.params.id));

const project = useAsyncData(() => projectsApi.get(id.value));
const priority = ref<'' | Priority>('');
const tasks = useAsyncData(() =>
  tasksApi.listForProject(id.value, { parentOnly: true, pageSize: 100, sort: 'priority', order: 'desc', priority: priority.value || undefined }),
);
onMounted(() => {
  void project.load();
  void tasks.load();
});
watch(id, () => {
  void project.load();
  void tasks.load();
});
watch(priority, () => void tasks.load());

const p = computed<ProjectDto | null>(() => project.data.value);
const isManager = computed(() => auth.role === 'EXECUTIVE_MANAGER' || auth.role === 'PROJECT_MANAGER');
const closed = computed(() => p.value?.status === 'COMPLETED' || p.value?.status === 'CANCELLED');
const completedCount = computed(() => p.value?.taskCounts.COMPLETED ?? 0);
const taskItems = computed<TaskListItem[]>(() => tasks.data.value?.items ?? []);
const priorityOptions = [{ value: '', label: 'كل الأولويات' }, ...PRIORITIES.map((x) => ({ value: x, label: PRIORITY_LABELS[x] }))];
const taskLink = (tid: string) => (router.hasRoute('task-detail') ? { name: 'task-detail', params: { id: tid } } : null);
const notFound = computed(() => isHttpError(project.error.value) && (project.error.value.statusCode === 404 || project.error.value.statusCode === 400));

/* edit */
const editOpen = ref(false);
function onSaved(saved: ProjectDto) {
  editOpen.value = false;
  project.data.value = saved;
  toast.success('حُفظت تعديلات المشروع.');
}

/* new main task (EXEC/PM, open project; the server re-checks) */
const taskFormOpen = ref(false);
function onTaskCreated(t: TaskDetail) {
  taskFormOpen.value = false;
  void router.push({ name: 'task-detail', params: { id: t.id } });
}

/* status transition */
const target = ref<ProjectStatus | null>(null);
const moving = ref(false);
const moveError = ref<unknown>(null);
function ask(s: ProjectStatus) {
  moveError.value = null;
  target.value = s;
}
async function confirmMove() {
  if (!target.value || !p.value) return;
  moving.value = true;
  moveError.value = null;
  try {
    const saved = await projectsApi.update(p.value.id, { status: target.value });
    project.data.value = saved;
    toast.success(`أصبحت حالة المشروع: ${PROJECT_STATUS_LABELS[saved.status]}.`);
    target.value = null;
    void tasks.load();
  } catch (e) {
    moveError.value = e;
  } finally {
    moving.value = false;
  }
}
</script>

<template>
  <PageHeader title="تفاصيل المشروع" :subtitle="p?.name ?? ''">
    <RouterLink class="back" :to="{ name: 'projects' }">→ كل المشاريع</RouterLink>
  </PageHeader>

  <EmptyState v-if="notFound" title="المشروع غير موجود" description="ربما حُذف الرابط أو أن المشروع ليس ضمن ما يحق لك رؤيته." icon="folder" />
  <ErrorState v-else-if="project.error.value" :error="project.error.value" :retrying="project.loading.value" @retry="project.load" />
  <div v-else-if="!p" class="skel" aria-busy="true" aria-label="جارٍ تحميل المشروع">
    <SkeletonBlock height="150px" radius="12px" /><SkeletonBlock height="280px" radius="12px" />
  </div>

  <template v-else>
    <AppCard class="overview">
      <div class="overview__info">
        <div class="overview__head">
          <h2 class="overview__name">{{ p.name }}</h2>
          <StatusBadge v-bind="projectStatusBadge(p.status)" />
        </div>
        <p class="overview__desc">{{ p.description || 'لا وصف لهذا المشروع.' }}</p>
        <div v-if="isManager" class="overview__acts">
          <AppButton v-if="!closed" variant="secondary" size="sm" icon="edit" @click="editOpen = true">تعديل البيانات</AppButton>
          <AppButton
            v-for="s in p.allowedNextStatuses"
            :key="s"
            size="sm"
            :variant="TRANSITION[s].tone === 'danger' ? 'danger' : 'secondary'"
            @click="ask(s)"
          >{{ TRANSITION[s].label }}</AppButton>
        </div>
      </div>
      <div class="overview__progress">
        <p class="big">{{ p.progressPct }}%</p>
        <p class="muted">نسبة الإنجاز</p>
        <ProgressBar :value="p.progressPct" label="نسبة إنجاز المشروع" class="overview__bar" />
      </div>
    </AppCard>

    <div class="panels">
      <AppCard>
        <h2 class="card-title">ملخص المشروع</h2>
        <dl class="kv">
          <div><dt>المسؤول</dt><dd>{{ p.createdBy.fullName }}</dd></div>
          <div><dt>تاريخ البداية</dt><dd>{{ formatDate(p.startDate) || 'غير محدد' }}</dd></div>
          <div><dt>تاريخ التسليم</dt><dd>{{ formatDate(p.dueDate) || 'غير محدد' }}</dd></div>
          <div><dt>المهام</dt><dd>{{ p.taskCounts.total }} مهمة • {{ completedCount }} مكتملة</dd></div>
          <div><dt>المتأخرة</dt><dd :class="{ late: p.overdueCount }">{{ p.overdueCount ? `${p.overdueCount} مهمة متأخرة` : 'لا مهام متأخرة' }}</dd></div>
          <div><dt>آخر تحديث</dt><dd>{{ formatDate(p.updatedAt.slice(0, 10)) }}</dd></div>
        </dl>
        <p v-if="closed" class="closed-note">المشروع مغلق: لا تُقبل تعديلات على بياناته أو مهامه.</p>
      </AppCard>

      <AppCard :padded="false" class="tasks-card">
        <div class="tasks-head">
          <h2 class="card-title">المهام الرئيسية</h2>
          <div class="tasks-tools">
            <SelectField v-model="priority" label="تصفية بالأولوية" label-hidden :options="priorityOptions" class="prio-filter" />
            <AppButton v-if="isManager && !closed" size="sm" icon="plus" @click="taskFormOpen = true">مهمة جديدة</AppButton>
          </div>
        </div>
        <ErrorState v-if="tasks.error.value" class="pad" :error="tasks.error.value" :retrying="tasks.loading.value" @retry="tasks.load" />
        <div v-else-if="!tasks.settled.value" class="pad skel"><SkeletonBlock v-for="i in 3" :key="i" height="44px" /></div>
        <EmptyState v-else-if="!taskItems.length" class="pad" :title="priority ? 'لا مهام بهذه الأولوية' : 'لا مهام في هذا المشروع بعد'" icon="tasks" />
        <div v-else class="dt-wrap">
          <table class="dt">
            <caption class="sr-only">مهام المشروع الرئيسية مرتبة بالأولوية</caption>
            <thead><tr><th scope="col">المهمة</th><th scope="col">الأولوية</th><th scope="col">الحالة</th><th scope="col">المكلَّف</th><th scope="col">الاستحقاق</th></tr></thead>
            <tbody>
              <tr v-for="t in taskItems" :key="t.id">
                <td class="dt-main">
                  <component :is="taskLink(t.id) ? RouterLink : 'span'" :to="taskLink(t.id) ?? undefined" class="dt-title">{{ t.title }}</component>
                  <span v-if="t.subtaskCount" class="dt-sub">{{ t.completedSubtaskCount }}/{{ t.subtaskCount }} فرعية مكتملة</span>
                </td>
                <td data-label="الأولوية"><StatusBadge :label="PRIORITY_LABELS[t.priority]" :tone="PRIORITY_TONE[t.priority]" /></td>
                <td data-label="الحالة"><div class="dt-badges"><StatusBadge v-bind="taskStatusBadge(t.status)" /><StatusBadge v-if="t.isOverdue" tone="warning" label="متأخرة" /></div></td>
                <td data-label="المكلَّف">{{ t.assignedTo?.fullName ?? t.assignedManager?.fullName ?? 'غير مسندة' }}</td>
                <td data-label="الاستحقاق" class="dt-num">{{ formatDate(t.dueDate, true) || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>
    </div>

    <TaskFormModal :open="taskFormOpen" :project-id="p.id" @close="taskFormOpen = false" @saved="onTaskCreated" />
    <ProjectFormModal :open="editOpen" :project="p" @close="editOpen = false" @saved="onSaved" />
    <ConfirmDialog
      :open="!!target"
      :title="target ? `${TRANSITION[target].label}؟` : ''"
      :confirm-label="target ? TRANSITION[target].label : ''"
      :tone="target ? TRANSITION[target].tone : 'primary'"
      :loading="moving"
      :error="moveError"
      @confirm="confirmMove"
      @close="target = null"
    >
      <p v-if="target">{{ TRANSITION[target].impact }}</p>
    </ConfirmDialog>
  </template>
</template>

<style scoped>
.back { color: var(--emerald-ink); font-weight: 600; text-decoration: none; }
.back:hover { text-decoration: underline; }
.skel { display: grid; gap: var(--sp-3); }
.overview { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: var(--sp-5); align-items: center; margin-block-end: 14px; }
.overview__head { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.overview__name { color: var(--forest); font-size: 1.375rem; font-weight: 700; }
.overview__desc { color: var(--muted); margin-block: var(--sp-2) var(--sp-3); white-space: pre-line; }
.overview__acts { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.overview__progress { text-align: center; }
.overview__bar :deep(.pb__head) { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
.big { color: var(--forest); font-size: 2.25rem; font-weight: 700; line-height: 1.2; }
.muted { color: var(--muted); font-size: var(--fs-sm); margin-block-end: var(--sp-2); }
.panels { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 14px; align-items: start; }
.dt-title { display: inline-block; min-inline-size: 10ch; }
.card-title { color: var(--forest); font-size: 1.0625rem; font-weight: 700; margin-block-end: var(--sp-3); }
.kv { display: grid; gap: var(--sp-2); margin: 0; }
.kv div { display: flex; justify-content: space-between; gap: var(--sp-3); border-block-end: 1px solid var(--row-line); padding-block-end: var(--sp-2); }
dt { color: var(--muted); }
dd { margin: 0; font-weight: 600; text-align: end; }
.late { color: var(--mango-ink); }
.closed-note { margin-block-start: var(--sp-3); color: var(--muted); font-size: var(--fs-sm); }
.tasks-head { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); padding: var(--sp-4) var(--sp-4) 0; }
.tasks-head .card-title { margin: 0; }
.prio-filter { min-inline-size: 160px; }
.tasks-tools { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.pad { margin: var(--sp-4); }
@media (max-width: 1100px) { .panels { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .overview { grid-template-columns: 1fr; } .overview__progress { text-align: start; } .tasks-head { flex-wrap: wrap; } }
</style>

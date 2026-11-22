<script setup lang="ts">
/**
 * Figma "Task Details" (+ "Subtasks Management"): summary (title, description, status), "بيانات المهمة",
 * "الاعتماديات والمرفقات", subtasks and the history (task events).
 * Every action comes from the server's `can` + `allowedNext` (src/work/policy.ts); nothing is decided here,
 * and every call is re-authorised by the API (a refusal is shown in the dialog with a retry).
 */
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { isHttpError } from '@/api/http';
import { dependenciesApi, tasksApi } from '@/api/endpoints';
import type { DependencyDto, TaskDetail, TaskEventDto, TaskListItem, TaskStatus } from '@/api/types';
import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import SelectField from '@/components/SelectField.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import TextAreaField from '@/components/TextAreaField.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useToast } from '@/composables/useToast';
import { eventTypeLabel, TASK_STATUS_LABELS } from '@/i18n/ar';
import { formatDate, relativeTime } from '@/utils/format';
import { PRIORITY_LABELS, PRIORITY_TONE, priorityBadge, taskStatusBadge } from '@/features/work/labels';
import TaskFormModal from './TaskFormModal.vue';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const id = computed(() => String(route.params.id));

const task = useAsyncData(() => tasksApi.get(id.value));
const events = useAsyncData(() => tasksApi.events(id.value));
function loadAll() {
  void task.load();
  void events.load();
}
watch(id, loadAll, { immediate: true });

const t = computed<TaskDetail | null>(() => task.data.value);
const notFound = computed(() => isHttpError(task.error.value) && (task.error.value.statusCode === 404 || task.error.value.statusCode === 400));
const isSubtask = computed(() => !!t.value?.parentTaskId);
const closedProject = computed(() => t.value?.project.status === 'COMPLETED' || t.value?.project.status === 'CANCELLED');
const history = computed<TaskEventDto[]>(() => (events.data.value ?? []).toReversed());
const taskRoute = (tid: string) => ({ name: 'task-detail', params: { id: tid } });

/** Apply a fresh TaskDetail returned by a mutation, then refresh the history. */
function applied(next: TaskDetail, message: string) {
  task.data.value = next;
  toast.success(message);
  void events.load();
}

/* ---------- transitions (allowedNext only) ---------- */
const TRANSITION: Partial<Record<TaskStatus, { label: string; impact: string; reason?: boolean }>> = {
  ASSIGNED: { label: 'إسناد المهمة', impact: 'تصبح المهمة «مسندة» إلى المكلّف المحدد، ويستطيع بدء العمل عليها عند اكتمال اعتمادياتها.' },
  BLOCKED: { label: 'تعليم كمحجوبة', impact: 'تتوقف المهمة حتى يزول السبب، ثم تُسند من جديد.', reason: true },
  IN_PROGRESS: { label: 'بدء التنفيذ', impact: 'تنتقل المهمة إلى «قيد التنفيذ» ويُسجَّل وقت البدء في السجل.' },
};
const transitionLabel = (s: TaskStatus) => (s === 'IN_PROGRESS' && t.value?.status === 'CHANGES_REQUESTED' ? 'استئناف العمل على التعديلات' : (TRANSITION[s]?.label ?? TASK_STATUS_LABELS[s]));
const target = ref<TaskStatus | null>(null);
const reason = ref('');
const busy = ref(false);
const actionError = ref<unknown>(null);
function askTransition(s: TaskStatus) {
  actionError.value = null;
  reason.value = '';
  target.value = s;
}
async function confirmTransition() {
  if (!t.value || !target.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    const next = await tasksApi.transition(t.value.id, { to: target.value, ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) });
    target.value = null;
    applied(next, `أصبحت حالة المهمة: ${TASK_STATUS_LABELS[next.status]}.`);
  } catch (e) {
    actionError.value = e;
  } finally {
    busy.value = false;
  }
}

/* ---------- archive / delete / clear flag ---------- */
type Simple = 'archive' | 'delete' | 'clearFlag';
const SIMPLE: Record<Simple, { title: string; label: string; impact: string; danger: boolean }> = {
  archive: { title: 'أرشفة المهمة الفرعية؟', label: 'أرشفة', impact: 'تختفي المهمة من القوائم والإحصاءات، ويبقى سجلها محفوظًا. لا يمكن تعديلها بعد الأرشفة.', danger: false },
  delete: { title: 'حذف المهمة الفرعية؟', label: 'حذف نهائي', impact: 'حذف نهائي لا رجعة فيه. يُسمح به فقط لمهمة فرعية لم تُسند ولا اعتماديات ولا تسليمات لها.', danger: true },
  clearFlag: { title: 'مسح علامة «تحتاج مراجعة»؟', label: 'مسح العلامة', impact: 'تؤكد أنك راجعت أثر تغيّر المهمة السابقة على هذا العمل وأنه ما زال صالحًا.', danger: false },
};
const simple = ref<Simple | null>(null);
function askSimple(k: Simple) {
  actionError.value = null;
  simple.value = k;
}
async function confirmSimple() {
  if (!t.value || !simple.value) return;
  const cur = t.value;
  busy.value = true;
  actionError.value = null;
  try {
    if (simple.value === 'delete') {
      await tasksApi.remove(cur.id);
      simple.value = null;
      toast.success('حُذفت المهمة الفرعية.');
      await router.replace(cur.parentTaskId ? taskRoute(cur.parentTaskId) : { name: 'tasks' });
      return;
    }
    const next = simple.value === 'archive' ? await tasksApi.archive(cur.id) : await tasksApi.clearReviewFlag(cur.id);
    const msg = simple.value === 'archive' ? 'أُرشفت المهمة الفرعية.' : 'مُسحت علامة المراجعة.';
    simple.value = null;
    applied(next, msg);
  } catch (e) {
    actionError.value = e;
  } finally {
    busy.value = false;
  }
}

/* ---------- edit / assign / new subtask ---------- */
const formMode = ref<'edit' | 'assign' | 'subtask' | null>(null);
// The server refuses edits of completed or archived tasks (STATE_CONFLICT): do not offer them.
const editable = computed(() => !!t.value && t.value.status !== 'COMPLETED' && !t.value.archivedAt);
const canEdit = computed(() => editable.value && !!t.value?.can.edit);
const canAssignOnly = computed(() => editable.value && !!t.value?.can.assign && !t.value.can.edit);
function onFormSaved(saved: TaskDetail) {
  const mode = formMode.value;
  formMode.value = null;
  if (mode === 'subtask') {
    toast.success('أُنشئت المهمة الفرعية.');
    void task.load();
    void router.push(taskRoute(saved.id));
    return;
  }
  applied(saved, mode === 'assign' ? 'حُفظ الإسناد.' : 'حُفظت تعديلات المهمة.');
}
const needsPeople = computed(() => !!t.value && t.value.can.assign && (t.value.status === 'PLANNED' || t.value.status === 'BLOCKED') && (!t.value.assignedTo || !t.value.reviewer));

/* ---------- dependencies ---------- */
const depOpen = ref(false);
const depPick = ref('');
const depError = ref<unknown>(null);
const depSaving = ref(false);
const projectTasks = useAsyncData(() => tasksApi.listForProject(t.value!.projectId, { pageSize: 200, sort: 'title', order: 'asc' }));
const depOptions = computed(() => {
  const cur = t.value;
  if (!cur) return [];
  const taken = new Set([cur.id, ...cur.predecessors.map((d) => d.predecessor.id), ...cur.successors.map((d) => d.successor.id)]);
  const items: TaskListItem[] = projectTasks.data.value?.items ?? [];
  return [{ value: '', label: 'اختر المهمة السابقة' }, ...items.filter((x) => !taken.has(x.id)).map((x) => ({ value: x.id, label: `${x.title} (${TASK_STATUS_LABELS[x.status]})` }))];
});
function openDep() {
  depPick.value = '';
  depError.value = null;
  depOpen.value = true;
  void projectTasks.load();
}
async function addDep() {
  if (!t.value || !depPick.value) {
    depError.value = null;
    return;
  }
  depSaving.value = true;
  depError.value = null;
  try {
    await dependenciesApi.create(t.value.projectId, { predecessorTaskId: depPick.value, successorTaskId: t.value.id });
    depOpen.value = false;
    toast.success('أُضيفت الاعتمادية.');
    loadAll();
  } catch (e) {
    depError.value = e;
  } finally {
    depSaving.value = false;
  }
}
const depToRemove = ref<DependencyDto | null>(null);
function askRemoveDep(d: DependencyDto) {
  actionError.value = null;
  depToRemove.value = d;
}
async function confirmRemoveDep() {
  if (!depToRemove.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    await dependenciesApi.remove(depToRemove.value.id);
    depToRemove.value = null;
    toast.success('حُذفت الاعتمادية.');
    loadAll();
  } catch (e) {
    actionError.value = e;
  } finally {
    busy.value = false;
  }
}

/* ---------- history ---------- */
const REASONS: Record<string, string> = {
  PREDECESSOR_CHANGES_REQUESTED: 'طُلبت تعديلات على المهمة السابقة',
  DEPENDENCY_ADDED_AFTER_START: 'أُضيفت اعتمادية بعد بدء العمل',
};
const FIELD_LABELS: Record<string, string> = {
  title: 'العنوان', description: 'الوصف', isRequired: 'الإلزامية', priority: 'الأولوية', dueDate: 'الاستحقاق',
  specializationId: 'التخصص', assignedManagerId: 'المدير المختص', assignedToId: 'المكلّف', reviewerId: 'المراجع',
};
function eventDetail(e: TaskEventDto): string {
  const m = e.meta ?? {};
  const parts: string[] = [];
  if (e.fromStatus && e.toStatus) parts.push(`${TASK_STATUS_LABELS[e.fromStatus]} ← ${TASK_STATUS_LABELS[e.toStatus]}`);
  else if (e.toStatus) parts.push(TASK_STATUS_LABELS[e.toStatus]);
  if (Array.isArray(m.fields)) parts.push(`الحقول: ${m.fields.map((f) => FIELD_LABELS[String(f)] ?? String(f)).join('، ')}`);
  if (m.decision === 'APPROVED') parts.push('اعتماد');
  if (m.decision === 'CHANGES_REQUESTED') parts.push('طلب تعديلات');
  if (typeof m.round === 'number') parts.push(`الجولة ${m.round}`);
  if (typeof m.files === 'number') parts.push(`${m.files} ملف`);
  if (typeof m.reason === 'string') parts.push(REASONS[m.reason] ?? `السبب: ${m.reason}`);
  if (typeof m.predecessorTitle === 'string') parts.push(`تعتمد على: ${m.predecessorTitle}`);
  if (m.auto === true) parts.push('تلقائيًا');
  return parts.join(' • ');
}
</script>

<template>
  <PageHeader title="تفاصيل المهمة" :subtitle="t ? `${t.title} • ${t.project.name}` : ''">
    <RouterLink v-if="t?.parent" class="back" :to="taskRoute(t.parent.id)">→ المهمة الرئيسية</RouterLink>
    <RouterLink v-else class="back" :to="{ name: 'tasks' }">→ كل المهام</RouterLink>
  </PageHeader>

  <EmptyState v-if="notFound" title="المهمة غير موجودة" description="ربما حُذفت المهمة أو أنها ليست ضمن ما يحق لك رؤيته." icon="tasks" />
  <ErrorState v-else-if="task.error.value" :error="task.error.value" :retrying="task.loading.value" @retry="task.load" />
  <div v-else-if="!t" class="skel" aria-busy="true" aria-label="جارٍ تحميل المهمة">
    <SkeletonBlock height="145px" radius="12px" /><SkeletonBlock height="280px" radius="12px" />
  </div>

  <template v-else>
    <!-- Figma "Task Summary" -->
    <AppCard class="summary">
      <div class="summary__text">
        <h2 class="summary__title">{{ t.title }}</h2>
        <p class="summary__desc">{{ t.description || 'لا وصف لهذه المهمة.' }}</p>
      </div>
      <div class="summary__badges" aria-label="حالة المهمة">
        <StatusBadge v-bind="taskStatusBadge(t.status)" />
        <StatusBadge v-bind="priorityBadge(t.priority)" />
        <StatusBadge v-if="t.isOverdue" tone="warning" label="متأخرة" />
        <StatusBadge v-if="t.needsReview" tone="warning" label="تحتاج مراجعة" />
        <StatusBadge v-if="t.archivedAt" tone="neutral" label="مؤرشفة" />
      </div>
      <div class="summary__acts">
        <AppButton v-for="s in t.allowedNext" :key="s" size="sm" :variant="s === 'BLOCKED' ? 'secondary' : 'primary'" @click="askTransition(s)">{{ transitionLabel(s) }}</AppButton>
        <AppButton v-if="canEdit" size="sm" variant="secondary" icon="edit" @click="formMode = 'edit'">تعديل المهمة</AppButton>
        <AppButton v-else-if="canAssignOnly" size="sm" variant="secondary" icon="users" @click="formMode = 'assign'">الإسناد</AppButton>
        <AppButton v-if="t.needsReview && t.can.assign" size="sm" variant="secondary" icon="check" @click="askSimple('clearFlag')">مسح علامة المراجعة</AppButton>
        <AppButton v-if="t.can.archive" size="sm" variant="secondary" @click="askSimple('archive')">أرشفة</AppButton>
        <AppButton v-if="t.can.delete" size="sm" variant="danger" @click="askSimple('delete')">حذف</AppButton>
      </div>
      <p v-if="needsPeople" class="hint">لإسناد المهمة حدّد المكلّف والمراجع أولًا{{ canEdit ? ' (تعديل المهمة)' : canAssignOnly ? ' (الإسناد)' : '' }}.</p>
      <p v-if="t.can.start && t.blockedBy.length" class="hint warn">لا يمكن بدء التنفيذ قبل اعتماد: {{ t.blockedBy.map((b) => b.title).join('، ') }}.</p>
      <p v-if="closedProject" class="hint">المشروع مغلق: المهمة للقراءة فقط.</p>
    </AppCard>

    <div class="cols">
      <!-- Figma "بيانات المهمة" -->
      <AppCard>
        <h2 class="card-title">بيانات المهمة</h2>
        <dl class="kv">
          <div><dt>المشروع</dt><dd><RouterLink v-if="router.hasRoute('project-detail')" :to="{ name: 'project-detail', params: { id: t.project.id } }">{{ t.project.name }}</RouterLink><template v-else>{{ t.project.name }}</template></dd></div>
          <div v-if="t.parent"><dt>المهمة الرئيسية</dt><dd><RouterLink :to="taskRoute(t.parent.id)">{{ t.parent.title }}</RouterLink></dd></div>
          <div><dt>المسؤول</dt><dd>{{ t.assignedTo?.fullName ?? 'غير مسندة' }}</dd></div>
          <div><dt>المدير المختص</dt><dd>{{ t.assignedManager?.fullName ?? 'غير محدد' }}</dd></div>
          <div><dt>المراجع</dt><dd>{{ t.reviewer?.fullName ?? 'غير محدد' }}</dd></div>
          <div><dt>التخصص</dt><dd>{{ t.specialization?.name ?? 'غير محدد' }}</dd></div>
          <div><dt>الأولوية</dt><dd><StatusBadge :label="PRIORITY_LABELS[t.priority]" :tone="PRIORITY_TONE[t.priority]" /></dd></div>
          <div><dt>تاريخ التسليم</dt><dd :class="{ late: t.isOverdue }">{{ formatDate(t.dueDate) || 'غير محدد' }}</dd></div>
          <div v-if="isSubtask"><dt>الإلزامية</dt><dd>{{ t.isRequired ? 'إلزامية' : 'اختيارية' }}</dd></div>
          <div><dt>أنشأها</dt><dd>{{ t.createdBy.fullName }}</dd></div>
          <div><dt>آخر تحديث</dt><dd>{{ relativeTime(t.updatedAt) }}</dd></div>
        </dl>
      </AppCard>

      <!-- Figma "الاعتماديات والمرفقات" -->
      <AppCard>
        <div class="card-head">
          <h2 class="card-title">الاعتماديات</h2>
          <AppButton v-if="t.can.manageDependencies" size="sm" variant="secondary" icon="plus" @click="openDep">إضافة اعتمادية</AppButton>
        </div>
        <h3 class="sub-title">تعتمد على</h3>
        <p v-if="!t.predecessors.length" class="muted">لا تعتمد على مهام أخرى.</p>
        <ul v-else class="deps">
          <li v-for="d in t.predecessors" :key="d.id">
            <RouterLink :to="taskRoute(d.predecessor.id)">{{ d.predecessor.title }}</RouterLink>
            <StatusBadge v-bind="taskStatusBadge(d.predecessor.status)" />
            <AppButton v-if="t.can.manageDependencies" size="sm" variant="ghost" :aria-label="`حذف الاعتماد على ${d.predecessor.title}`" @click="askRemoveDep(d)">حذف</AppButton>
          </li>
        </ul>
        <h3 class="sub-title">تنتظرها</h3>
        <p v-if="!t.successors.length" class="muted">لا مهام تنتظر هذه المهمة.</p>
        <ul v-else class="deps">
          <li v-for="d in t.successors" :key="d.id">
            <RouterLink :to="taskRoute(d.successor.id)">{{ d.successor.title }}</RouterLink>
            <StatusBadge v-bind="taskStatusBadge(d.successor.status)" />
          </li>
        </ul>
        <p class="muted small">يبدأ العمل على المهمة بعد اعتماد كل المهام التي تعتمد عليها (إنهاء ثم قبول).</p>
      </AppCard>
    </div>

    <!-- Figma "Subtasks Management" -->
    <AppCard v-if="!isSubtask" :padded="false" class="block">
      <div class="block-head">
        <h2 class="card-title">المهام الفرعية</h2>
        <AppButton v-if="t.can.createSubtask" size="sm" icon="plus" @click="formMode = 'subtask'">مهمة فرعية جديدة</AppButton>
      </div>
      <EmptyState v-if="!t.subtasks.length" class="pad" title="لا مهام فرعية" :description="t.can.createSubtask ? 'قسّم العمل بين التخصصات بإضافة مهام فرعية.' : ''" icon="tasks" />
      <div v-else class="dt-wrap">
        <table class="dt">
          <caption class="sr-only">المهام الفرعية</caption>
          <thead><tr><th scope="col">المهمة الفرعية</th><th scope="col">الأولوية</th><th scope="col">الحالة</th><th scope="col">المكلَّف</th><th scope="col">الاستحقاق</th></tr></thead>
          <tbody>
            <tr v-for="s in t.subtasks" :key="s.id">
              <td class="dt-main">
                <RouterLink :to="taskRoute(s.id)" class="dt-title">{{ s.title }}</RouterLink>
                <span class="dt-sub">{{ s.isRequired ? 'إلزامية' : 'اختيارية' }}</span>
              </td>
              <td data-label="الأولوية"><StatusBadge :label="PRIORITY_LABELS[s.priority]" :tone="PRIORITY_TONE[s.priority]" /></td>
              <td data-label="الحالة"><div class="dt-badges"><StatusBadge v-bind="taskStatusBadge(s.status)" /><StatusBadge v-if="s.isOverdue" tone="warning" label="متأخرة" /></div></td>
              <td data-label="المكلَّف">{{ s.assignedTo?.fullName ?? 'غير مسندة' }}</td>
              <td data-label="الاستحقاق" class="dt-num">{{ formatDate(s.dueDate, true) || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>

    <!-- History -->
    <AppCard class="block">
      <h2 class="card-title">السجل</h2>
      <ErrorState v-if="events.error.value" :error="events.error.value" :retrying="events.loading.value" @retry="events.load" />
      <div v-else-if="!events.settled.value" class="skel"><SkeletonBlock v-for="i in 3" :key="i" height="40px" /></div>
      <p v-else-if="!history.length" class="muted">لا أحداث مسجّلة بعد.</p>
      <ol v-else class="timeline">
        <li v-for="e in history" :key="e.id">
          <p class="tl-head"><strong>{{ eventTypeLabel(e.type) }}</strong><span class="muted"> — {{ e.actor?.fullName ?? 'النظام' }}</span></p>
          <p v-if="eventDetail(e)" class="tl-detail">{{ eventDetail(e) }}</p>
          <time class="muted small" :datetime="e.createdAt" :title="formatDate(e.createdAt.slice(0, 10))">{{ relativeTime(e.createdAt) }}</time>
        </li>
      </ol>
    </AppCard>

    <TaskFormModal
      :open="formMode !== null"
      :task="formMode === 'edit' || formMode === 'assign' ? t : null"
      :project-id="t.projectId"
      :parent="formMode === 'subtask' ? { id: t.id, title: t.title } : null"
      :people-only="formMode === 'assign'"
      @close="formMode = null"
      @saved="onFormSaved"
    />

    <ConfirmDialog
      :open="!!target"
      :title="target ? `${transitionLabel(target)}؟` : ''"
      :confirm-label="target ? transitionLabel(target) : ''"
      :loading="busy"
      :error="actionError"
      @confirm="confirmTransition"
      @close="target = null"
    >
      <p v-if="target">{{ TRANSITION[target]?.impact }}</p>
      <TextAreaField v-if="target && TRANSITION[target]?.reason" v-model="reason" label="السبب" :maxlength="500" hint="اختياري، ويظهر في سجل المهمة." />
    </ConfirmDialog>

    <ConfirmDialog
      :open="!!simple"
      :title="simple ? SIMPLE[simple].title : ''"
      :confirm-label="simple ? SIMPLE[simple].label : ''"
      :tone="simple && SIMPLE[simple].danger ? 'danger' : 'primary'"
      :loading="busy"
      :error="actionError"
      @confirm="confirmSimple"
      @close="simple = null"
    >
      <p v-if="simple">{{ SIMPLE[simple].impact }}</p>
    </ConfirmDialog>

    <ConfirmDialog
      :open="!!depToRemove"
      title="حذف الاعتمادية؟"
      confirm-label="حذف الاعتمادية"
      tone="danger"
      :loading="busy"
      :error="actionError"
      @confirm="confirmRemoveDep"
      @close="depToRemove = null"
    >
      <p v-if="depToRemove">لن تنتظر هذه المهمة اعتماد «{{ depToRemove.predecessor.title }}» قبل بدء العمل.</p>
    </ConfirmDialog>

    <ConfirmDialog :open="depOpen" title="إضافة اعتمادية" confirm-label="إضافة" :loading="depSaving" :error="depError" @confirm="addDep" @close="depOpen = false">
      <p>اختر مهمة من المشروع نفسه يجب اعتمادها قبل بدء هذه المهمة. يرفض الخادم أي اعتمادية تُحدث دورة.</p>
      <ErrorState v-if="projectTasks.error.value" :error="projectTasks.error.value" :retrying="projectTasks.loading.value" @retry="projectTasks.load" />
      <SelectField v-else v-model="depPick" label="المهمة السابقة" required :options="depOptions" :disabled="!projectTasks.settled.value" />
    </ConfirmDialog>
  </template>
</template>

<style scoped>
.back { color: var(--emerald-ink); font-weight: 600; text-decoration: none; }
.back:hover { text-decoration: underline; }
.skel { display: grid; gap: var(--sp-3); }
.summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--sp-2) 14px; margin-block-end: 14px; }
.summary__title { color: var(--forest); font-size: 1.3125rem; font-weight: 700; overflow-wrap: anywhere; }
.summary__desc { color: var(--muted); font-size: 0.8125rem; margin-block-start: var(--sp-2); white-space: pre-line; overflow-wrap: anywhere; }
.summary__badges { display: flex; flex-wrap: wrap; gap: var(--sp-1); align-content: flex-start; justify-content: flex-end; max-inline-size: 280px; }
.summary__acts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.summary__acts:empty { display: none; }
.hint { grid-column: 1 / -1; color: var(--muted); font-size: var(--fs-sm); }
.hint.warn { color: var(--mango-ink); }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.card-title { color: var(--forest); font-size: 1rem; font-weight: 700; margin-block-end: var(--sp-3); }
.card-head, .block-head { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.card-head { margin-block-end: var(--sp-2); }
.card-head .card-title, .block-head .card-title { margin: 0; }
.block-head { padding: var(--sp-4) var(--sp-4) var(--sp-3); }
.sub-title { color: var(--ink); font-size: var(--fs-sm); font-weight: 700; margin-block: var(--sp-3) var(--sp-2); }
.kv { display: grid; gap: var(--sp-2); margin: 0; }
.kv div { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); border-block-end: 1px solid var(--row-line); padding-block-end: var(--sp-2); font-size: 0.8125rem; }
dt { color: var(--muted); }
dd { margin: 0; font-weight: 600; text-align: end; overflow-wrap: anywhere; }
.kv a, .deps a { color: var(--emerald-ink); font-weight: 600; }
.late { color: var(--mango-ink); }
.deps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); }
.deps li { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; font-size: 0.8125rem; }
.deps li a { flex: 1 1 auto; overflow-wrap: anywhere; }
.muted { color: var(--muted); font-size: 0.8125rem; }
.small { font-size: var(--fs-xs); }
p.small { margin-block-start: var(--sp-3); }
.block { margin-block-start: 14px; }
.pad { margin: var(--sp-4); }
.timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }
.timeline li { border-inline-start: 3px solid var(--line); padding-inline-start: var(--sp-3); }
.tl-head { font-size: 0.8125rem; }
.tl-detail { font-size: 0.8125rem; color: var(--ink); }
@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .summary { grid-template-columns: 1fr; } .summary__badges { justify-content: flex-start; max-inline-size: none; } }
</style>

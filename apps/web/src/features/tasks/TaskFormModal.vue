<script setup lang="ts">
/**
 * Create a main task / subtask, or edit one (Figma "Task Assignment": project, specialised manager,
 * assignee, reviewer, due date, priority). The lists only help the user pick valid people; the server
 * re-validates everything (company, active, roles, REVIEWER_NOT_ELIGIBLE, SPECIALIZATION_MISMATCH).
 * `peopleOnly` = the assigned specialised manager, who may change only the assignee and the reviewer.
 * On edit only changed fields are sent.
 */
import { computed, reactive, ref, watch } from 'vue';
import { isHttpError } from '@/api/http';
import { projectsApi, specializationsApi, tasksApi, usersApi } from '@/api/endpoints';
import { PRIORITIES, type CreateTaskInput, type Priority, type TaskDetail, type UpdateTaskInput, type UserDto } from '@/api/types';
import AppButton from '@/components/AppButton.vue';
import AppModal from '@/components/AppModal.vue';
import CheckboxField from '@/components/CheckboxField.vue';
import ErrorState from '@/components/ErrorState.vue';
import SelectField, { type SelectOption } from '@/components/SelectField.vue';
import TextAreaField from '@/components/TextAreaField.vue';
import TextField from '@/components/TextField.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { COMMON, ROLE_LABELS } from '@/i18n/ar';
import { PRIORITY_LABELS } from '@/features/work/labels';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Fixed project (project page / subtask). null = the user picks an open project. */
    projectId?: string | null;
    /** Create a subtask of this main task. */
    parent?: { id: string; title: string } | null;
    /** Edit this task (create when null). */
    task?: TaskDetail | null;
    peopleOnly?: boolean;
  }>(),
  { projectId: null, parent: null, task: null, peopleOnly: false },
);
const emit = defineEmits<{ close: []; saved: [task: TaskDetail] }>();

type Field = 'projectId' | 'title' | 'description' | 'priority' | 'dueDate' | 'specializationId' | 'assignedManagerId' | 'assignedToId' | 'reviewerId';
const blank = (): Record<Field, string> => ({ projectId: '', title: '', description: '', priority: 'MEDIUM', dueDate: '', specializationId: '', assignedManagerId: '', assignedToId: '', reviewerId: '' });
const form = reactive({ ...blank(), isRequired: true });
const errs = reactive<Record<Field, string>>({ ...blank(), priority: '' });
const submitting = ref(false);
const error = ref<unknown>(null);

const isEdit = computed(() => !!props.task);
const isSubtask = computed(() => !!props.parent || !!props.task?.parentTaskId);
const pickProject = computed(() => !isEdit.value && !props.projectId && !props.parent);
const title = computed(() => (isEdit.value ? (props.peopleOnly ? 'إسناد المهمة' : 'تعديل المهمة') : isSubtask.value ? 'مهمة فرعية جديدة' : 'مهمة جديدة'));

const people = useAsyncData(() => usersApi.list({ active: true, pageSize: 200 }));
const specs = useAsyncData(() => specializationsApi.list());
const projects = useAsyncData(() => projectsApi.list({ pageSize: 200, sort: 'name', order: 'asc' }));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const t = props.task;
    Object.assign(form, blank(), { isRequired: true });
    if (t) {
      Object.assign(form, {
        title: t.title, description: t.description ?? '', priority: t.priority, dueDate: t.dueDate ?? '', isRequired: t.isRequired,
        specializationId: t.specialization?.id ?? '', assignedManagerId: t.assignedManager?.id ?? '', assignedToId: t.assignedTo?.id ?? '', reviewerId: t.reviewer?.id ?? '',
      });
    }
    Object.assign(errs, blank(), { priority: '' });
    error.value = null;
    void people.load();
    if (!props.peopleOnly) void specs.load();
    if (pickProject.value) void projects.load();
  },
  { immediate: true },
);

const users = computed<UserDto[]>(() => people.data.value?.items ?? []);
const describe = (u: UserDto) => `${u.fullName} — ${u.specialization?.name ?? ROLE_LABELS[u.role]}`;
const none = (label: string): SelectOption => ({ value: '', label });
const managerOptions = computed(() => [none('بدون مدير مختص'), ...users.value.filter((u) => u.role === 'SPECIALIZED_MANAGER').map((u) => ({ value: u.id, label: describe(u) }))]);
// Same rule as the server: an assignee with a different specialisation is rejected (SPECIALIZATION_MISMATCH).
const assigneeOptions = computed(() => [
  none('غير مسندة بعد'),
  ...users.value
    .filter((u) => !form.specializationId || !u.specialization || u.specialization.id === form.specializationId || u.id === form.assignedToId)
    .map((u) => ({ value: u.id, label: describe(u) })),
]);
const reviewerOptions = computed(() => [
  none('بدون مراجع بعد'),
  ...users.value.filter((u) => u.role === 'SPECIALIZED_MANAGER' && u.id !== form.assignedToId).map((u) => ({ value: u.id, label: describe(u) })),
]);
const specOptions = computed(() => [none('بدون تخصص'), ...(specs.data.value?.items ?? []).map((s) => ({ value: s.id, label: s.name }))]);
const projectOptions = computed(() => [
  none('اختر المشروع'),
  ...(projects.data.value?.items ?? []).filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED').map((p) => ({ value: p.id, label: p.name })),
]);
const priorityOptions = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));
const loadError = computed(() => people.error.value || (!props.peopleOnly && specs.error.value) || (pickProject.value && projects.error.value) || null);
function reloadLists() {
  void people.load();
  if (!props.peopleOnly) void specs.load();
  if (pickProject.value) void projects.load();
}

function validate(): boolean {
  errs.projectId = pickProject.value && !form.projectId ? 'اختر المشروع الذي تتبع له المهمة.' : '';
  if (!props.peopleOnly) {
    const t = form.title.trim();
    errs.title = !t ? 'عنوان المهمة مطلوب.' : t.length > 200 ? 'العنوان أطول من 200 حرف.' : '';
    errs.description = form.description.length > 5000 ? 'الوصف أطول من 5000 حرف.' : '';
  }
  errs.reviewerId = form.reviewerId && form.reviewerId === form.assignedToId ? 'لا يراجع المكلّف عمله: اختر مراجعًا آخر.' : '';
  return !errs.projectId && !errs.title && !errs.description && !errs.reviewerId;
}

const idOrNull = (v: string) => v || null;

function buildPatch(t: TaskDetail): UpdateTaskInput {
  const patch: UpdateTaskInput = {};
  if (form.assignedToId !== (t.assignedTo?.id ?? '')) patch.assignedToId = idOrNull(form.assignedToId);
  if (form.reviewerId !== (t.reviewer?.id ?? '')) patch.reviewerId = idOrNull(form.reviewerId);
  if (props.peopleOnly) return patch;
  if (form.title.trim() !== t.title) patch.title = form.title.trim();
  if (form.description.trim() !== (t.description ?? '')) patch.description = form.description.trim();
  if (form.priority !== t.priority) patch.priority = form.priority as Priority;
  if (form.dueDate !== (t.dueDate ?? '')) patch.dueDate = form.dueDate || null;
  if (form.isRequired !== t.isRequired) patch.isRequired = form.isRequired;
  if (form.specializationId !== (t.specialization?.id ?? '')) patch.specializationId = idOrNull(form.specializationId);
  if (form.assignedManagerId !== (t.assignedManager?.id ?? '')) patch.assignedManagerId = idOrNull(form.assignedManagerId);
  return patch;
}

function buildCreate(): CreateTaskInput {
  const input: CreateTaskInput = { title: form.title.trim(), priority: form.priority as Priority };
  if (form.description.trim()) input.description = form.description.trim();
  if (form.dueDate) input.dueDate = form.dueDate;
  if (isSubtask.value) input.isRequired = form.isRequired;
  if (form.specializationId) input.specializationId = form.specializationId;
  if (form.assignedManagerId) input.assignedManagerId = form.assignedManagerId;
  if (form.assignedToId) input.assignedToId = form.assignedToId;
  if (form.reviewerId) input.reviewerId = form.reviewerId;
  return input;
}

async function submit() {
  if (!validate()) return;
  submitting.value = true;
  error.value = null;
  try {
    let saved: TaskDetail;
    if (props.task) {
      const patch = buildPatch(props.task);
      if (!Object.keys(patch).length) {
        emit('close');
        return;
      }
      saved = await tasksApi.update(props.task.id, patch);
    } else {
      const projectId = props.projectId || form.projectId;
      saved = props.parent ? await tasksApi.createSubtask(projectId, props.parent.id, buildCreate()) : await tasksApi.create(projectId, buildCreate());
    }
    emit('saved', saved);
  } catch (e) {
    if (isHttpError(e) && e.fields) {
      for (const k of Object.keys(errs) as Field[]) errs[k] = e.fields[k] ?? '';
    }
    error.value = e;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="title" :close-on-backdrop="false" width="620px" @close="!submitting && emit('close')">
    <form id="task-form" novalidate class="form" @submit.prevent="submit">
      <p v-if="parent" class="ctx">ضمن المهمة الرئيسية: <strong>{{ parent.title }}</strong></p>
      <p v-if="peopleOnly" class="ctx">بصفتك المدير المختص المعيَّن، تستطيع تحديد المكلّف والمراجع فقط.</p>
      <ErrorState v-if="loadError" :error="loadError" :retrying="people.loading.value" @retry="reloadLists" />

      <SelectField v-if="pickProject" v-model="form.projectId" label="المشروع" required :options="projectOptions" :error="errs.projectId" hint="تظهر المشاريع المفتوحة فقط." />
      <template v-if="!peopleOnly">
        <TextField v-model="form.title" label="عنوان المهمة" required :maxlength="200" :error="errs.title" />
        <TextAreaField v-model="form.description" label="الوصف" :maxlength="5000" :error="errs.description" hint="اختياري: المطلوب ومعايير القبول." />
        <div class="grid2">
          <SelectField v-model="form.priority" label="الأولوية" :options="priorityOptions" :error="errs.priority" />
          <TextField v-model="form.dueDate" type="date" ltr label="تاريخ الاستحقاق" :error="errs.dueDate" />
        </div>
        <div class="grid2">
          <SelectField v-model="form.specializationId" label="التخصص" :options="specOptions" :error="errs.specializationId" />
          <SelectField v-model="form.assignedManagerId" label="المدير المختص" :options="managerOptions" :error="errs.assignedManagerId" />
        </div>
      </template>
      <div class="grid2">
        <SelectField v-model="form.assignedToId" label="الموظف المكلّف" :options="assigneeOptions" :error="errs.assignedToId" :hint="form.specializationId ? 'تظهر الأسماء المطابقة لتخصص المهمة.' : ''" />
        <SelectField v-model="form.reviewerId" label="المراجع" :options="reviewerOptions" :error="errs.reviewerId" hint="مدير مختص غير المكلّف." />
      </div>
      <CheckboxField v-if="isSubtask && !peopleOnly" v-model="form.isRequired" label="مهمة إلزامية" hint="لا تُعتمد المهمة الرئيسية قبل اكتمال الفرعيات الإلزامية." />
      <p v-if="!isEdit" class="note">تُنشأ المهمة بحالة «مخططة»، ثم تُسند حين يُحدَّد المكلّف والمراجع.</p>
      <ErrorState v-if="error" :error="error" :retrying="submitting" @retry="submit" />
    </form>
    <template #footer>
      <AppButton variant="ghost" :disabled="submitting" @click="emit('close')">{{ COMMON.cancel }}</AppButton>
      <AppButton type="submit" form="task-form" :loading="submitting">{{ isEdit ? COMMON.save : 'إنشاء المهمة' }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.form { display: grid; gap: var(--sp-4); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.ctx { color: var(--forest); background: var(--emerald-tint, #e8f4ee); border-radius: 8px; padding: var(--sp-2) var(--sp-3); font-size: var(--fs-sm); }
.note { color: var(--muted); font-size: var(--fs-sm); }
@media (max-width: 560px) { .grid2 { grid-template-columns: 1fr; } }
</style>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { isHttpError } from '@/api/http';
import { projectsApi } from '@/api/endpoints';
import type { ProjectDto, UpdateProjectInput } from '@/api/types';
import AppButton from '@/components/AppButton.vue';
import AppModal from '@/components/AppModal.vue';
import ErrorState from '@/components/ErrorState.vue';
import TextAreaField from '@/components/TextAreaField.vue';
import TextField from '@/components/TextField.vue';
import { COMMON } from '@/i18n/ar';

/** Create or edit a project (name, description, start/due dates). Sends only what changed on edit. */
const props = defineProps<{ open: boolean; project: ProjectDto | null }>();
const emit = defineEmits<{ close: []; saved: [project: ProjectDto] }>();

const isEdit = computed(() => !!props.project);
const form = reactive({ name: '', description: '', startDate: '', dueDate: '' });
const errs = reactive({ name: '', description: '', startDate: '', dueDate: '' });
const submitting = ref(false);
const error = ref<unknown>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const p = props.project;
    Object.assign(form, { name: p?.name ?? '', description: p?.description ?? '', startDate: p?.startDate ?? '', dueDate: p?.dueDate ?? '' });
    Object.assign(errs, { name: '', description: '', startDate: '', dueDate: '' });
    error.value = null;
  },
  { immediate: true },
);

function validate(): boolean {
  errs.name = !form.name.trim() ? 'اسم المشروع مطلوب.' : form.name.trim().length > 150 ? 'الاسم أطول من 150 حرفًا.' : '';
  errs.dueDate = form.startDate && form.dueDate && form.dueDate < form.startDate ? 'تاريخ التسليم يجب ألا يسبق تاريخ البداية.' : '';
  return !errs.name && !errs.dueDate;
}

async function submit() {
  if (!validate()) return;
  submitting.value = true;
  error.value = null;
  try {
    let saved: ProjectDto;
    if (props.project) {
      const p = props.project;
      const patch: UpdateProjectInput = {};
      if (form.name.trim() !== p.name) patch.name = form.name.trim();
      if (form.description.trim() !== (p.description ?? '')) patch.description = form.description.trim();
      if ((form.startDate || null) !== p.startDate) patch.startDate = form.startDate || null;
      if ((form.dueDate || null) !== p.dueDate) patch.dueDate = form.dueDate || null;
      if (!Object.keys(patch).length) {
        emit('close');
        return;
      }
      saved = await projectsApi.update(p.id, patch);
    } else {
      saved = await projectsApi.create({
        name: form.name.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.startDate ? { startDate: form.startDate } : {}),
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      });
    }
    emit('saved', saved);
  } catch (e) {
    if (isHttpError(e) && e.fields) {
      errs.name = e.fields.name ?? '';
      errs.description = e.fields.description ?? '';
      errs.startDate = e.fields.startDate ?? '';
      errs.dueDate = e.fields.dueDate ?? '';
    }
    error.value = e;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="isEdit ? 'تعديل المشروع' : 'مشروع جديد'" :close-on-backdrop="false" width="560px" @close="!submitting && emit('close')">
    <form id="project-form" novalidate class="form" @submit.prevent="submit">
      <TextField v-model="form.name" label="اسم المشروع" required :maxlength="150" :error="errs.name" />
      <TextAreaField v-model="form.description" label="الوصف" :maxlength="2000" :error="errs.description" hint="اختياري: هدف المشروع ونطاقه." />
      <div class="dates">
        <TextField v-model="form.startDate" type="date" ltr label="تاريخ البداية" :error="errs.startDate" />
        <TextField v-model="form.dueDate" type="date" ltr label="تاريخ التسليم" :error="errs.dueDate" />
      </div>
      <ErrorState v-if="error" :error="error" :retrying="submitting" @retry="submit" />
    </form>
    <template #footer>
      <AppButton variant="ghost" :disabled="submitting" @click="emit('close')">{{ COMMON.cancel }}</AppButton>
      <AppButton type="submit" form="project-form" :loading="submitting">{{ isEdit ? COMMON.save : 'إنشاء المشروع' }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.form { display: grid; gap: var(--sp-4); }
.dates { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
@media (max-width: 480px) { .dates { grid-template-columns: 1fr; } }
</style>

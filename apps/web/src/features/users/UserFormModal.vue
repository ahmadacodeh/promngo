<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { isHttpError } from '@/api/http';
import { usersApi } from '@/api/endpoints';
import { MANAGER_ROLES, ROLES, type CreateUserInput, type Role, type SpecializationDto, type UpdateUserInput, type UserDto } from '@/api/types';
import AlertBanner from '@/components/AlertBanner.vue';
import AppButton from '@/components/AppButton.vue';
import AppModal from '@/components/AppModal.vue';
import CheckboxField from '@/components/CheckboxField.vue';
import ErrorState from '@/components/ErrorState.vue';
import SelectField from '@/components/SelectField.vue';
import TextField from '@/components/TextField.vue';
import { COMMON, ROLE_LABELS } from '@/i18n/ar';
import { USERS_COPY as C, ROLE_HINTS } from './copy';

export interface SavedUser {
  user: UserDto;
  /** only on creation: shown once to the executive manager */
  temporaryPassword?: string;
  /** false when the edit changed nothing (no request was made) */
  changed: boolean;
}

const props = defineProps<{
  open: boolean;
  mode: 'create' | 'edit';
  user: UserDto | null;
  specializations: readonly SpecializationDto[];
  /** the specialization list could not be loaded: the select is disabled and the current value is kept */
  specializationsFailed?: boolean;
  /** the signed-in user's id: they cannot change their own role from here */
  selfId: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [result: SavedUser] }>();

const form = reactive({ fullName: '', email: '', role: 'EMPLOYEE' as Role, specializationId: '', canCreateProjects: false });
const errs = reactive({ fullName: '', email: '', role: '', specializationId: '' });
const submitting = ref(false);
const error = ref<unknown>(null);

const isEdit = computed(() => props.mode === 'edit');
const isSelf = computed(() => isEdit.value && props.user !== null && props.user.id === props.selfId);
const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const specOptions = computed(() => {
  const opts = props.specializations.map((s) => ({ value: s.id, label: s.name }));
  const current = props.user?.specialization;
  // keep the user's current specialization selectable even if the list is still loading or failed
  if (isEdit.value && current && !opts.some((o) => o.value === current.id)) opts.push({ value: current.id, label: current.name });
  return [{ value: '', label: C.noSpecOption }, ...opts];
});
const showCanCreate = computed(() => MANAGER_ROLES.includes(form.role) || form.canCreateProjects);

watch(
  () => props.open,
  (o) => {
    if (!o) return;
    error.value = null;
    Object.assign(errs, { fullName: '', email: '', role: '', specializationId: '' });
    const u = props.user;
    Object.assign(form, isEdit.value && u
      ? { fullName: u.fullName, email: u.email, role: u.role, specializationId: u.specialization?.id ?? '', canCreateProjects: u.canCreateProjects }
      : { fullName: '', email: '', role: 'EMPLOYEE', specializationId: '', canCreateProjects: false });
  },
  { immediate: true },
);

watch(
  () => form.role,
  (r) => {
    // "can create projects" only means something for executive/project managers (contract §5).
    if (!MANAGER_ROLES.includes(r)) form.canCreateProjects = false;
  },
);

function validate(): boolean {
  const name = form.fullName.trim();
  const email = form.email.trim();
  errs.fullName = !name ? C.fullNameRequired : name.length > 150 ? C.fullNameTooLong : '';
  errs.email = isEdit.value ? '' : !email ? C.emailRequired : email.length > 255 ? C.emailTooLong : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? C.emailInvalid : '';
  return !errs.fullName && !errs.email;
}

function diff(u: UserDto): UpdateUserInput {
  const out: UpdateUserInput = {};
  const name = form.fullName.trim();
  if (name !== u.fullName) out.fullName = name;
  if (form.role !== u.role) out.role = form.role;
  if (form.canCreateProjects !== u.canCreateProjects) out.canCreateProjects = form.canCreateProjects;
  if (form.specializationId !== (u.specialization?.id ?? '')) out.specializationId = form.specializationId || null;
  return out;
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  error.value = null;
  if (!validate()) return;
  submitting.value = true;
  try {
    if (isEdit.value && props.user) {
      const changes = diff(props.user);
      if (Object.keys(changes).length === 0) {
        emit('saved', { user: props.user, changed: false }); // nothing to send: the API rejects empty updates
        return;
      }
      emit('saved', { user: await usersApi.update(props.user.id, changes), changed: true });
    } else {
      const input: CreateUserInput = { fullName: form.fullName.trim(), email: form.email.trim(), role: form.role, canCreateProjects: form.canCreateProjects };
      if (form.specializationId) input.specializationId = form.specializationId;
      const res = await usersApi.create(input);
      emit('saved', { user: res.user, temporaryPassword: res.temporaryPassword, changed: true });
    }
  } catch (e) {
    error.value = e;
    if (isHttpError(e) && e.fields) {
      errs.fullName = e.fields.fullName ?? '';
      errs.email = e.fields.email ?? '';
      errs.role = e.fields.role ?? '';
      errs.specializationId = e.fields.specializationId ?? '';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="isEdit ? C.editTitle : C.createTitle" :close-on-backdrop="false" width="560px" @close="!submitting && emit('close')">
    <form id="user-form" novalidate class="form" @submit.prevent="submit">
      <TextField v-model="form.fullName" :label="C.fullName" required autocomplete="off" :maxlength="150" :error="errs.fullName" />
      <TextField v-model="form.email" :label="C.email" type="email" ltr required autocomplete="off" :disabled="isEdit" :hint="isEdit ? C.emailHintEdit : ''" :maxlength="255" :error="errs.email" />
      <SelectField v-model="form.role" :label="C.role" :options="roleOptions" required :disabled="isSelf" :hint="isSelf ? C.roleSelf : ROLE_HINTS[form.role]" :error="errs.role" />
      <SelectField
        v-model="form.specializationId"
        :label="C.spec"
        :options="specOptions"
        :disabled="specializationsFailed"
        :hint="specializationsFailed ? C.specsFailed : C.specHint"
        :error="errs.specializationId"
      />
      <CheckboxField v-if="showCanCreate" v-model="form.canCreateProjects" :label="C.canCreate" :hint="C.canCreateHint" />
      <AlertBanner v-if="!isEdit" tone="info">{{ C.createNote }}</AlertBanner>
      <ErrorState v-if="error" :error="error" :retrying="submitting" @retry="submit" />
    </form>
    <template #footer>
      <AppButton variant="ghost" :disabled="submitting" @click="emit('close')">{{ COMMON.cancel }}</AppButton>
      <AppButton type="submit" form="user-form" :loading="submitting">{{ isEdit ? COMMON.save : C.createSubmit }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.form { display: grid; gap: var(--sp-4); }
</style>

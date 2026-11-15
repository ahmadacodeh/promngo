<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import AlertBanner from '@/components/AlertBanner.vue';
import AppButton from '@/components/AppButton.vue';
import ErrorState from '@/components/ErrorState.vue';
import TextField from '@/components/TextField.vue';
import { isHttpError } from '@/api/http';
import { useToast } from '@/composables/useToast';
import { useAuthStore } from '@/stores/auth';
import { AUTH_COPY as C } from './copy';
import { newPasswordProblem } from './passwordRules';

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();

const current = ref('');
const next = ref('');
const confirm = ref('');
const submitting = ref(false);
const error = ref<unknown>(null);
const errs = ref({ current: '', next: '', confirm: '' });

const forced = computed(() => auth.mustChangePassword);

function validate(): boolean {
  errs.value = {
    current: current.value ? '' : C.currentRequired,
    next: newPasswordProblem(next.value, current.value, auth.user?.email ?? ''),
    confirm: next.value && confirm.value !== next.value ? C.mismatch : '',
  };
  return !errs.value.current && !errs.value.next && !errs.value.confirm;
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  error.value = null;
  if (!validate()) return;
  submitting.value = true;
  try {
    await auth.changePassword(current.value, next.value);
    current.value = next.value = confirm.value = '';
    toast.success(C.changed);
    await router.replace({ name: 'dashboard' });
  } catch (e) {
    error.value = e;
    if (isHttpError(e) && e.fields) {
      errs.value = { current: e.fields.currentPassword ?? '', next: e.fields.newPassword ?? '', confirm: '' };
    }
  } finally {
    submitting.value = false;
  }
}

async function logout(): Promise<void> {
  await auth.logout();
  await router.replace({ name: 'login' });
}
</script>

<template>
  <div class="cp">
    <div>
      <h1>{{ C.changeTitle }}</h1>
      <p class="sub">{{ C.changeSubtitle }}</p>
    </div>
    <AlertBanner v-if="forced" tone="warning">{{ C.changeForced }}</AlertBanner>
    <ErrorState v-if="error" :error="error" :allow-retry="isHttpError(error) && error.isNetwork" :retrying="submitting" @retry="submit" />

    <form novalidate class="form" @submit.prevent="submit">
      <TextField v-model="current" :label="C.current" type="password" autocomplete="current-password" required :error="errs.current" />
      <TextField v-model="next" :label="C.newPassword" type="password" autocomplete="new-password" required :hint="C.policy" :error="errs.next" />
      <TextField v-model="confirm" :label="C.confirm" type="password" autocomplete="new-password" required :error="errs.confirm" />
      <AppButton type="submit" block :loading="submitting">{{ C.submitChange }}</AppButton>
      <AppButton v-if="forced" variant="ghost" block @click="logout">{{ C.logoutInstead }}</AppButton>
    </form>
  </div>
</template>

<style scoped>
.cp { display: grid; gap: var(--sp-4); }
.sub { color: var(--muted); margin-block-start: var(--sp-1); }
.form { display: grid; gap: var(--sp-4); }
</style>

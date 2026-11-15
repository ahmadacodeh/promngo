<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AlertBanner from '@/components/AlertBanner.vue';
import AppButton from '@/components/AppButton.vue';
import ErrorState from '@/components/ErrorState.vue';
import TextField from '@/components/TextField.vue';
import { isHttpError } from '@/api/http';
import { safeRedirect } from '@/router/redirect';
import { useAuthStore } from '@/stores/auth';
import { AUTH_COPY as C } from './copy';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const error = ref<unknown>(null);
const fieldErrors = ref<{ email: string; password: string }>({ email: '', password: '' });
const retryIn = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const expired = computed(() => route.query.reason === 'expired');
const blocked = computed(() => retryIn.value > 0);
const countdown = computed(() => {
  const m = Math.floor(retryIn.value / 60);
  const s = retryIn.value % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
});
const networkError = computed(() => isHttpError(error.value) && error.value.isNetwork);

function startCountdown(seconds: number): void {
  stopCountdown();
  retryIn.value = Math.max(1, Math.ceil(seconds));
  timer = setInterval(() => {
    retryIn.value -= 1;
    if (retryIn.value <= 0) {
      stopCountdown();
      error.value = null;
    }
  }, 1000);
}
function stopCountdown(): void {
  if (timer) clearInterval(timer);
  timer = null;
  retryIn.value = 0;
}
onBeforeUnmount(stopCountdown);

function validate(): boolean {
  const e = email.value.trim();
  fieldErrors.value = {
    email: !e ? C.emailRequired : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? C.emailInvalid : '',
    password: password.value ? '' : C.passwordRequired,
  };
  return !fieldErrors.value.email && !fieldErrors.value.password;
}

async function submit(): Promise<void> {
  if (submitting.value || blocked.value) return;
  error.value = null;
  if (!validate()) return;
  submitting.value = true;
  try {
    await auth.login(email.value, password.value);
    password.value = '';
    if (auth.mustChangePassword) await router.replace({ name: 'change-password' });
    else await router.replace(safeRedirect(route.query.redirect));
  } catch (e) {
    error.value = e;
    password.value = '';
    if (isHttpError(e)) {
      if (e.fields) fieldErrors.value = { email: e.fields.email ?? '', password: e.fields.password ?? '' };
      const wait = e.details?.retryAfterSeconds;
      if (e.code === 'TOO_MANY_ATTEMPTS' && typeof wait === 'number') startCountdown(wait);
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div>
      <h1>{{ C.loginTitle }}</h1>
      <p class="sub">{{ C.loginSubtitle }}</p>
    </div>

    <AlertBanner v-if="expired && !error" tone="warning">{{ C.expired }}</AlertBanner>
    <ErrorState v-if="error" :error="error" :allow-retry="networkError" :retrying="submitting" @retry="submit" />
    <p v-if="blocked" class="wait" role="timer" aria-live="off">{{ C.waitBefore }} <strong dir="ltr">{{ countdown }}</strong></p>

    <form novalidate class="form" @submit.prevent="submit">
      <TextField v-model="email" :label="C.email" type="email" autocomplete="username" ltr required :error="fieldErrors.email" />
      <TextField v-model="password" :label="C.password" type="password" autocomplete="current-password" required :error="fieldErrors.password" />
      <AppButton type="submit" block :loading="submitting" :disabled="blocked">{{ submitting ? C.submitting : C.submit }}</AppButton>
    </form>
  </div>
</template>

<style scoped>
.login { display: grid; gap: var(--sp-4); }
.sub { color: var(--muted); margin-block-start: var(--sp-1); }
.form { display: grid; gap: var(--sp-4); }
.wait { color: var(--mango-ink); font-weight: 500; }
</style>

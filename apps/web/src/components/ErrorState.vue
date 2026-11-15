<script setup lang="ts">
import { computed } from 'vue';
import AppButton from './AppButton.vue';
import AlertBanner from './AlertBanner.vue';
import { COMMON, describeError } from '@/i18n/ar';

/**
 * The standard failure block (user requirement): WHAT happened, WHY it likely happened, HOW to fix it,
 * and a retry button when retrying can plausibly help. Shows the request id for support.
 */
// allowRetry needs an explicit `undefined` default: Vue otherwise casts an absent optional Boolean prop to `false`,
// which would silently hide the retry button for every retryable error.
const props = withDefaults(
  defineProps<{ error: unknown; retrying?: boolean; /** override: show/hide the retry button (default: only for retryable errors) */ allowRetry?: boolean }>(),
  { retrying: false, allowRetry: undefined },
);
const emit = defineEmits<{ retry: [] }>();
const d = computed(() => describeError(props.error));
const showRetry = computed(() => props.allowRetry ?? d.value.retryable);
</script>

<template>
  <AlertBanner tone="danger" :title="d.what">
    <p><strong>السبب المحتمل:</strong> {{ d.why }}</p>
    <p><strong>كيف تعالجه:</strong> {{ d.fix }}</p>
    <p v-if="d.requestId" class="req">رقم الطلب للدعم: <code>{{ d.requestId }}</code></p>
    <div v-if="showRetry" class="actions">
      <AppButton variant="secondary" size="sm" icon="refresh" :loading="props.retrying" @click="emit('retry')">{{ COMMON.retry }}</AppButton>
    </div>
  </AlertBanner>
</template>

<style scoped>
p { color: inherit; }
.req { font-size: var(--fs-xs); opacity: 0.9; }
.actions { margin-block-start: var(--sp-2); }
</style>

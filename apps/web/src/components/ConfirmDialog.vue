<script setup lang="ts">
import AppButton from './AppButton.vue';
import AppModal from './AppModal.vue';
import ErrorState from './ErrorState.vue';
import { COMMON } from '@/i18n/ar';

/**
 * Confirmation for consequential actions: says what will happen (slot), asks explicitly, and shows the
 * standard what/why/how error block (with retry) if the action fails, without closing the dialog.
 */
withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmLabel: string;
    tone?: 'primary' | 'danger';
    loading?: boolean;
    error?: unknown;
  }>(),
  { tone: 'primary', loading: false },
);
const emit = defineEmits<{ confirm: []; close: [] }>();
</script>

<template>
  <AppModal :open="open" :title="title" width="480px" @close="!loading && emit('close')">
    <div class="body">
      <slot />
      <ErrorState v-if="error" :error="error" :retrying="loading" @retry="emit('confirm')" />
    </div>
    <template #footer>
      <AppButton variant="ghost" :disabled="loading" @click="emit('close')">{{ COMMON.cancel }}</AppButton>
      <AppButton :variant="tone === 'danger' ? 'danger' : 'primary'" :loading="loading" @click="emit('confirm')">{{ confirmLabel }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.body { display: grid; gap: var(--sp-3); }
.body :deep(p) { color: var(--ink); }
</style>

<script setup lang="ts">
import { ref, watch } from 'vue';
import AlertBanner from '@/components/AlertBanner.vue';
import AppButton from '@/components/AppButton.vue';
import AppModal from '@/components/AppModal.vue';
import { useToast } from '@/composables/useToast';
import { USERS_COPY as C } from './copy';

/**
 * Shows a temporary password ONCE. The password lives only in the parent's local state while this dialog is open;
 * it is never written to storage, the URL or the store, and the parent drops it on close.
 */
const props = defineProps<{ open: boolean; kind: 'created' | 'reset'; fullName: string; email: string; password: string }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToast();
const copyFailed = ref(false);
const pw = ref<HTMLElement | null>(null);

watch(
  () => props.open,
  (o) => {
    if (o) copyFailed.value = false;
  },
);

async function copy(): Promise<void> {
  copyFailed.value = false;
  try {
    await navigator.clipboard.writeText(props.password);
    toast.success(C.pwCopied);
  } catch {
    copyFailed.value = true;
    // Select the text so the user can press Ctrl/Cmd+C.
    const el = pw.value;
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }
}
</script>

<template>
  <AppModal :open="open" :title="kind === 'created' ? C.pwCreatedTitle : C.pwResetTitle" :close-on-backdrop="false" width="520px" @close="emit('close')">
    <div class="body">
      <p class="who">{{ C.pwFor(fullName, email) }}</p>
      <AlertBanner tone="warning">{{ C.pwWarning }}</AlertBanner>
      <p v-if="kind === 'reset'" class="note">{{ C.pwSessionsRevoked }}</p>
      <div class="pw">
        <span class="pw__label">{{ C.pwLabel }}</span>
        <code ref="pw" class="pw__value" dir="ltr" data-testid="temp-password">{{ password }}</code>
      </div>
      <AlertBanner v-if="copyFailed" tone="info">{{ C.pwCopyFailed }}</AlertBanner>
      <AppButton variant="secondary" icon="copy" @click="copy">{{ C.pwCopy }}</AppButton>
    </div>
    <template #footer>
      <AppButton @click="emit('close')">{{ C.pwDone }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.body { display: grid; gap: var(--sp-3); }
.who { color: var(--muted); }
.note { color: var(--muted); font-size: var(--fs-sm); }
.pw { display: grid; gap: var(--sp-1); }
.pw__label { font-weight: 700; font-size: var(--fs-sm); color: var(--forest); }
.pw__value {
  display: block;
  padding: var(--sp-3) var(--sp-4);
  background: var(--canvas);
  border: 1px dashed var(--emerald);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--fs-lg);
  letter-spacing: 0.04em;
  text-align: start;
  user-select: all;
  overflow-wrap: anywhere;
}
</style>

<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import { COMMON } from '@/i18n/ar';
import { useToast } from '@/composables/useToast';

const { toasts, dismiss } = useToast();
</script>

<template>
  <div class="toasts" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.kind}`" :role="t.kind === 'error' ? 'alert' : 'status'">
        <AppIcon :name="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'" :size="20" />
        <div class="toast__body">
          <strong>{{ t.message }}</strong>
          <span v-if="t.detail">{{ t.detail }}</span>
          <button v-if="t.action" type="button" class="toast__action" @click="t.action.run(); dismiss(t.id)">{{ t.action.label }}</button>
        </div>
        <button type="button" class="toast__close" :aria-label="COMMON.close" @click="dismiss(t.id)"><AppIcon name="x" :size="16" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts { position: fixed; inset-block-end: var(--sp-5); inset-inline-start: var(--sp-5); z-index: var(--z-toast); display: grid; gap: var(--sp-2); inline-size: min(380px, calc(100vw - 2 * var(--sp-5))); }
.toast { display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-3) var(--sp-4); border-radius: var(--radius-md); background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-pop); border-inline-start-width: 4px; }
.toast--success { border-inline-start-color: var(--emerald); color: var(--emerald-ink); }
.toast--error { border-inline-start-color: var(--red); color: var(--red-ink); }
.toast--info { border-inline-start-color: var(--blue); color: var(--blue-ink); }
.toast__body { display: grid; gap: 2px; flex: 1; min-inline-size: 0; font-size: var(--fs-sm); color: var(--ink); }
.toast__body strong { color: inherit; }
.toast__action { justify-self: start; background: none; border: 0; padding: 0; color: var(--emerald-ink); font-weight: 700; text-decoration: underline; }
.toast__close { background: none; border: 0; color: var(--muted); border-radius: var(--radius-sm); padding: 2px; }
.toast-enter-active, .toast-leave-active { transition: opacity var(--dur-base) ease, transform var(--dur-base) var(--ease); }
.toast-enter-from { opacity: 0; transform: translateY(var(--rise)); }
.toast-leave-to { opacity: 0; transform: translateX(-12px); }
</style>

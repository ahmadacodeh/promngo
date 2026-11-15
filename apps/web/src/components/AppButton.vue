<script setup lang="ts">
import AppIcon, { type IconName } from './AppIcon.vue';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'md' | 'sm';
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
    disabled?: boolean;
    icon?: IconName;
    block?: boolean;
  }>(),
  { variant: 'primary', size: 'md', type: 'button', loading: false, disabled: false, block: false },
);
</script>

<template>
  <button
    :type="props.type"
    class="btn"
    :class="[`btn--${props.variant}`, `btn--${props.size}`, { 'btn--block': props.block, 'is-loading': props.loading }]"
    :disabled="props.disabled || props.loading"
    :aria-busy="props.loading || undefined"
  >
    <span v-if="props.loading" class="btn__spinner" aria-hidden="true" />
    <AppIcon v-else-if="props.icon" :name="props.icon" :size="18" />
    <span class="btn__label"><slot /></span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-block-size: 44px; /* touch target */
  padding-inline: var(--sp-5);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-weight: 700;
  font-size: var(--fs-md);
  line-height: 1.2;
  transition: background var(--dur-fast) ease, border-color var(--dur-fast) ease, transform var(--dur-fast) ease, box-shadow var(--dur-fast) ease;
}
.btn--sm { min-block-size: 36px; padding-inline: var(--sp-4); font-size: var(--fs-sm); }
.btn--block { inline-size: 100%; }
.btn--primary { background: var(--emerald); color: #fff; }
.btn--primary:hover:not(:disabled) { background: var(--emerald-hover); }
.btn--secondary { background: var(--surface); color: var(--forest); border-color: var(--line); }
.btn--secondary:hover:not(:disabled) { background: var(--emerald-soft); border-color: var(--emerald); }
.btn--ghost { background: transparent; color: var(--emerald-ink); }
.btn--ghost:hover:not(:disabled) { background: var(--emerald-soft); }
.btn--danger { background: var(--red-ink); color: #fff; }
.btn--danger:hover:not(:disabled) { background: #8a322b; }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.is-loading { cursor: progress; }
.btn__spinner {
  inline-size: 16px;
  block-size: 16px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-inline-end-color: transparent;
  animation: spin 700ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>

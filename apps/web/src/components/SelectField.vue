<script setup lang="ts">
import { computed, useId } from 'vue';
import AppIcon from './AppIcon.vue';

export interface SelectOption {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    options: readonly SelectOption[];
    error?: string;
    hint?: string;
    required?: boolean;
    disabled?: boolean;
    /** hide the visible label (filters in a toolbar) while keeping it for screen readers */
    labelHidden?: boolean;
  }>(),
  { error: '', hint: '', required: false, disabled: false, labelHidden: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const id = useId();
// The hint is not rendered while an error is shown, so it must not be referenced then (dangling id).
const describedBy = computed(() => (props.error ? `${id}-err` : props.hint ? `${id}-hint` : undefined));
</script>

<template>
  <div class="field" :class="{ 'has-error': !!props.error }">
    <label :for="id" class="field__label" :class="{ 'sr-only': props.labelHidden }">
      {{ props.label }}<span v-if="props.required" class="field__req" aria-hidden="true"> *</span>
    </label>
    <select
      :id="id"
      class="field__select"
      :value="props.modelValue"
      :required="props.required"
      :disabled="props.disabled"
      :aria-invalid="props.error ? 'true' : undefined"
      :aria-describedby="describedBy"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="o in props.options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <p v-if="props.hint && !props.error" :id="`${id}-hint`" class="field__hint">{{ props.hint }}</p>
    <p v-if="props.error" :id="`${id}-err`" class="field__error" role="alert">
      <AppIcon name="alert" :size="16" /> {{ props.error }}
    </p>
  </div>
</template>

<style scoped>
.field { display: grid; gap: var(--sp-1); }
.field__label { font-weight: 700; font-size: var(--fs-sm); color: var(--forest); }
.field__req { color: var(--red-ink); }
.field__select {
  inline-size: 100%;
  min-block-size: 46px;
  padding-inline: var(--sp-4);
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  transition: border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease;
}
.field__select:hover:not(:disabled) { border-color: #b8c8bf; }
.field__select:focus-visible { border-color: var(--emerald); box-shadow: var(--shadow-focus); outline: none; }
.field__select:disabled { background: var(--canvas); color: var(--muted); cursor: not-allowed; }
.has-error .field__select { border-color: var(--red); }
.field__hint { font-size: var(--fs-xs); color: var(--muted); }
.field__error { display: flex; gap: var(--sp-1); align-items: center; font-size: var(--fs-sm); color: var(--red-ink); font-weight: 500; }
</style>

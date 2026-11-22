<script setup lang="ts">
import { computed, useId } from 'vue';

/** Multi-line field with the same label/hint/error contract as TextField (aria-describedby never dangles). */
const props = withDefaults(
  defineProps<{ modelValue: string; label: string; error?: string; hint?: string; required?: boolean; disabled?: boolean; rows?: number; maxlength?: number }>(),
  { error: '', hint: '', required: false, disabled: false, rows: 4 },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const id = useId();
const describedBy = computed(() => (props.error ? `${id}-err` : props.hint ? `${id}-hint` : undefined));
const count = computed(() => props.modelValue.length);
</script>

<template>
  <div class="field">
    <label :for="id" class="field__label">{{ label }}<span v-if="required" aria-hidden="true" class="req"> *</span></label>
    <textarea
      :id="id"
      class="field__input"
      :value="modelValue"
      :rows="rows"
      :required="required"
      :disabled="disabled"
      :maxlength="maxlength"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <p v-if="error" :id="`${id}-err`" role="alert" class="field__error">{{ error }}</p>
    <p v-else-if="hint" :id="`${id}-hint`" class="field__hint">{{ hint }}</p>
    <p v-if="maxlength" class="field__count" aria-hidden="true">{{ count }} / {{ maxlength }}</p>
  </div>
</template>

<style scoped>
.field { display: grid; gap: var(--sp-1); }
.field__label { font-weight: 600; font-size: var(--fs-sm); color: var(--ink); }
.req { color: var(--red-ink); }
.field__input { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-3); resize: vertical; min-block-size: 88px; }
.field__input:focus-visible { outline: none; border-color: var(--emerald); box-shadow: var(--shadow-focus); }
.field__input[aria-invalid='true'] { border-color: var(--red); }
.field__input:disabled { background: #f1f4f2; color: var(--muted); }
.field__error { color: var(--red-ink); font-size: var(--fs-xs); }
.field__hint, .field__count { color: var(--muted); font-size: var(--fs-xs); }
.field__count { text-align: end; }
</style>

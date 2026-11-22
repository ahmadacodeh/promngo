<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import AppIcon from './AppIcon.vue';
import { COMMON } from '@/i18n/ar';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    type?: 'text' | 'email' | 'password' | 'search';
    error?: string;
    hint?: string;
    autocomplete?: string;
    required?: boolean;
    disabled?: boolean;
    placeholder?: string;
    /** emails/identifiers are typed LTR even inside an RTL page */
    ltr?: boolean;
    maxlength?: number;
  }>(),
  { type: 'text', error: '', hint: '', autocomplete: 'off', required: false, disabled: false, placeholder: '', ltr: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const id = useId();
const revealed = ref(false);
const isPassword = computed(() => props.type === 'password');
const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type));
// The hint is not rendered while an error is shown, so it must not be referenced then (dangling id).
const describedBy = computed(() => (props.error ? `${id}-err` : props.hint ? `${id}-hint` : undefined));
</script>

<template>
  <div class="field" :class="{ 'has-error': !!props.error }">
    <label :for="id" class="field__label">
      {{ props.label }}<span v-if="props.required" class="field__req" aria-hidden="true"> *</span>
    </label>
    <div class="field__control">
      <input
        :id="id"
        class="field__input"
        :class="{ 'is-ltr': props.ltr || isPassword }"
        :type="inputType"
        :value="props.modelValue"
        :autocomplete="props.autocomplete"
        :required="props.required"
        :disabled="props.disabled"
        :placeholder="props.placeholder"
        :maxlength="props.maxlength"
        :aria-invalid="props.error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <button
        v-if="isPassword"
        type="button"
        class="field__toggle"
        :aria-label="revealed ? COMMON.hidePassword : COMMON.showPassword"
        :aria-pressed="revealed"
        @click="revealed = !revealed"
      >
        <AppIcon :name="revealed ? 'eye-off' : 'eye'" :size="18" />
      </button>
    </div>
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
.field__control { position: relative; display: flex; }
.field__input {
  inline-size: 100%;
  min-block-size: 46px;
  padding-inline: var(--sp-4);
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  transition: border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease;
}
.field__input.is-ltr { direction: ltr; text-align: start; }
.field__input::placeholder { color: var(--muted); opacity: 0.8; }
.field__input:hover:not(:disabled) { border-color: #b8c8bf; }
.field__input:focus-visible { border-color: var(--emerald); box-shadow: var(--shadow-focus); outline: none; }
.field__input:disabled { background: var(--canvas); color: var(--muted); cursor: not-allowed; }
.has-error .field__input { border-color: var(--red); }
.field__toggle {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  inline-size: 44px;
  display: grid;
  place-items: center;
  background: none;
  border: 0;
  color: var(--muted);
  border-radius: var(--radius-md);
}
.field__toggle:hover { color: var(--forest); }
.field:has(.field__toggle) .field__input { padding-inline-end: 46px; }
.field__hint { font-size: var(--fs-xs); color: var(--muted); }
.field__error { display: flex; gap: var(--sp-1); align-items: center; font-size: var(--fs-sm); color: var(--red-ink); font-weight: 500; }
</style>

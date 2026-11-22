<script setup lang="ts">
import { computed, useId } from 'vue';

const props = withDefaults(defineProps<{ modelValue: boolean; label: string; hint?: string; disabled?: boolean }>(), { hint: '', disabled: false });
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const id = useId();
const describedBy = computed(() => (props.hint ? `${id}-hint` : undefined));
</script>

<template>
  <div class="check">
    <input :id="id" type="checkbox" class="check__box" :checked="props.modelValue" :disabled="props.disabled" :aria-describedby="describedBy" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
    <div class="check__text">
      <label :for="id" class="check__label">{{ props.label }}</label>
      <p v-if="props.hint" :id="`${id}-hint`" class="check__hint">{{ props.hint }}</p>
    </div>
  </div>
</template>

<style scoped>
.check { display: flex; gap: var(--sp-3); align-items: flex-start; }
.check__box { inline-size: 20px; block-size: 20px; margin-block-start: 2px; accent-color: var(--emerald); flex: none; }
.check__box:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
.check__label { font-weight: 700; font-size: var(--fs-sm); color: var(--forest); }
.check__hint { font-size: var(--fs-xs); color: var(--muted); }
</style>

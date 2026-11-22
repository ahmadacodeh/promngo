<script setup lang="ts">
import { computed } from 'vue';
import AppButton from './AppButton.vue';
import { COMMON } from '@/i18n/ar';

const props = defineProps<{ page: number; pageSize: number; total: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:page': [page: number] }>();

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.page * props.pageSize, props.total));
</script>

<template>
  <nav v-if="props.total > 0" class="pager" aria-label="تنقّل بين الصفحات">
    <p class="pager__info" aria-live="polite">عرض {{ from }}–{{ to }} من {{ props.total }}</p>
    <div v-if="pages > 1" class="pager__btns">
      <AppButton variant="secondary" size="sm" :disabled="props.disabled || props.page <= 1" @click="emit('update:page', props.page - 1)">{{ COMMON.previous }}</AppButton>
      <span class="pager__page">صفحة {{ props.page }} من {{ pages }}</span>
      <AppButton variant="secondary" size="sm" :disabled="props.disabled || props.page >= pages" @click="emit('update:page', props.page + 1)">{{ COMMON.next }}</AppButton>
    </div>
  </nav>
</template>

<style scoped>
.pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sp-3); padding-block-start: var(--sp-4); }
.pager__info { color: var(--muted); font-size: var(--fs-sm); }
.pager__btns { display: flex; align-items: center; gap: var(--sp-3); }
.pager__page { font-size: var(--fs-sm); color: var(--forest); font-weight: 700; }
</style>

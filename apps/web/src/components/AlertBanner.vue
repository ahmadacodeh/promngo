<script setup lang="ts">
import AppIcon from './AppIcon.vue';
withDefaults(defineProps<{ tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string }>(), { tone: 'info' });
</script>

<template>
  <div class="alert" :class="`alert--${tone}`" :role="tone === 'danger' ? 'alert' : 'status'">
    <AppIcon :name="tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'" :size="20" />
    <div class="alert__body">
      <strong v-if="title" class="alert__title">{{ title }}</strong>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.alert { display: flex; gap: var(--sp-3); padding: var(--sp-4); border-radius: var(--radius-md); border: 1px solid; }
.alert__body { display: grid; gap: var(--sp-1); min-inline-size: 0; font-size: var(--fs-sm); line-height: 1.6; }
.alert__title { font-size: var(--fs-md); }
.alert--info { background: var(--blue-soft); border-color: #c9d9ea; color: var(--blue-ink); }
.alert--warning { background: var(--mango-soft); border-color: #f3d3a8; color: var(--mango-ink); }
.alert--danger { background: var(--red-soft); border-color: #efc5c0; color: var(--red-ink); }
.alert--success { background: var(--mint); border-color: #b9e0cb; color: var(--emerald-ink); }
</style>

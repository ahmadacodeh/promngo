<script setup lang="ts">
withDefaults(defineProps<{ as?: string; padded?: boolean }>(), { as: 'section', padded: true });
</script>

<template>
  <component :is="as" class="card" :class="{ 'card--padded': padded }"><slot /></component>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.card--padded { padding: var(--sp-5); }
</style>

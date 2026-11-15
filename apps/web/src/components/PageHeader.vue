<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <header class="ph">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="ph__sub">{{ subtitle }}</p>
    </div>
    <div class="ph__actions"><slot /></div>
  </header>
</template>

<style scoped>
.ph { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); margin-block-end: var(--sp-5); }
.ph__sub { color: var(--muted); margin-block-start: var(--sp-1); }
.ph__actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
</style>

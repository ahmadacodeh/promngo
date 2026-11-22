<script setup lang="ts">
/** KPI card (Figma "Statistic"): label, then the number emphasised, then an optional hint line. */
withDefaults(defineProps<{ label: string; value: string | number; hint?: string; tone?: 'positive' | 'attention' | 'muted' }>(), { tone: 'positive', hint: '' });
</script>

<template>
  <div class="stat">
    <p class="stat__label">{{ label }}</p>
    <p class="stat__value">{{ value }}</p>
    <p v-if="hint" class="stat__hint" :class="`stat__hint--${tone}`">{{ hint }}</p>
  </div>
</template>

<style scoped>
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 14px; display: grid; gap: 6px; align-content: start; min-height: 112px; }
.stat__label { color: var(--muted); font-size: 0.8125rem; font-weight: 500; }
.stat__value { color: var(--forest); font-size: 1.6875rem; font-weight: 700; line-height: 1.3; font-variant-numeric: tabular-nums; }
.stat__hint { font-size: var(--fs-xs); font-weight: 500; }
.stat__hint--positive { color: var(--emerald-ink); }
.stat__hint--attention { color: var(--mango-ink); }
.stat__hint--muted { color: var(--muted); }
</style>

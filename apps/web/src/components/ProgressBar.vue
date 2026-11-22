<script setup lang="ts">
/** Accessible progress bar (Figma "Progress": 10px track #e3eae6, emerald fill). */
const props = defineProps<{ value: number; label: string }>();
const clamped = (): number => Math.min(100, Math.max(0, Math.round(props.value)));
</script>

<template>
  <div class="pb">
    <div class="pb__head"><span class="pb__label">{{ label }}</span><span class="pb__val">{{ clamped() }}%</span></div>
    <div class="pb__track" role="progressbar" :aria-label="label" :aria-valuenow="clamped()" aria-valuemin="0" aria-valuemax="100">
      <div class="pb__fill" :style="{ inlineSize: `${clamped()}%` }" />
    </div>
  </div>
</template>

<style scoped>
.pb { display: grid; gap: 6px; }
.pb__head { display: flex; justify-content: space-between; gap: var(--sp-2); font-size: 0.8125rem; font-weight: 500; color: var(--ink); }
.pb__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb__val { font-variant-numeric: tabular-nums; flex: none; }
.pb__track { block-size: 10px; background: #e3eae6; border-radius: var(--radius-pill); overflow: hidden; }
.pb__fill { block-size: 100%; background: var(--emerald); border-radius: var(--radius-pill); transition: inline-size var(--dur-base) var(--ease); }
@media (prefers-reduced-motion: reduce) { .pb__fill { transition: none; } }
</style>

<script setup lang="ts">
import AppIcon, { type IconName } from './AppIcon.vue';

/** Status is never conveyed by colour alone: every badge carries an icon AND a text label. */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const ICONS: Record<Tone, IconName> = { success: 'check', warning: 'alert', danger: 'x', info: 'info', neutral: 'clock' };

withDefaults(defineProps<{ tone?: Tone; label: string }>(), { tone: 'neutral' });
defineExpose({ ICONS });
</script>

<template>
  <span class="badge" :class="`badge--${tone}`">
    <AppIcon :name="ICONS[tone]" :size="14" />
    {{ label }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 2px var(--sp-3);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: 700;
  white-space: nowrap;
}
.badge--success { background: var(--mint); color: var(--emerald-ink); }
.badge--warning { background: var(--mango-soft); color: var(--mango-ink); }
.badge--danger { background: var(--red-soft); color: var(--red-ink); }
.badge--info { background: var(--blue-soft); color: var(--blue-ink); }
.badge--neutral { background: #eef2ef; color: #46564f; }
</style>

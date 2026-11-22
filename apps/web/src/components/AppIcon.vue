<script setup lang="ts">
/** Minimal inline icon set (stroke icons, 24px grid). Decorative by default (aria-hidden). */
const PATHS = {
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v5M12 16.5v.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5v.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z',
  users: 'M16 19v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM20 19v-1a4 4 0 00-3-3.9M15 4.2a3.5 3.5 0 010 6.6',
  building: 'M5 21V5a1 1 0 011-1h8a1 1 0 011 1v16M15 9h3a1 1 0 011 1v11M3 21h18M9 8h2M9 12h2M9 16h2',
  logout: 'M9 4H6a2 2 0 00-2 2v12a2 2 0 002 2h3M16 8l4 4-4 4M20 12H9',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  'eye-off': 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6zM4 4l16 16',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  folder: 'M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
} as const;
export type IconName = keyof typeof PATHS;

withDefaults(defineProps<{ name: IconName; size?: number; label?: string }>(), { size: 20, label: '' });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
    class="icon"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>

<style scoped>
.icon { flex: none; }
</style>

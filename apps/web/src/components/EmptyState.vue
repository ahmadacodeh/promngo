<script setup lang="ts">
import AppIcon, { type IconName } from './AppIcon.vue';
withDefaults(defineProps<{ title: string; description?: string; icon?: IconName }>(), { icon: 'info' });
</script>

<template>
  <div class="empty">
    <span class="empty__icon"><AppIcon :name="icon" :size="28" /></span>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <div class="empty__actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty { display: grid; justify-items: center; gap: var(--sp-2); padding: var(--sp-7) var(--sp-5); text-align: center; }
.empty__icon { display: grid; place-items: center; inline-size: 56px; block-size: 56px; border-radius: 50%; background: var(--mint); color: var(--emerald-ink); }
.empty p { max-inline-size: 46ch; color: var(--muted); }
.empty__actions { margin-block-start: var(--sp-3); }
</style>

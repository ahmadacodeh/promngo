<script setup lang="ts">
withDefaults(defineProps<{ width?: string; height?: string; radius?: string }>(), { width: '100%', height: '16px', radius: '8px' });
</script>

<template>
  <span class="sk" :style="{ inlineSize: width, blockSize: height, borderRadius: radius }" aria-hidden="true" />
</template>

<style scoped>
.sk {
  display: block;
  background: linear-gradient(90deg, #e8eee9 25%, #f3f6f4 50%, #e8eee9 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AuthLayout from '@/layouts/AuthLayout.vue';
import AppShell from '@/layouts/AppShell.vue';
import ToastHost from '@/components/ToastHost.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const auth = useAuthStore();
const layout = computed(() => (route.meta.layout === 'auth' ? AuthLayout : AppShell));
</script>

<template>
  <div v-if="auth.status === 'unknown'" class="boot" role="status" aria-label="جارٍ التحميل">
    <SkeletonBlock width="160px" height="24px" />
  </div>
  <component :is="layout" v-else>
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </component>
  <ToastHost />
</template>

<style scoped>
.boot { min-block-size: 100vh; display: grid; place-items: center; }
</style>

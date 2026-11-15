<script setup lang="ts">
import { RouterLink } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';
</script>

<template>
  <EmptyState icon="lock" title="لا تملك صلاحية هذه الصفحة" description="دورك الحالي لا يتيح فتحها. إن كنت تحتاجها فاطلب من المدير التنفيذي تعديل دورك.">
    <RouterLink :to="{ name: 'dashboard' }">العودة إلى لوحة التحكم</RouterLink>
  </EmptyState>
</template>

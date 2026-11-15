<script setup lang="ts">
import { RouterLink } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';
</script>

<template>
  <EmptyState icon="search" title="الصفحة غير موجودة" description="الرابط الذي فتحته غير صحيح أو لم يعد متاحًا. تأكد من العنوان أو عد إلى لوحة التحكم.">
    <RouterLink :to="{ name: 'dashboard' }">العودة إلى لوحة التحكم</RouterLink>
  </EmptyState>
</template>

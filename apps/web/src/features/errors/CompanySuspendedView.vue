<script setup lang="ts">
import { useRouter } from 'vue-router';
import AlertBanner from '@/components/AlertBanner.vue';
import AppButton from '@/components/AppButton.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
async function logout(): Promise<void> {
  await auth.logout();
  await router.replace({ name: 'login' });
}
</script>

<template>
  <div class="s">
    <h1>الشركة غير نشطة</h1>
    <AlertBanner tone="warning" :title="`حساب «${auth.company?.name ?? ''}» متوقف حاليًا.`">
      <p><strong>السبب المحتمل:</strong> أوقف مسؤول المنصة الشركة أو أُرشفت.</p>
      <p><strong>كيف تعالجه:</strong> تواصل مع مسؤول شركتك أو مع دعم PROMANGO لإعادة التفعيل. لن تتمكن من استخدام المنصة حتى ذلك الحين.</p>
    </AlertBanner>
    <AppButton variant="secondary" block @click="logout">تسجيل الخروج</AppButton>
  </div>
</template>

<style scoped>
.s { display: grid; gap: var(--sp-4); }
</style>

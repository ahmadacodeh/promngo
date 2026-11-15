<script setup lang="ts">
import { RouterLink } from 'vue-router';
import AlertBanner from '@/components/AlertBanner.vue';
import AppCard from '@/components/AppCard.vue';
import PageHeader from '@/components/PageHeader.vue';
import { ROLE_LABELS } from '@/i18n/ar';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
</script>

<template>
  <PageHeader :title="`مرحبًا، ${auth.user?.fullName ?? ''}`" :subtitle="`${auth.role ? ROLE_LABELS[auth.role] : ''} — ${auth.company?.name ?? ''}`" />
  <div class="grid">
    <AppCard>
      <h2>حسابك</h2>
      <dl class="kv">
        <div><dt>البريد</dt><dd dir="ltr">{{ auth.user?.email }}</dd></div>
        <div><dt>الدور</dt><dd>{{ auth.role ? ROLE_LABELS[auth.role] : '' }}</dd></div>
        <div v-if="auth.user?.specialization"><dt>التخصص</dt><dd>{{ auth.user.specialization.name }}</dd></div>
        <div><dt>الشركة</dt><dd>{{ auth.company?.name }}</dd></div>
      </dl>
      <RouterLink :to="{ name: 'change-password' }">تغيير كلمة المرور</RouterLink>
    </AppCard>
    <AlertBanner tone="info" title="مؤشرات المشاريع والمهام">
      ستظهر هنا بعد اكتمال وحدتي المشاريع والمهام في الخادم. لا تُعرض أرقام تجريبية في هذه الأثناء.
    </AlertBanner>
  </div>
</template>

<style scoped>
.grid { display: grid; gap: var(--sp-4); grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: start; }
.kv { display: grid; gap: var(--sp-2); margin-block: var(--sp-3) var(--sp-4); }
.kv div { display: flex; justify-content: space-between; gap: var(--sp-3); border-block-end: 1px solid var(--row-line); padding-block-end: var(--sp-2); }
dt { color: var(--muted); }
dd { margin: 0; font-weight: 500; }
</style>

<script setup lang="ts">
/** Company profile (T17): read for the executive manager, rename with validation. Slug/status are operator-managed. */
import { computed, onMounted, ref, watch } from 'vue';
import { isHttpError } from '@/api/http';
import { companyApi } from '@/api/endpoints';
import type { CompanyDto, CompanyStatus } from '@/api/types';
import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import TextField from '@/components/TextField.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useToast } from '@/composables/useToast';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils/format';

const STATUS: Record<CompanyStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  ACTIVE: { label: 'نشطة', tone: 'success' },
  SUSPENDED: { label: 'معلّقة', tone: 'warning' },
  ARCHIVED: { label: 'مؤرشفة', tone: 'danger' },
};

const auth = useAuthStore();
const toast = useToast();
const { data, error, loading, load } = useAsyncData(() => companyApi.current());
onMounted(load);

const name = ref('');
const nameErr = ref('');
const saving = ref(false);
const saveError = ref<unknown>(null);
watch(data, (c) => {
  if (c) name.value = c.name;
});
const dirty = computed(() => !!data.value && name.value.trim() !== data.value.name);

async function save() {
  const v = name.value.trim();
  nameErr.value = !v ? 'اسم الشركة مطلوب.' : v.length > 180 ? 'الاسم أطول من 180 حرفًا.' : '';
  if (nameErr.value || !dirty.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    const c: CompanyDto = await companyApi.update({ name: v });
    data.value = c;
    if (auth.user) auth.apply({ user: auth.user, company: c, mustChangePassword: auth.mustChangePassword });
    toast.success('حُفظ اسم الشركة.');
  } catch (e) {
    if (isHttpError(e) && e.fields?.name) nameErr.value = e.fields.name;
    saveError.value = e;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageHeader title="الشركة" subtitle="بيانات شركتك في المنصة." />
  <ErrorState v-if="error && !data" :error="error" :retrying="loading" @retry="load" />
  <SkeletonBlock v-else-if="!data" height="220px" radius="12px" />
  <div v-else class="grid">
    <AppCard>
      <h2 class="card-title">اسم الشركة</h2>
      <form class="form" novalidate @submit.prevent="save">
        <TextField v-model="name" label="الاسم الظاهر للفريق" required :maxlength="180" :error="nameErr" />
        <ErrorState v-if="saveError && !nameErr" :error="saveError" :retrying="saving" @retry="save" />
        <div><AppButton type="submit" :loading="saving" :disabled="!dirty">حفظ الاسم</AppButton></div>
      </form>
    </AppCard>
    <AppCard>
      <h2 class="card-title">معلومات الحساب</h2>
      <dl class="kv">
        <div><dt>المعرّف</dt><dd dir="ltr">{{ data.slug }}</dd></div>
        <div><dt>الحالة</dt><dd><StatusBadge v-bind="STATUS[data.status]" /></dd></div>
        <div><dt>تاريخ الإنشاء</dt><dd>{{ formatDate(data.createdAt.slice(0, 10)) }}</dd></div>
      </dl>
      <p class="note">المعرّف والحالة يديرهما مشغّل المنصة، ولا يتغيّران من هنا.</p>
    </AppCard>
  </div>
</template>

<style scoped>
.grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: start; }
.card-title { color: var(--forest); font-size: 1.0625rem; font-weight: 700; margin-block-end: var(--sp-3); }
.form { display: grid; gap: var(--sp-4); }
.kv { display: grid; gap: var(--sp-2); margin: 0; }
.kv div { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); border-block-end: 1px solid var(--row-line); padding-block-end: var(--sp-2); }
dt { color: var(--muted); }
dd { margin: 0; font-weight: 600; }
.note { color: var(--muted); font-size: var(--fs-sm); margin-block-start: var(--sp-3); }
</style>

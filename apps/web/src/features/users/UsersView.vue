<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { specializationsApi, usersApi } from '@/api/endpoints';
import { ROLES, type Role, type UserDto } from '@/api/types';
import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import SelectField from '@/components/SelectField.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import TextField from '@/components/TextField.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useDebounced } from '@/composables/useDebounced';
import { useToast } from '@/composables/useToast';
import { COMMON, ROLE_LABELS, describeError } from '@/i18n/ar';
import { useAuthStore } from '@/stores/auth';
import { USERS_COPY as C } from './copy';
import TempPasswordModal from './TempPasswordModal.vue';
import UserFormModal, { type SavedUser } from './UserFormModal.vue';

const PAGE_SIZE = 20;

const auth = useAuthStore();
const toast = useToast();

const q = ref('');
const debouncedQ = useDebounced(q, 300);
const role = ref<Role | ''>('');
const status = ref<'all' | 'active' | 'inactive'>('all');
const page = ref(1);

const list = useAsyncData(() =>
  usersApi.list({
    page: page.value,
    pageSize: PAGE_SIZE,
    ...(debouncedQ.value.trim() ? { q: debouncedQ.value.trim() } : {}),
    ...(role.value ? { role: role.value } : {}),
    ...(status.value === 'all' ? {} : { active: status.value === 'active' }),
  }),
);
const specs = useAsyncData(() => specializationsApi.list(1, 200));

const items = computed(() => list.data.value?.items ?? []);
const total = computed(() => list.data.value?.total ?? 0);
const filtered = computed(() => debouncedQ.value.trim() !== '' || role.value !== '' || status.value !== 'all');
const specList = computed(() => specs.data.value?.items ?? []);
const specsFailed = computed(() => specs.settled.value && specs.error.value !== null);
const roleOptions = [{ value: '', label: C.allRoles }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))];
const statusOptions = [
  { value: 'all', label: C.statusAll },
  { value: 'active', label: C.statusActive },
  { value: 'inactive', label: C.statusInactive },
];

onMounted(() => {
  void list.load();
  void specs.load();
});
// A filter change goes back to page 1 (one request); a page change reloads in place.
watch([debouncedQ, role, status], () => {
  if (page.value !== 1) page.value = 1;
  else void list.load();
});
watch(page, () => void list.load());
// If the current page became empty (e.g. last item disabled under the "active" filter), step back.
watch(
  () => list.data.value,
  (d) => {
    if (d && d.items.length === 0 && d.total > 0 && page.value > 1) page.value = Math.max(1, Math.ceil(d.total / PAGE_SIZE));
  },
);

function clearFilters(): void {
  q.value = '';
  role.value = '';
  status.value = 'all';
}

/* ---- create / edit ---- */
const formState = ref<{ mode: 'create' | 'edit'; user: UserDto | null } | null>(null);
function openCreate(): void {
  formState.value = { mode: 'create', user: null };
}
function openEdit(u: UserDto): void {
  formState.value = { mode: 'edit', user: u };
}

/* ---- temporary password (shown once, dropped on close) ---- */
const tempPw = ref<{ kind: 'created' | 'reset'; fullName: string; email: string; password: string } | null>(null);

async function onSaved(r: SavedUser): Promise<void> {
  formState.value = null;
  if (r.user.id === auth.user?.id && auth.company && r.changed) {
    auth.apply({ user: r.user, company: auth.company, mustChangePassword: auth.mustChangePassword }); // name/permissions in the shell
  }
  if (r.temporaryPassword) {
    tempPw.value = { kind: 'created', fullName: r.user.fullName, email: r.user.email, password: r.temporaryPassword };
    toast.success(C.created(r.user.fullName));
  } else if (r.changed) {
    toast.success(C.updated(r.user.fullName));
  }
  if (r.changed) await list.load();
}

/* ---- disable / reset (confirmed) and enable (direct) ---- */
const confirm = ref<{ kind: 'disable' | 'reset'; user: UserDto } | null>(null);
const confirmBusy = ref(false);
const confirmError = ref<unknown>(null);
const busyId = ref<string | null>(null);

function ask(kind: 'disable' | 'reset', user: UserDto): void {
  confirmError.value = null;
  confirm.value = { kind, user };
}
function closeConfirm(): void {
  if (!confirmBusy.value) confirm.value = null;
}

async function runConfirm(): Promise<void> {
  const c = confirm.value;
  if (!c || confirmBusy.value) return;
  confirmBusy.value = true;
  confirmError.value = null;
  try {
    if (c.kind === 'disable') {
      await usersApi.update(c.user.id, { isActive: false });
      toast.success(C.disabled(c.user.fullName));
    } else {
      const res = await usersApi.resetPassword(c.user.id);
      tempPw.value = { kind: 'reset', fullName: c.user.fullName, email: c.user.email, password: res.temporaryPassword };
    }
    confirm.value = null;
    await list.load();
  } catch (e) {
    confirmError.value = e;
  } finally {
    confirmBusy.value = false;
  }
}

async function enable(u: UserDto): Promise<void> {
  if (busyId.value) return;
  busyId.value = u.id;
  try {
    await usersApi.update(u.id, { isActive: true });
    toast.success(C.enabled(u.fullName));
    await list.load();
  } catch (e) {
    const d = describeError(e);
    toast.error(C.enableFailed(u.fullName), { detail: `${d.what} ${d.fix}`, action: { label: COMMON.retry, run: () => void enable(u) } });
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <PageHeader :title="C.title" :subtitle="list.data.value ? C.subtitle(total) : undefined">
    <AppButton icon="plus" @click="openCreate">{{ C.add }}</AppButton>
  </PageHeader>

  <AppCard as="div" class="filters">
    <TextField v-model="q" type="search" :label="C.searchLabel" :placeholder="C.searchPlaceholder" autocomplete="off" :maxlength="100" />
    <SelectField v-model="role" :label="C.roleFilter" :options="roleOptions" />
    <SelectField v-model="status" :label="C.statusFilter" :options="statusOptions" />
  </AppCard>

  <ErrorState v-if="list.error.value" class="gap" :error="list.error.value" :retrying="list.loading.value" @retry="list.load" />

  <AppCard v-if="!list.data.value && list.loading.value" as="div" class="gap" aria-busy="true">
    <div class="skeleton" role="status" aria-label="جارٍ تحميل المستخدمين">
      <SkeletonBlock v-for="n in 5" :key="n" height="44px" />
    </div>
  </AppCard>

  <template v-else-if="list.data.value">
    <AppCard v-if="items.length === 0" as="div" class="gap">
      <EmptyState v-if="filtered" icon="search" :title="C.emptyFiltered" :description="C.emptyFilteredHint">
        <AppButton variant="secondary" @click="clearFilters">{{ C.clearFilters }}</AppButton>
      </EmptyState>
      <EmptyState v-else icon="users" :title="C.emptyTitle">
        <AppButton icon="plus" @click="openCreate">{{ C.add }}</AppButton>
      </EmptyState>
    </AppCard>

    <AppCard v-else as="div" :padded="false" class="gap">
      <div class="tablewrap" :aria-busy="list.loading.value">
        <table class="tbl">
          <caption class="sr-only">{{ C.tableCaption }}</caption>
          <thead>
            <tr>
              <th scope="col">{{ C.colUser }}</th>
              <th scope="col">{{ C.colRole }}</th>
              <th scope="col">{{ C.colSpec }}</th>
              <th scope="col">{{ C.colStatus }}</th>
              <th scope="col"><span class="sr-only">{{ COMMON.actions }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in items" :key="u.id" :class="{ 'is-inactive': !u.isActive }">
              <td class="cell-user" :data-label="C.colUser">
                <div class="who">
                  <strong>{{ u.fullName }}</strong>
                  <span v-if="u.id === auth.user?.id" class="you">({{ C.you }})</span>
                </div>
                <span class="mail" dir="ltr">{{ u.email }}</span>
              </td>
              <td :data-label="C.colRole">
                <span>{{ ROLE_LABELS[u.role] }}</span>
                <small v-if="u.canCreateProjects" class="sub">{{ C.canCreateProjects }}</small>
              </td>
              <td :data-label="C.colSpec">{{ u.specialization?.name ?? C.noSpec }}</td>
              <td :data-label="C.colStatus">
                <div class="badges">
                  <StatusBadge :tone="u.isActive ? 'success' : 'neutral'" :label="u.isActive ? C.active : C.inactive" />
                  <StatusBadge v-if="u.isActive && u.mustChangePassword" tone="warning" :label="C.mustChange" />
                </div>
              </td>
              <td class="acts">
                <AppButton variant="ghost" size="sm" :aria-label="`${C.edit} ${u.fullName}`" @click="openEdit(u)">{{ C.edit }}</AppButton>
                <template v-if="u.id !== auth.user?.id">
                  <AppButton v-if="u.isActive" variant="ghost" size="sm" :aria-label="`${C.resetPassword} ${u.fullName}`" @click="ask('reset', u)">{{ C.resetPassword }}</AppButton>
                  <AppButton v-if="u.isActive" variant="ghost" size="sm" :aria-label="`${C.disable} ${u.fullName}`" @click="ask('disable', u)">{{ C.disable }}</AppButton>
                  <AppButton v-else variant="ghost" size="sm" :loading="busyId === u.id" :aria-label="`${C.enable} ${u.fullName}`" @click="enable(u)">{{ C.enable }}</AppButton>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar class="pager" :page="page" :page-size="PAGE_SIZE" :total="total" :disabled="list.loading.value" @update:page="page = $event" />
    </AppCard>
  </template>

  <UserFormModal
    :open="formState !== null"
    :mode="formState?.mode ?? 'create'"
    :user="formState?.user ?? null"
    :specializations="specList"
    :specializations-failed="specsFailed"
    :self-id="auth.user?.id ?? null"
    @close="formState = null"
    @saved="onSaved"
  />

  <TempPasswordModal
    :open="tempPw !== null"
    :kind="tempPw?.kind ?? 'created'"
    :full-name="tempPw?.fullName ?? ''"
    :email="tempPw?.email ?? ''"
    :password="tempPw?.password ?? ''"
    @close="tempPw = null"
  />

  <ConfirmDialog
    :open="confirm !== null"
    :title="confirm ? (confirm.kind === 'disable' ? C.disableTitle(confirm.user.fullName) : C.resetTitle(confirm.user.fullName)) : ''"
    :confirm-label="confirm?.kind === 'disable' ? C.disableConfirm : C.resetConfirm"
    :tone="confirm?.kind === 'disable' ? 'danger' : 'primary'"
    :loading="confirmBusy"
    :error="confirmError"
    @confirm="runConfirm"
    @close="closeConfirm"
  >
    <p>{{ confirm?.kind === 'disable' ? C.disableBody : C.resetBody }}</p>
  </ConfirmDialog>
</template>

<style scoped>
.filters { display: grid; gap: var(--sp-4); grid-template-columns: 2fr 1fr 1fr; align-items: end; margin-block-end: var(--sp-4); }
.gap { margin-block-end: var(--sp-4); }
.skeleton { display: grid; gap: var(--sp-3); }

.tablewrap { overflow-x: auto; }
.tbl { inline-size: 100%; border-collapse: collapse; }
.tbl th { text-align: start; font-size: var(--fs-sm); color: var(--muted); font-weight: 700; padding: var(--sp-3) var(--sp-4); border-block-end: 1px solid var(--line); background: var(--canvas); white-space: nowrap; }
.tbl td { padding: var(--sp-3) var(--sp-4); border-block-end: 1px solid var(--row-line); vertical-align: middle; }
.tbl tbody tr:last-child td { border-block-end: 0; }
.tbl tbody tr:hover { background: var(--canvas); }
.is-inactive td:not(.acts) { color: var(--muted); }
.who { display: flex; gap: var(--sp-2); align-items: baseline; }
.you { color: var(--emerald-ink); font-size: var(--fs-sm); font-weight: 700; }
/* the email is LTR inside an RTL page: `end` = the page-start side, so it lines up under the right-aligned name */
.mail { display: block; color: var(--muted); font-size: var(--fs-sm); text-align: end; overflow-wrap: anywhere; }
.sub { display: block; color: var(--muted); font-size: var(--fs-xs); }
.badges { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
.acts { white-space: nowrap; text-align: end; }
.acts :deep(.btn) { padding-inline: var(--sp-3); }
.pager { padding: var(--sp-3) var(--sp-4) var(--sp-4); border-block-start: 1px solid var(--line); }

@media (max-width: 860px) {
  .filters { grid-template-columns: 1fr 1fr; }
  .filters > :first-child { grid-column: 1 / -1; }
  /* rows become labelled cards: no horizontal scrolling on phones */
  .tbl thead { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
  .tbl, .tbl tbody, .tbl tr, .tbl td { display: block; }
  .tbl tr { padding: var(--sp-3) var(--sp-4); border-block-end: 1px solid var(--line); }
  .tbl tbody tr:last-child { border-block-end: 0; }
  .tbl td { display: flex; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-1) 0; border: 0; }
  .tbl td::before { content: attr(data-label); color: var(--muted); font-size: var(--fs-sm); font-weight: 700; flex: none; }
  .tbl td.cell-user { display: block; padding-block-end: var(--sp-2); }
  .tbl td.cell-user::before { content: none; }
  .tbl td.acts { justify-content: flex-start; flex-wrap: wrap; padding-block-start: var(--sp-2); }
  .tbl td.acts::before { content: none; }
  .who { flex-wrap: wrap; }
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { COMMON, ROLE_LABELS } from '@/i18n/ar';
import { useAuthStore } from '@/stores/auth';
import logo from '@/assets/brand/logo-icon-64.png';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const drawerOpen = ref(false);
const loggingOut = ref(false);

const navItems = computed(() =>
  router
    .getRoutes()
    .filter((r) => r.meta.nav && (!r.meta.roles || (auth.role && r.meta.roles.includes(auth.role))))
    .map((r) => ({ name: r.name as string, path: r.path, ...r.meta.nav! }))
    .toSorted((a, b) => a.order - b.order),
);

watch(() => route.fullPath, () => (drawerOpen.value = false));

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && drawerOpen.value) drawerOpen.value = false;
}

async function logout(): Promise<void> {
  loggingOut.value = true;
  await auth.logout();
  await router.replace({ name: 'login' });
  loggingOut.value = false;
}
</script>

<template>
  <div class="shell" @keydown="onKey">
    <a class="skip-link" href="#main">{{ COMMON.skipToContent }}</a>

    <aside id="sidebar" class="side" :class="{ 'is-open': drawerOpen }" aria-label="القائمة الرئيسية">
      <div class="side__brand">
        <img :src="logo" alt="" width="32" height="32" />
        <span>{{ COMMON.appName }}</span>
      </div>
      <nav class="side__nav">
        <RouterLink v-for="n in navItems" :key="n.name" :to="{ name: n.name }" class="side__link" active-class="is-active">
          <AppIcon :name="n.icon" />
          <span>{{ n.label }}</span>
        </RouterLink>
      </nav>
      <div class="side__user">
        <strong class="side__name">{{ auth.user?.fullName }}</strong>
        <span class="side__role">{{ auth.role ? ROLE_LABELS[auth.role] : '' }}</span>
        <span class="side__co">{{ auth.company?.name }}</span>
      </div>
    </aside>
    <div v-if="drawerOpen" class="scrim" @click="drawerOpen = false" />

    <div class="main">
      <header class="top">
        <button type="button" class="top__menu" :aria-expanded="drawerOpen" aria-controls="sidebar" :aria-label="COMMON.menu" @click="drawerOpen = !drawerOpen">
          <AppIcon name="menu" :size="22" />
        </button>
        <span class="top__title">{{ route.meta.title }}</span>
        <button type="button" class="top__logout" :disabled="loggingOut" @click="logout">
          <AppIcon name="logout" :size="18" />
          <span class="top__logout-label">{{ COMMON.logout }}</span>
        </button>
      </header>
      <main id="main" class="content" tabindex="-1">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell { min-block-size: 100vh; display: grid; grid-template-columns: var(--sidebar-w) minmax(0, 1fr); }
/* RTL: the first grid column (the sidebar) sits on the RIGHT, as in the Figma frames. */
.side { position: sticky; inset-block-start: 0; block-size: 100vh; display: flex; flex-direction: column; gap: var(--sp-5); padding: var(--sp-5) var(--sp-3); background: var(--forest); color: var(--sidebar-text); z-index: var(--z-sidebar); }
.side__brand { display: flex; align-items: center; gap: var(--sp-3); padding-inline: var(--sp-3); font-weight: 700; font-size: var(--fs-lg); color: #fff; letter-spacing: 0.04em; }
.side__nav { display: grid; gap: var(--sp-1); align-content: start; flex: 1; }
.side__link { display: flex; align-items: center; gap: var(--sp-3); min-block-size: 44px; padding-inline: var(--sp-3); border-radius: var(--radius-md); color: var(--sidebar-text); text-decoration: none; font-weight: 500; transition: background var(--dur-fast) ease; }
.side__link:hover { background: var(--sidebar-hover); color: #fff; }
.side__link.is-active { background: var(--sidebar-selected); color: #fff; font-weight: 700; box-shadow: inset -3px 0 0 var(--mango); }
.side__link:focus-visible { outline-color: #fff; }
.side__user { display: grid; gap: 2px; padding: var(--sp-3); border-radius: var(--radius-md); background: var(--sidebar-hover); font-size: var(--fs-sm); }
.side__name { color: #fff; }
.side__role { color: var(--sidebar-text); }
.side__co { color: #a9c7b9; font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.main { min-inline-size: 0; display: flex; flex-direction: column; }
.top { position: sticky; inset-block-start: 0; z-index: var(--z-topbar); display: flex; align-items: center; gap: var(--sp-3); block-size: var(--topbar-h); padding-inline: var(--sp-5); background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(6px); border-block-end: 1px solid var(--line); }
.top__title { font-weight: 700; color: var(--forest); flex: 1; }
.top__menu { display: none; background: none; border: 0; color: var(--forest); padding: var(--sp-2); border-radius: var(--radius-sm); }
.top__logout { display: inline-flex; align-items: center; gap: var(--sp-2); min-block-size: 40px; padding-inline: var(--sp-3); background: none; border: 1px solid var(--line); border-radius: var(--radius-md); color: var(--forest); font-weight: 500; }
.top__logout:hover:not(:disabled) { background: var(--emerald-soft); }
.content { inline-size: 100%; max-inline-size: var(--content-max); margin-inline: auto; padding: var(--sp-6) var(--sp-5); outline: none; }
.scrim { display: none; }

@media (max-width: 900px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .side { position: fixed; inset-block: 0; inset-inline-start: 0; inline-size: min(290px, 86vw); transform: translateX(100%); transition: transform var(--dur-base) var(--ease); box-shadow: var(--shadow-pop); }
  .side.is-open { transform: none; }
  .scrim { display: block; position: fixed; inset: 0; background: var(--overlay); z-index: calc(var(--z-sidebar) - 1); }
  .top__menu { display: grid; }
  /* إخفاء بصري فقط: display:none كان يجرّد الزر من اسمه لقارئات الشاشة (اكتشفه اختبار الجوال). */
  .top__logout-label { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .top { padding-inline: var(--sp-3); }
  .content { padding: var(--sp-5) var(--sp-4); }
}
@media (prefers-reduced-motion: reduce) { .side { transition: none; } }
</style>

<script setup lang="ts">
import logo from '@/assets/brand/logo-icon-64.png';
import { COMMON } from '@/i18n/ar';
</script>

<template>
  <main id="main" class="auth" tabindex="-1">
    <div class="auth__card">
      <div class="auth__brand">
        <img :src="logo" alt="" width="40" height="40" />
        <span>{{ COMMON.appName }}</span>
      </div>
      <slot />
    </div>
    <p class="auth__foot">منصة إدارة المشاريع والمهام للشركات</p>
  </main>
</template>

<style scoped>
.auth { min-block-size: 100vh; display: grid; place-content: center; justify-items: center; gap: var(--sp-4); padding: var(--sp-5) var(--sp-4); background: radial-gradient(1200px 500px at 50% -10%, var(--mint), transparent 70%), var(--canvas); }
.auth__card { inline-size: min(440px, calc(100vw - 2 * var(--sp-4))); display: grid; gap: var(--sp-5); padding: var(--sp-6); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-pop); animation: rise var(--dur-slow) var(--ease) both; }
.auth__brand { display: flex; align-items: center; gap: var(--sp-3); font-weight: 700; font-size: var(--fs-lg); color: var(--forest); letter-spacing: 0.04em; }
.auth__foot { font-size: var(--fs-sm); color: var(--muted); }
@keyframes rise { from { opacity: 0; transform: translateY(var(--rise)); } }
@media (max-width: 480px) { .auth__card { padding: var(--sp-5); } }
</style>

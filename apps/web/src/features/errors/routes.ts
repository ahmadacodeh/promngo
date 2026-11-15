import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/company-suspended', name: 'company-suspended', component: () => import('./CompanySuspendedView.vue'), meta: { layout: 'auth', title: 'الشركة غير نشطة' } },
  { path: '/forbidden', name: 'forbidden', component: () => import('./ForbiddenView.vue'), meta: { title: 'غير مصرّح' } },
];
export default routes;

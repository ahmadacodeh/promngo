import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('./DashboardView.vue'),
    meta: { title: 'لوحة التحكم', nav: { label: 'لوحة التحكم', icon: 'dashboard', order: 10 } },
  },
];
export default routes;

import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/company',
    name: 'company',
    component: () => import('./CompanyView.vue'),
    // UI gate only: PATCH /companies/current is EXECUTIVE_MANAGER-only in the API.
    meta: { title: 'الشركة', roles: ['EXECUTIVE_MANAGER'], nav: { label: 'الشركة', icon: 'building', order: 30 } },
  },
];
export default routes;

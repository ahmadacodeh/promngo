import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/users',
    name: 'users',
    component: () => import('./UsersView.vue'),
    // UI gate only: every /users write is authorised again by the API (EXECUTIVE_MANAGER).
    meta: { title: 'المستخدمون', roles: ['EXECUTIVE_MANAGER'], nav: { label: 'المستخدمون', icon: 'users', order: 20 } },
  },
];
export default routes;

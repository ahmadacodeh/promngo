import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('./TasksView.vue'),
    // Every role: GET /tasks applies visibility (an employee sees only tasks in their reach).
    meta: { title: 'المهام', nav: { label: 'المهام', icon: 'tasks', order: 14 } },
  },
];
export default routes;

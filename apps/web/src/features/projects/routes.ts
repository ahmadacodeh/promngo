import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/projects',
    name: 'projects',
    component: () => import('./ProjectsView.vue'),
    // Visible to every role: the API returns only the projects the user may see.
    meta: { title: 'المشاريع', nav: { label: 'المشاريع', icon: 'folder', order: 12 } },
  },
  {
    path: '/projects/:id',
    name: 'project-detail',
    component: () => import('./ProjectDetailView.vue'),
    meta: { title: 'تفاصيل المشروع' },
  },
];
export default routes;

import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('./LoginView.vue'), meta: { public: true, layout: 'auth', title: 'تسجيل الدخول' } },
  { path: '/change-password', name: 'change-password', component: () => import('./ChangePasswordView.vue'), meta: { layout: 'auth', title: 'تغيير كلمة المرور' } },
];
export default routes;

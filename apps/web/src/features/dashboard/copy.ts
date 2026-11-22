import type { Role } from '@/api/types';

/** Headings per role, copied from the four Figma dashboard screens. */
export const HEADINGS: Record<Role, { title: string; subtitle: string }> = {
  EXECUTIVE_MANAGER: { title: 'مرحبًا بك', subtitle: 'نظرة شاملة على أداء الشركة والمشاريع والفرق.' },
  PROJECT_MANAGER: { title: 'مساحة إدارة المشاريع', subtitle: 'تابع تقدم المشاريع ووزّع المهام على الفرق.' },
  SPECIALIZED_MANAGER: { title: 'لوحة إدارة التخصص', subtitle: 'نظّم مهام التخصص وراجع التسليمات.' },
  EMPLOYEE: { title: 'مهامي اليوم', subtitle: 'ركّز على أولوياتك وسلّم العمل في الوقت المحدد.' },
};

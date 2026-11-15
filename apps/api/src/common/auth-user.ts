export type Role = 'EXECUTIVE_MANAGER' | 'PROJECT_MANAGER' | 'SPECIALIZED_MANAGER' | 'EMPLOYEE';
export const ROLES: readonly Role[] = ['EXECUTIVE_MANAGER', 'PROJECT_MANAGER', 'SPECIALIZED_MANAGER', 'EMPLOYEE'];

/** المدراء = المدير التنفيذي + مدير المشروع (يرون كل بيانات الشركة). */
export const MANAGER_ROLES: readonly Role[] = ['EXECUTIVE_MANAGER', 'PROJECT_MANAGER'];
export const isManager = (role: Role): boolean => MANAGER_ROLES.includes(role);

/** المستخدم كما يحمّله JwtAuthGuard من القاعدة في كل طلب (لا يُثق بمحتوى الرمز عدا الهوية). */
export interface AuthUser {
  id: string;
  companyId: string;
  fullName: string;
  email: string;
  role: Role;
  canCreateProjects: boolean;
  mustChangePassword: boolean;
  specializationId: string | null;
}

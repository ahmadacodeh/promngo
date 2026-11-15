import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, Role } from '../auth-user.js';

export const IS_PUBLIC_KEY = 'promango:isPublic';
export const ROLES_KEY = 'promango:roles';
export const ALLOW_DURING_PASSWORD_CHANGE_KEY = 'promango:allowDuringPasswordChange';

/** مسار بلا مصادقة (health, login, refresh, logout). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** يقصر المسار على أدوار محددة (يفرضه RolesGuard في الخادم). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** يسمح بالمسار حتى لو كان على المستخدم تغيير كلمة المرور (me, change-password, logout). */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_DURING_PASSWORD_CHANGE_KEY, true);

/** المستخدم الموثّق الحالي. الشركة تُؤخذ من هنا دائمًا (`user.companyId`) لا من الطلب. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});

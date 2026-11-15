import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import { ApiException } from '../api-exception.js';
import { ALLOW_DURING_PASSWORD_CHANGE_KEY, IS_PUBLIC_KEY } from '../decorators/index.js';
import type { AuthUser, Role } from '../auth-user.js';
import { TokensService } from '../../auth/tokens.service.js';

interface UserRow {
  id: string;
  company_id: string;
  full_name: string;
  email: string;
  role: Role;
  can_create_projects: boolean;
  is_active: boolean;
  must_change_password: boolean;
  tokens_invalid_before: Date | null;
  specialization_id: string | null;
  company_status: string;
}

/**
 * حارس عام: يتحقق من الرمز (typ=access) ثم يحمّل المستخدم من القاعدة في كل طلب ويفحص:
 * النشاط، tokens_invalid_before (بالثواني الكاملة)، حالة الشركة، وإلزامية تغيير كلمة المرور.
 * الواجهة ليست حماية؛ هذا الحارس هو المرجع.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly ds: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = header && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new ApiException(401, 'UNAUTHORIZED');

    const claims = this.tokens.verifyAccess(token); // يرمي 401 إن لم يصح

    const rows: UserRow[] = await this.ds.query(
      `SELECT u.id, u.company_id, u.full_name, u.email, u.role, u.can_create_projects, u.is_active,
              u.must_change_password, u.tokens_invalid_before, u.specialization_id, c.status AS company_status
         FROM users u JOIN companies c ON c.id = u.company_id
        WHERE u.id = $1`,
      [claims.sub],
    );
    const u = rows[0];
    if (!u || !u.is_active) throw new ApiException(401, 'UNAUTHORIZED');

    // بالثواني الكاملة: أي رمز صدر قبل ثانية tokens_invalid_before يُرفض.
    if (u.tokens_invalid_before && claims.iat < Math.floor(u.tokens_invalid_before.getTime() / 1000)) {
      throw new ApiException(401, 'UNAUTHORIZED');
    }
    if (u.company_status !== 'ACTIVE') throw new ApiException(403, 'COMPANY_NOT_ACTIVE');

    if (u.must_change_password && !this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_CHANGE_KEY, targets)) {
      throw new ApiException(403, 'PASSWORD_MUST_CHANGE');
    }

    req.user = {
      id: u.id,
      companyId: u.company_id,
      fullName: u.full_name,
      email: u.email,
      role: u.role,
      canCreateProjects: u.can_create_projects,
      mustChangePassword: u.must_change_password,
      specializationId: u.specialization_id,
    };
    return true;
  }
}

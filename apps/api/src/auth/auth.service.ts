import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiException } from '../common/api-exception.js';
import type { AuthUser } from '../common/auth-user.js';
import { loadCompanyDto, loadUserDto, type CompanyDto, type UserDto } from '../common/user-dto.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { passwordByteLength, passwordPolicyProblems } from './password-policy.js';
import { SessionsService, type SessionMeta } from './sessions.service.js';
import { ACCESS_TTL_SECONDS, TokensService } from './tokens.service.js';
import { PASSWORD_MAX_BYTES } from '../common/messages.js';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserDto;
  company: CompanyDto;
  mustChangePassword: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly ds: DataSource,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly throttle: LoginThrottleService,
  ) {}

  async login(email: string, password: string, meta: SessionMeta): Promise<AuthResponse> {
    const emailKey = email.trim().toLowerCase().slice(0, 255);
    await this.throttle.assertAllowed(emailKey, meta.ip);

    // bcrypt يقتطع عند 72 بايت: كلمة أطول لا تُمرَّر للقاعدة أبدًا (تُعدّ فاشلة).
    let userId: string | null = null;
    if (passwordByteLength(password) <= PASSWORD_MAX_BYTES) {
      // التحقق يجري داخل PostgreSQL (pgcrypto)؛ التطبيق لا يرى التجزئة.
      const rows = await this.ds.query(`SELECT auth_verify_login($1, $2) AS id`, [emailKey, password]);
      userId = rows[0]?.id ?? null;
    }
    if (!userId) {
      await this.throttle.recordFailure(emailKey, meta.ip);
      throw new ApiException(401, 'INVALID_CREDENTIALS');
    }

    const u = (await this.ds.query(`SELECT company_id FROM users WHERE id = $1`, [userId]))[0];
    const company = await loadCompanyDto(this.ds, u.company_id);
    if (!company || company.status !== 'ACTIVE') throw new ApiException(403, 'COMPANY_NOT_ACTIVE');

    await this.throttle.recordSuccess(emailKey, meta.ip);
    const refreshToken = await this.sessions.create(this.ds, userId, u.company_id, meta);
    return this.buildResponse(userId, u.company_id, refreshToken);
  }

  async refresh(refreshToken: string, meta: SessionMeta): Promise<AuthResponse> {
    const r = await this.sessions.rotate(refreshToken, meta);
    return this.buildResponse(r.userId, r.companyId, r.refreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.sessions.revokeByToken(refreshToken);
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string, meta: SessionMeta): Promise<AuthResponse> {
    const okCurrent =
      passwordByteLength(currentPassword) <= PASSWORD_MAX_BYTES &&
      (await this.ds.query(`SELECT auth_verify_user_password($1, $2) AS ok`, [user.id, currentPassword]))[0]?.ok === true;
    if (!okCurrent) {
      throw new ApiException(401, 'INVALID_CREDENTIALS', { message: 'كلمة المرور الحالية غير صحيحة.', hint: 'أعد كتابة كلمة المرور الحالية بدقة.', fields: { currentPassword: 'كلمة المرور الحالية غير صحيحة.' } });
    }
    const problems = passwordPolicyProblems(newPassword, user.email);
    if (problems.length > 0) throw new ApiException(400, 'WEAK_PASSWORD', { fields: { newPassword: problems.join(' ') } });
    if (newPassword === currentPassword) {
      throw new ApiException(400, 'WEAK_PASSWORD', { fields: { newPassword: 'يجب أن تختلف كلمة المرور الجديدة عن الحالية.' } });
    }

    await this.ds.query(`SELECT auth_set_password($1, $2, FALSE)`, [user.id, newPassword]);
    await this.sessions.revokeAll(user.id); // كل الجلسات الأخرى تنتهي
    const refreshToken = await this.sessions.create(this.ds, user.id, user.companyId, meta);
    return this.buildResponse(user.id, user.companyId, refreshToken);
  }

  async me(user: AuthUser): Promise<{ user: UserDto; company: CompanyDto }> {
    const [u, c] = await Promise.all([loadUserDto(this.ds, user.companyId, user.id), loadCompanyDto(this.ds, user.companyId)]);
    if (!u || !c) throw new ApiException(401, 'UNAUTHORIZED');
    return { user: u, company: c };
  }

  private async buildResponse(userId: string, companyId: string, refreshToken: string): Promise<AuthResponse> {
    const [user, company] = await Promise.all([loadUserDto(this.ds, companyId, userId), loadCompanyDto(this.ds, companyId)]);
    if (!user || !company) throw new ApiException(401, 'UNAUTHORIZED');
    return {
      accessToken: this.tokens.signAccess(userId),
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      user,
      company,
      mustChangePassword: user.mustChangePassword,
    };
  }
}

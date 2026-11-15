import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ApiException, notFound } from '../common/api-exception.js';
import type { AuthUser } from '../common/auth-user.js';
import { escapeLike, paged, resolvePage, type Paged } from '../common/pagination.js';
import { generateTemporaryPassword } from '../common/temp-password.js';
import { USER_DTO_SELECT, loadUserDto, rowToUserDto, type UserDto } from '../common/user-dto.js';
import { SessionsService } from '../auth/sessions.service.js';
import type { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto.js';

const uniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; driverError?: { code?: string } };
  return (err.driverError?.code ?? err.code) === '23505';
};

@Injectable()
export class UsersService {
  constructor(
    private readonly ds: DataSource,
    private readonly sessions: SessionsService,
  ) {}

  async list(actor: AuthUser, q: ListUsersQuery): Promise<Paged<UserDto>> {
    const { page, pageSize, offset, limit } = resolvePage(q);
    const where = ['u.company_id = $1'];
    const params: unknown[] = [actor.companyId];
    if (q.role) where.push(`u.role = $${params.push(q.role)}`);
    if (q.active !== undefined) where.push(`u.is_active = $${params.push(q.active)}`);
    if (q.q?.trim()) {
      const like = `%${escapeLike(q.q.trim())}%`;
      const i = params.push(like);
      where.push(`(u.full_name ILIKE $${i} ESCAPE '\\' OR u.email ILIKE $${i} ESCAPE '\\')`);
    }
    const w = where.join(' AND ');
    const total = Number((await this.ds.query(`SELECT COUNT(*)::int AS n FROM users u WHERE ${w}`, params))[0].n);
    const rows = await this.ds.query(
      `SELECT ${USER_DTO_SELECT} FROM users u LEFT JOIN specializations s ON s.id = u.specialization_id
        WHERE ${w} ORDER BY u.full_name, u.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return paged(rows.map(rowToUserDto), total, page, pageSize);
  }

  async get(actor: AuthUser, id: string): Promise<UserDto> {
    const u = await loadUserDto(this.ds, actor.companyId, id);
    if (!u) throw notFound();
    return u;
  }

  async create(actor: AuthUser, dto: CreateUserDto): Promise<{ user: UserDto; temporaryPassword: string }> {
    const email = dto.email.trim().toLowerCase();
    await this.assertSpecialization(this.ds, dto.specializationId);
    const temporaryPassword = generateTemporaryPassword();
    let id: string;
    try {
      id = await this.ds.transaction(async (m) => {
        const row = (
          await m.query(
            `INSERT INTO users (company_id, full_name, email, role, can_create_projects, specialization_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [actor.companyId, dto.fullName, email, dto.role, dto.canCreateProjects ?? false, dto.specializationId ?? null],
          )
        )[0];
        await m.query(`SELECT auth_set_password($1, $2, TRUE)`, [row.id, temporaryPassword]); // التجزئة داخل PostgreSQL
        return row.id as string;
      });
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiException(409, 'EMAIL_TAKEN', { fields: { email: 'هذا البريد مستخدم بالفعل.' } });
      throw e;
    }
    return { user: await this.get(actor, id), temporaryPassword };
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto): Promise<UserDto> {
    const touchesAnything = [dto.fullName, dto.role, dto.canCreateProjects, dto.isActive, dto.specializationId].some((v) => v !== undefined);
    if (!touchesAnything) {
      throw new ApiException(400, 'VALIDATION_FAILED', { message: 'لم تُرسل أي بيانات للتعديل.', hint: 'أرسل حقلًا واحدًا على الأقل (الاسم أو الدور أو التفعيل...).' });
    }
    if (dto.specializationId) await this.assertSpecialization(this.ds, dto.specializationId);

    let deactivated = false;
    await this.ds.transaction(async (m) => {
      // نقفل المدراء التنفيذيين النشطين أولًا بترتيب ثابت (يمنع التسابق على «آخر مدير» وسباق الجمود).
      const execs: Array<{ id: string }> = await m.query(
        `SELECT id FROM users WHERE company_id = $1 AND role = 'EXECUTIVE_MANAGER' AND is_active ORDER BY id FOR UPDATE`,
        [actor.companyId],
      );
      const target = (await m.query(`SELECT id, role, is_active FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]))[0];
      if (!target) throw notFound();

      if (dto.isActive === false && target.id === actor.id) {
        throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكنك تعطيل حسابك بنفسك.', hint: 'اطلب من مدير تنفيذي آخر تعطيل الحساب.' });
      }
      const loosesExecutive =
        target.role === 'EXECUTIVE_MANAGER' && target.is_active && (dto.isActive === false || (dto.role !== undefined && dto.role !== 'EXECUTIVE_MANAGER'));
      if (loosesExecutive && execs.length <= 1) throw new ApiException(409, 'LAST_EXECUTIVE');

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, v: unknown) => sets.push(`${col} = $${params.push(v)}`);
      if (dto.fullName !== undefined) set('full_name', dto.fullName);
      if (dto.role !== undefined) set('role', dto.role);
      if (dto.canCreateProjects !== undefined) set('can_create_projects', dto.canCreateProjects);
      if (dto.isActive !== undefined) set('is_active', dto.isActive);
      if (dto.specializationId !== undefined) set('specialization_id', dto.specializationId);
      params.push(id, actor.companyId);
      await m.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND company_id = $${params.length}`, params);
      deactivated = dto.isActive === false && target.is_active;
    });
    if (deactivated) await this.sessions.revokeAll(id);
    return this.get(actor, id);
  }

  async resetPassword(actor: AuthUser, id: string): Promise<{ temporaryPassword: string }> {
    const target = (await this.ds.query(`SELECT id, email FROM users WHERE id = $1 AND company_id = $2`, [id, actor.companyId]))[0];
    if (!target) throw notFound();
    const temporaryPassword = generateTemporaryPassword();
    await this.ds.transaction(async (m: EntityManager) => {
      await m.query(`SELECT auth_set_password($1, $2, TRUE)`, [id, temporaryPassword]);
      // رفع الحجب: إعادة التعيين هي العلاج الموثق لقفل المحاولات.
      await m.query(`DELETE FROM login_attempts WHERE email_key = $1 AND NOT succeeded`, [String(target.email).toLowerCase()]);
    });
    await this.sessions.revokeAll(id);
    return { temporaryPassword };
  }

  private async assertSpecialization(db: Pick<DataSource, 'query'>, specializationId: string | undefined): Promise<void> {
    if (!specializationId) return;
    const ok = (await db.query(`SELECT 1 FROM specializations WHERE id = $1`, [specializationId])).length > 0;
    if (!ok) throw new ApiException(400, 'VALIDATION_FAILED', { fields: { specializationId: 'التخصص المختار غير موجود.' } });
  }
}

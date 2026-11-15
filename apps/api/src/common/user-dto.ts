import type { DataSource } from 'typeorm';
import type { Role } from './auth-user.js';
import { iso, toSpecRef, type SpecRef } from './mappers.js';

export interface UserDto {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  canCreateProjects: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  specialization: SpecRef | null;
  createdAt: string;
}
export interface CompanyDto {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  createdAt: string;
}

/** أعمدة SELECT المشتركة لـ UserDto (لا يتضمن عمود تجزئة كلمة المرور أبدًا). تُستخدم مع JOIN specializations s. */
export const USER_DTO_SELECT = `u.id, u.full_name, u.email, u.role, u.can_create_projects, u.is_active,
  u.must_change_password, u.created_at, s.id AS spec_id, s.name AS spec_name`;

// oxlint-disable-next-line typescript/no-explicit-any -- نتائج pg غير مصنّفة النوع
export function rowToUserDto(r: Record<string, any>): UserDto {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    canCreateProjects: r.can_create_projects,
    isActive: r.is_active,
    mustChangePassword: r.must_change_password,
    specialization: toSpecRef(r.spec_id, r.spec_name),
    createdAt: iso(r.created_at)!,
  };
}

// oxlint-disable-next-line typescript/no-explicit-any -- نتائج pg غير مصنّفة النوع
export function rowToCompanyDto(r: Record<string, any>): CompanyDto {
  return { id: r.id, name: r.name, slug: r.slug, status: r.status, createdAt: iso(r.created_at)! };
}

/** يحمّل UserDto داخل شركة المستخدم نفسها (companyId إلزامي: لا قراءة عابرة للشركات). */
export async function loadUserDto(ds: Pick<DataSource, 'query'>, companyId: string, userId: string): Promise<UserDto | null> {
  const rows = await ds.query(
    `SELECT ${USER_DTO_SELECT} FROM users u LEFT JOIN specializations s ON s.id = u.specialization_id
      WHERE u.id = $1 AND u.company_id = $2`,
    [userId, companyId],
  );
  return rows[0] ? rowToUserDto(rows[0]) : null;
}

export async function loadCompanyDto(ds: Pick<DataSource, 'query'>, companyId: string): Promise<CompanyDto | null> {
  const rows = await ds.query(`SELECT id, name, slug, status, created_at FROM companies WHERE id = $1`, [companyId]);
  return rows[0] ? rowToCompanyDto(rows[0]) : null;
}

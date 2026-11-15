import type { Role } from './auth-user.js';

export interface UserRef {
  id: string;
  fullName: string;
  role: Role;
}
export interface SpecRef {
  id: string;
  name: string;
}

/** صفوف خام من استعلامات SQL (snake_case) ← DTO (camelCase). */
export function toUserRef(row: { id: string; full_name: string; role: Role } | null | undefined): UserRef | null {
  return row ? { id: row.id, fullName: row.full_name, role: row.role } : null;
}

/** لربط أعمدة مسبوقة (مثلاً creator_id, creator_name, creator_role) بصف JOIN واحد. */
export function toUserRefPrefixed(row: Record<string, unknown>, prefix: string): UserRef | null {
  const id = row[`${prefix}_id`] as string | null | undefined;
  if (!id) return null;
  return { id, fullName: row[`${prefix}_name`] as string, role: row[`${prefix}_role`] as Role };
}

export function toSpecRef(id: string | null | undefined, name: string | null | undefined): SpecRef | null {
  return id && name ? { id, name } : null;
}

export const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : (d instanceof Date ? d : new Date(d)).toISOString();

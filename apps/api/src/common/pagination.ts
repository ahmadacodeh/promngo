import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 20;

/** وريثه DTOs القوائم: يضيف ?page=&pageSize= مع تحقق. */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

export function resolvePage(q: PageQueryDto): { page: number; pageSize: number; offset: number; limit: number } {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number): Paged<T> {
  return { items, total, page, pageSize };
}

/** يهرّب % و _ و \ في نص بحث ILIKE. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

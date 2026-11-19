import type { EntityManager } from 'typeorm';

type Q = Pick<EntityManager, 'query'>;

export type AuditEntity = 'TASK' | 'PROJECT' | 'DEPENDENCY' | 'USER' | 'AUDIT';

export interface AuditInput {
  companyId: string;
  entity: AuditEntity;
  entityId: string;
  taskId?: string | null;
  projectId?: string | null;
  type: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorId?: string | null;
  meta?: Record<string, unknown>;
}

const SECRET_KEY = /pass(word)?|token|secret|hash|authorization/i;

/** لا أسرار في سجل التدقيق (FR-012): نحذف أي مفتاح يشبه كلمة مرور/رمز/سر قبل الكتابة. */
export function scrubMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !SECRET_KEY.test(k)));
}

/** يكتب حدث تدقيق داخل المعاملة نفسها (فشل الكتابة يلغي العملية كلها: ذرية السجل والحالة). */
export async function recordAudit(m: Q, e: AuditInput): Promise<void> {
  await m.query(
    // clock_timestamp() لا NOW(): NOW() ثابت طوال المعاملة فيتساوى طابع أحداثها ويضيع ترتيبها (التسليم يكتب حدثين).
    `INSERT INTO audit_events (company_id, entity, entity_id, task_id, project_id, type, from_status, to_status, actor_id, meta, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, clock_timestamp())`,
    [e.companyId, e.entity, e.entityId, e.taskId ?? null, e.projectId ?? null, e.type, e.fromStatus ?? null, e.toStatus ?? null, e.actorId ?? null, JSON.stringify(scrubMeta(e.meta))],
  );
}

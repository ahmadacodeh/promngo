import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiException } from '../common/api-exception.js';
import type { AuthUser } from '../common/auth-user.js';
import { rowsOf } from '../common/db.js';
import { iso, toUserRef, toUserRefPrefixed, type UserRef } from '../common/mappers.js';
import { paged, resolvePage, type Paged } from '../common/pagination.js';
import { recordAudit } from '../work/audit.js';
import type { Row } from '../work/task-sql.js';
import { auditPeriodRange, inclusiveDayBounds, type AuditPeriod } from './audit-period.js';
import type { AuditEventsQuery, AuditReportsQuery } from './dto.js';

export interface AuditEventDto {
  id: string;
  type: string;
  entity: string;
  entityId: string;
  taskId: string | null;
  projectId: string | null;
  actor: UserRef | null;
  fromStatus: string | null;
  toStatus: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}
export interface AuditReport {
  period: AuditPeriod;
  from: string;
  to: string;
  totalEvents: number;
  byType: Record<string, number>;
  byActor: Array<{ actor: UserRef; count: number }>;
  statusChanges: number;
  reviews: { approved: number; changesRequested: number };
}
export interface SavedAuditReport {
  id: string;
  period: AuditPeriod;
  from: string;
  to: string;
  createdBy: UserRef;
  createdAt: string;
  payload: AuditReport;
}

/** أدنى مدة احتفاظ بالسجل (أيام): لا حذف لما هو أحدث. لا حذف تلقائي أبدًا؛ التنظيف يدوي من المدير التنفيذي. */
export const MIN_RETENTION_DAYS = 7;

@Injectable()
export class AuditService {
  constructor(private readonly ds: DataSource) {}

  async events(actor: AuthUser, q: AuditEventsQuery): Promise<Paged<AuditEventDto>> {
    if (q.from && q.to && q.to < q.from) {
      throw new ApiException(400, 'VALIDATION_FAILED', { fields: { to: 'تاريخ النهاية يجب ألا يسبق تاريخ البداية.' } });
    }
    const { page, pageSize, offset, limit } = resolvePage(q);
    const params: unknown[] = [actor.companyId];
    const where = ['e.company_id = $1'];
    if (q.type) where.push(`e.type = $${params.push(q.type)}`);
    if (q.taskId) where.push(`e.task_id = $${params.push(q.taskId)}`);
    if (q.actorId) where.push(`e.actor_id = $${params.push(q.actorId)}`);
    const b = inclusiveDayBounds(q.from, q.to);
    if (b.gte) where.push(`e.created_at >= $${params.push(b.gte)}`);
    if (b.lt) where.push(`e.created_at < $${params.push(b.lt)}`);
    const w = where.join(' AND ');
    const total = Number((await this.ds.query(`SELECT COUNT(*)::int AS n FROM audit_events e WHERE ${w}`, params))[0].n);
    const rows: Row[] = await this.ds.query(
      `SELECT e.id, e.type, e.entity, e.entity_id, e.task_id, e.project_id, e.from_status, e.to_status, e.meta, e.created_at,
              ac.id AS ac_id, ac.full_name AS ac_name, ac.role AS ac_role
         FROM audit_events e LEFT JOIN users ac ON ac.id = e.actor_id
        WHERE ${w} ORDER BY e.created_at DESC, e.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return paged(
      rows.map((r) => ({
        id: r.id, type: r.type, entity: r.entity, entityId: r.entity_id, taskId: r.task_id, projectId: r.project_id,
        actor: toUserRefPrefixed(r, 'ac'), fromStatus: r.from_status, toStatus: r.to_status, meta: r.meta, createdAt: iso(r.created_at)!,
      })),
      total,
      page,
      pageSize,
    );
  }

  async report(actor: AuthUser, period: AuditPeriod, date?: string): Promise<AuditReport> {
    const { from, to } = auditPeriodRange(period, date);
    const c = actor.companyId;
    const [types, actors, reviews] = await Promise.all([
      this.ds.query(`SELECT type, COUNT(*)::int AS n FROM audit_events WHERE company_id = $1 AND created_at >= $2 AND created_at < $3 GROUP BY type ORDER BY n DESC, type`, [c, from, to]) as Promise<Row[]>,
      this.ds.query(
        `SELECT u.id, u.full_name, u.role, COUNT(*)::int AS n FROM audit_events e JOIN users u ON u.id = e.actor_id
          WHERE e.company_id = $1 AND e.created_at >= $2 AND e.created_at < $3 GROUP BY u.id ORDER BY n DESC, u.full_name, u.id LIMIT 50`,
        [c, from, to],
      ) as Promise<Row[]>,
      this.ds.query(
        `SELECT COUNT(*) FILTER (WHERE meta->>'decision' = 'APPROVED')::int AS approved, COUNT(*) FILTER (WHERE meta->>'decision' = 'CHANGES_REQUESTED')::int AS changes
           FROM audit_events WHERE company_id = $1 AND type = 'REVIEW_DECISION' AND created_at >= $2 AND created_at < $3`,
        [c, from, to],
      ) as Promise<Row[]>,
    ]);
    const byType = Object.fromEntries(types.map((r) => [r.type, r.n]));
    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      totalEvents: types.reduce((s, r) => s + r.n, 0),
      byType,
      byActor: actors.map((r) => ({ actor: toUserRef({ id: r.id, full_name: r.full_name, role: r.role })!, count: r.n })),
      statusChanges: (byType.TASK_STATUS_CHANGED ?? 0) + (byType.PROJECT_STATUS_CHANGED ?? 0),
      reviews: { approved: reviews[0]!.approved, changesRequested: reviews[0]!.changes },
    };
  }

  async saveReport(actor: AuthUser, period: AuditPeriod, date?: string): Promise<SavedAuditReport> {
    const payload = await this.report(actor, period, date);
    const id = await this.ds.transaction(async (m) => {
      const row = (
        await m.query(`INSERT INTO audit_reports (company_id, period, period_from, period_to, payload, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`, [
          actor.companyId, period, payload.from, payload.to, JSON.stringify(payload), actor.id,
        ])
      )[0];
      await recordAudit(m, { companyId: actor.companyId, entity: 'AUDIT', entityId: row.id, type: 'AUDIT_REPORT_SAVED', actorId: actor.id, meta: { period, from: payload.from, to: payload.to } });
      return row.id as string;
    });
    return (await this.loadReports(actor.companyId, { id }))[0]!;
  }

  async listReports(actor: AuthUser, q: AuditReportsQuery): Promise<Paged<SavedAuditReport>> {
    const { page, pageSize, offset, limit } = resolvePage(q);
    const total = Number((await this.ds.query(`SELECT COUNT(*)::int AS n FROM audit_reports WHERE company_id = $1`, [actor.companyId]))[0].n);
    return paged(await this.loadReports(actor.companyId, { limit, offset }), total, page, pageSize);
  }

  private async loadReports(companyId: string, by: { id?: string; limit?: number; offset?: number }): Promise<SavedAuditReport[]> {
    const params: unknown[] = [companyId];
    let tail = '';
    if (by.id) tail = ` AND r.id = $${params.push(by.id)}`;
    const paging = by.id ? '' : ` LIMIT $${params.push(by.limit ?? 20)} OFFSET $${params.push(by.offset ?? 0)}`;
    const rows: Row[] = await this.ds.query(
      `SELECT r.id, r.period, r.period_from, r.period_to, r.payload, r.created_at, u.id AS u_id, u.full_name AS u_name, u.role AS u_role
         FROM audit_reports r JOIN users u ON u.id = r.created_by WHERE r.company_id = $1${tail} ORDER BY r.created_at DESC, r.id DESC${paging}`,
      params,
    );
    return rows.map((r) => ({ id: r.id, period: r.period, from: iso(r.period_from)!, to: iso(r.period_to)!, createdBy: toUserRefPrefixed(r, 'u')!, createdAt: iso(r.created_at)!, payload: r.payload }));
  }

  /** حذف يدوي للأحداث الأقدم من N يومًا (7–3650) داخل شركة المستدعي فقط؛ ويُسجَّل الحذف نفسه في السجل. */
  async purge(actor: AuthUser, olderThanDays: number): Promise<{ deleted: number }> {
    return this.ds.transaction(async (m) => {
      const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
      const del = rowsOf<{ id: string }>(await m.query(`DELETE FROM audit_events WHERE company_id = $1 AND created_at < $2 RETURNING id`, [actor.companyId, cutoff]));
      await recordAudit(m, { companyId: actor.companyId, entity: 'AUDIT', entityId: actor.companyId, type: 'AUDIT_EVENTS_PURGED', actorId: actor.id, meta: { olderThanDays, deleted: del.length, cutoff: cutoff.toISOString() } });
      return { deleted: del.length };
    });
  }
}

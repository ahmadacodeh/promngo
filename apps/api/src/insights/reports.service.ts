import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../common/auth-user.js';
import type { ProjectStatus, TaskStatus } from '../work/model.js';
import type { Row } from '../work/task-sql.js';

export interface ReportsOverview {
  period: { from: string; to: string; days: number };
  projects: { byStatus: Partial<Record<ProjectStatus, number>> };
  tasks: { byStatus: Partial<Record<TaskStatus, number>>; createdInPeriod: number; completedInPeriod: number; overdue: number };
  reviews: { approved: number; changesRequested: number; changesRequestRatePct: number | null; avgRoundsToApproval: number | null };
  perProject: Array<{ projectId: string; name: string; status: ProjectStatus; totalTasks: number; completedTasks: number; progressPct: number }>;
  perSpecialization: Array<{ specializationId: string | null; name: string; total: number; completed: number }>;
  definitions: Record<string, string>;
}

export const REPORT_DEFINITIONS: Record<string, string> = {
  progressPct: 'نسبة اكتمال المشروع = المهام الرئيسية المكتملة ÷ كل المهام الرئيسية غير المؤرشفة، مقرّبة لأقرب عدد صحيح (0 إن لم توجد مهام).',
  createdInPeriod: 'عدد المهام (رئيسية وفرعية، غير مؤرشفة) التي أُنشئت خلال الفترة المحددة.',
  completedInPeriod: 'عدد المهام التي سجّل لها النظام انتقالًا إلى «مكتملة» خلال الفترة (تُحسب كل مهمة مرة واحدة).',
  overdue: 'المهام غير المكتملة وغير المؤرشفة التي تجاوز تاريخ استحقاقها اليوم.',
  changesRequestRatePct: 'نسبة قرارات «طلب تعديل» من كل قرارات المراجعة في الفترة؛ فارغة إن لم تُتخذ قرارات.',
  avgRoundsToApproval: 'متوسط رقم دورة التسليم عند الموافقة (1 = وُوفق عليها من أول تسليم) للموافقات في الفترة؛ فارغ إن لم توجد.',
  perSpecialization: 'المهام الرئيسية غير المؤرشفة مجمّعة حسب تخصص المهمة؛ «بدون تخصص» للمهام التي لم يُحدَّد لها تخصص.',
};

const pct = (num: number, den: number): number => (den === 0 ? 0 : Math.round((num / den) * 100));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** تقارير الشركة الكاملة (المدير التنفيذي ومدير المشروع فقط؛ يفرض الدور في المتحكّم). */
@Injectable()
export class ReportsService {
  constructor(private readonly ds: DataSource) {}

  async overview(actor: AuthUser, days = 30, now: Date = new Date()): Promise<ReportsOverview> {
    const from = new Date(now.getTime() - days * 86_400_000);
    const c = actor.companyId;
    const [projectRows, statusRows, created, completed, reviewRows, perProject, perSpec] = await Promise.all([
      this.ds.query(`SELECT status, COUNT(*)::int AS n FROM projects WHERE company_id = $1 GROUP BY status`, [c]) as Promise<Row[]>,
      this.ds.query(
        `SELECT status, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status <> 'COMPLETED')::int AS overdue
           FROM tasks WHERE company_id = $1 AND archived_at IS NULL GROUP BY status`,
        [c],
      ) as Promise<Row[]>,
      this.ds.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE company_id = $1 AND archived_at IS NULL AND created_at >= $2 AND created_at < $3`, [c, from, now]) as Promise<Row[]>,
      this.ds.query(
        `SELECT COUNT(DISTINCT task_id)::int AS n FROM audit_events
          WHERE company_id = $1 AND type = 'TASK_STATUS_CHANGED' AND to_status = 'COMPLETED' AND task_id IS NOT NULL AND created_at >= $2 AND created_at < $3`,
        [c, from, now],
      ) as Promise<Row[]>,
      this.ds.query(
        `SELECT COUNT(*) FILTER (WHERE decision = 'APPROVED')::int AS approved,
                COUNT(*) FILTER (WHERE decision = 'CHANGES_REQUESTED')::int AS changes,
                AVG(round) FILTER (WHERE decision = 'APPROVED')::float AS avg_rounds
           FROM review_records WHERE company_id = $1 AND reviewed_at >= $2 AND reviewed_at < $3`,
        [c, from, now],
      ) as Promise<Row[]>,
      this.ds.query(
        `SELECT p.id, p.name, p.status, COUNT(t.id)::int AS total, COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::int AS done
           FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.company_id = p.company_id AND t.parent_task_id IS NULL AND t.archived_at IS NULL
          WHERE p.company_id = $1 GROUP BY p.id ORDER BY p.name, p.id`,
        [c],
      ) as Promise<Row[]>,
      this.ds.query(
        `SELECT t.specialization_id, COALESCE(s.name, 'بدون تخصص') AS name, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE t.status = 'COMPLETED')::int AS done
           FROM tasks t LEFT JOIN specializations s ON s.id = t.specialization_id
          WHERE t.company_id = $1 AND t.parent_task_id IS NULL AND t.archived_at IS NULL GROUP BY t.specialization_id, s.name ORDER BY (t.specialization_id IS NULL), s.name`,
        [c],
      ) as Promise<Row[]>,
    ]);

    const byStatus: Partial<Record<TaskStatus, number>> = {};
    let overdue = 0;
    for (const r of statusRows) {
      byStatus[r.status as TaskStatus] = r.n;
      overdue += r.overdue;
    }
    const approved = reviewRows[0]!.approved as number;
    const changes = reviewRows[0]!.changes as number;
    const decisions = approved + changes;
    return {
      period: { from: from.toISOString(), to: now.toISOString(), days },
      projects: { byStatus: Object.fromEntries(projectRows.map((r) => [r.status, r.n])) },
      tasks: { byStatus, createdInPeriod: created[0]!.n, completedInPeriod: completed[0]!.n, overdue },
      reviews: {
        approved,
        changesRequested: changes,
        changesRequestRatePct: decisions === 0 ? null : round1((changes / decisions) * 100),
        avgRoundsToApproval: reviewRows[0]!.avg_rounds === null ? null : round1(reviewRows[0]!.avg_rounds),
      },
      perProject: perProject.map((r) => ({ projectId: r.id, name: r.name, status: r.status, totalTasks: r.total, completedTasks: r.done, progressPct: pct(r.done, r.total) })),
      perSpecialization: perSpec.map((r) => ({ specializationId: r.specialization_id, name: r.name, total: r.total, completed: r.done })),
      definitions: REPORT_DEFINITIONS,
    };
  }
}

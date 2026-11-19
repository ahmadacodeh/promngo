import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isManager, type AuthUser, type Role } from '../common/auth-user.js';
import type { Priority, ProjectStatus, TaskStatus } from '../work/model.js';
import { SUBTASK_COUNT_COLUMNS, TASK_COLUMNS, TASK_FROM, projectVisibilitySql, rowToTaskListItem, taskVisibilitySql, type Row, type TaskListItem } from '../work/task-sql.js';

export interface DashboardResponse {
  role: Role;
  scope: 'COMPANY' | 'PERSONAL';
  projects: { total: number; byStatus: Partial<Record<ProjectStatus, number>> };
  tasks: { total: number; byStatus: Partial<Record<TaskStatus, number>>; byPriority: Partial<Record<Priority, number>>; overdue: number };
  myOpenTasks: number;
  awaitingMyReview: number;
  flaggedForReview: number;
  recentTasks: TaskListItem[];
  awaitingReviewTasks: TaskListItem[];
}

const LIST_LIMIT = 8;

/** كل الأرقام مقيّدة بما يراه المستدعي (رؤية المهام والمشاريع نفسها في بقية الواجهات): لا تسريب لأعداد ما لا يراه. */
@Injectable()
export class DashboardService {
  constructor(private readonly ds: DataSource) {}

  async get(actor: AuthUser): Promise<DashboardResponse> {
    const pp: unknown[] = [actor.companyId];
    const pv = projectVisibilitySql(actor, 'p', pp);
    // PostgreSQL يرفض معاملًا غير مستعمل: كل استعلام يبني معاملاته بنفسه.
    const tp: unknown[] = [actor.companyId];
    const tv = taskVisibilitySql(actor, 't', tp);
    const mp: unknown[] = [actor.companyId, actor.id];
    const mv = taskVisibilitySql(actor, 't', mp);

    const [projectRows, taskRows, mine, recent, awaiting] = await Promise.all([
      this.ds.query(`SELECT p.status, COUNT(*)::int AS n FROM projects p WHERE p.company_id = $1 AND ${pv} GROUP BY p.status`, pp) as Promise<Row[]>,
      this.ds.query(
        `SELECT t.status, t.priority, COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status <> 'COMPLETED')::int AS overdue
           FROM tasks t WHERE t.company_id = $1 AND t.archived_at IS NULL AND ${tv} GROUP BY t.status, t.priority`,
        tp,
      ) as Promise<Row[]>,
      this.ds.query(
        `SELECT COUNT(*) FILTER (WHERE t.assigned_to = $2 AND t.status <> 'COMPLETED')::int AS my_open,
                COUNT(*) FILTER (WHERE t.reviewer_id = $2 AND t.assigned_to IS DISTINCT FROM $2 AND t.status = 'UNDER_REVIEW')::int AS awaiting,
                COUNT(*) FILTER (WHERE t.needs_review)::int AS flagged
           FROM tasks t WHERE t.company_id = $1 AND t.archived_at IS NULL AND ${mv}`,
        mp,
      ) as Promise<Row[]>,
      this.list(actor, 'recent'),
      this.list(actor, 'awaiting'),
    ]);

    const byStatus: Partial<Record<TaskStatus, number>> = {};
    const byPriority: Partial<Record<Priority, number>> = {};
    let total = 0;
    let overdue = 0;
    for (const r of taskRows) {
      total += r.n;
      overdue += r.overdue;
      byStatus[r.status as TaskStatus] = (byStatus[r.status as TaskStatus] ?? 0) + r.n;
      byPriority[r.priority as Priority] = (byPriority[r.priority as Priority] ?? 0) + r.n;
    }
    const projectsByStatus: Partial<Record<ProjectStatus, number>> = {};
    let projectsTotal = 0;
    for (const r of projectRows) {
      projectsByStatus[r.status as ProjectStatus] = r.n;
      projectsTotal += r.n;
    }
    return {
      role: actor.role,
      scope: isManager(actor.role) ? 'COMPANY' : 'PERSONAL',
      projects: { total: projectsTotal, byStatus: projectsByStatus },
      tasks: { total, byStatus, byPriority, overdue },
      myOpenTasks: mine[0]!.my_open,
      awaitingMyReview: mine[0]!.awaiting,
      flaggedForReview: mine[0]!.flagged,
      recentTasks: recent,
      awaitingReviewTasks: awaiting,
    };
  }

  /**
   * قائمة مختصرة بالرؤية نفسها. recent: الأحدث تحديثًا. awaiting: UNDER_REVIEW — للمدراء كلها (الأقدم انتظارًا أولًا)،
   * ولغيرهم ما هم مراجعوه فقط (المكلّف لا يراجع عمله).
   */
  private async list(actor: AuthUser, kind: 'recent' | 'awaiting'): Promise<TaskListItem[]> {
    const params: unknown[] = [actor.companyId];
    const vis = taskVisibilitySql(actor, 't', params);
    let extra = '';
    if (kind === 'awaiting') {
      extra = ` AND t.status = 'UNDER_REVIEW'`;
      if (!isManager(actor.role)) {
        const i = params.push(actor.id);
        extra += ` AND t.reviewer_id = $${i} AND t.assigned_to IS DISTINCT FROM $${i}`;
      }
    }
    const order = kind === 'recent' ? 't.updated_at DESC, t.id' : 't.updated_at ASC, t.id';
    const rows: Row[] = await this.ds.query(
      `SELECT ${TASK_COLUMNS}, ${SUBTASK_COUNT_COLUMNS} ${TASK_FROM}
        WHERE t.company_id = $1 AND t.archived_at IS NULL AND ${vis}${extra} ORDER BY ${order} LIMIT ${LIST_LIMIT}`,
      params,
    );
    return rows.map(rowToTaskListItem);
  }
}

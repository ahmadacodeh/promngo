import type { EntityManager } from 'typeorm';
import type { AuthUser } from '../common/auth-user.js';
import { isManager } from '../common/auth-user.js';
import { iso, toSpecRef, type SpecRef, type UserRef } from '../common/mappers.js';
import type { Priority, ProjectStatus, TaskStatus } from './model.js';
import type { PolicyContext, PolicyTask } from './policy.js';
import { rowsOf } from '../common/db.js';

type Q = Pick<EntityManager, 'query'>;
// oxlint-disable-next-line typescript/no-explicit-any -- صفوف pg غير مصنّفة النوع
export type Row = Record<string, any>;

export interface TaskDto {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  isRequired: boolean;
  priority: Priority;
  dueDate: string | null;
  isOverdue: boolean;
  specialization: SpecRef | null;
  createdBy: UserRef;
  assignedManager: UserRef | null;
  assignedTo: UserRef | null;
  reviewer: UserRef | null;
  needsReview: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface TaskListItem extends TaskDto {
  projectName: string;
  subtaskCount: number;
  completedSubtaskCount: number;
}

/**
 * «متأخرة»: لها تاريخ استحقاق مضى (اليوم نفسه ليس تأخرًا)، وليست مكتملة ولا مؤرشفة. مصدر واحد للعمود وللفلتر
 * `overdue=true` حتى لا يختلفا (المؤرشفة كانت تظهر في الفلتر ولا يظهر عمودها متأخرًا).
 */
export const IS_OVERDUE_SQL = `(t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE AND t.status <> 'COMPLETED' AND t.archived_at IS NULL)`;

/** كل ما تحتاجه خريطة TaskDto + قرار الصلاحيات في استعلام واحد. */
export const TASK_COLUMNS = `t.id, t.company_id, t.project_id, t.parent_task_id, t.title, t.description, t.status, t.is_required, t.priority,
  to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
  ${IS_OVERDUE_SQL} AS is_overdue,
  t.needs_review, t.archived_at, t.created_at, t.updated_at,
  t.created_by, t.assigned_manager_id, t.assigned_to, t.reviewer_id, t.specialization_id,
  sp.name AS sp_name,
  cb.full_name AS cb_name, cb.role AS cb_role,
  am.full_name AS am_name, am.role AS am_role,
  asg.full_name AS asg_name, asg.role AS asg_role,
  rv.full_name AS rv_name, rv.role AS rv_role,
  p.name AS project_name, p.status AS project_status`;

export const TASK_FROM = `FROM tasks t
  JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
  JOIN users cb ON cb.id = t.created_by
  LEFT JOIN users am ON am.id = t.assigned_manager_id
  LEFT JOIN users asg ON asg.id = t.assigned_to
  LEFT JOIN users rv ON rv.id = t.reviewer_id
  LEFT JOIN specializations sp ON sp.id = t.specialization_id`;

export const SUBTASK_COUNT_COLUMNS = `(SELECT COUNT(*)::int FROM tasks c WHERE c.parent_task_id = t.id AND c.archived_at IS NULL) AS subtask_count,
  (SELECT COUNT(*)::int FROM tasks c WHERE c.parent_task_id = t.id AND c.archived_at IS NULL AND c.status = 'COMPLETED') AS completed_subtask_count`;

const ref = (id: string | null, name: string | null, role: string | null): UserRef | null =>
  id ? { id, fullName: name as string, role: role as UserRef['role'] } : null;

export function rowToTask(r: Row): TaskDto {
  return {
    id: r.id,
    projectId: r.project_id,
    parentTaskId: r.parent_task_id,
    title: r.title,
    description: r.description,
    status: r.status,
    isRequired: r.is_required,
    priority: r.priority,
    dueDate: r.due_date,
    isOverdue: r.is_overdue,
    specialization: toSpecRef(r.specialization_id, r.sp_name),
    createdBy: ref(r.created_by, r.cb_name, r.cb_role)!,
    assignedManager: ref(r.assigned_manager_id, r.am_name, r.am_role),
    assignedTo: ref(r.assigned_to, r.asg_name, r.asg_role),
    reviewer: ref(r.reviewer_id, r.rv_name, r.rv_role),
    needsReview: r.needs_review,
    archivedAt: iso(r.archived_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

export function rowToTaskListItem(r: Row): TaskListItem {
  return { ...rowToTask(r), projectName: r.project_name, subtaskCount: r.subtask_count, completedSubtaskCount: r.completed_subtask_count };
}

export function rowToPolicyTask(r: Row): PolicyTask {
  return {
    status: r.status,
    parentTaskId: r.parent_task_id,
    createdBy: r.created_by,
    assignedManagerId: r.assigned_manager_id,
    assignedTo: r.assigned_to,
    reviewerId: r.reviewer_id,
    archived: r.archived_at !== null,
    projectStatus: r.project_status as ProjectStatus,
  };
}

/**
 * شرط رؤية المهام لغير المدراء (يُضاف إلى WHERE مع t.company_id = شركة المستخدم).
 * المدراء (المدير التنفيذي/مدير المشروع) يرون كل مهام شركتهم.
 */
export function taskVisibilitySql(actor: AuthUser, alias: string, params: unknown[]): string {
  if (isManager(actor.role)) return 'TRUE';
  const i = params.push(actor.id);
  return `(${alias}.created_by = $${i} OR ${alias}.assigned_to = $${i} OR ${alias}.reviewer_id = $${i} OR ${alias}.assigned_manager_id = $${i})`;
}

/** رؤية مشروع: المدراء كل المشاريع؛ غيرهم ما أنشؤوه أو فيه مهمة تخصهم. */
export function projectVisibilitySql(actor: AuthUser, alias: string, params: unknown[]): string {
  if (isManager(actor.role)) return 'TRUE';
  const i = params.push(actor.id);
  return `(${alias}.created_by = $${i} OR EXISTS (
    SELECT 1 FROM tasks vt WHERE vt.project_id = ${alias}.id AND vt.company_id = ${alias}.company_id AND vt.archived_at IS NULL
      AND (vt.created_by = $${i} OR vt.assigned_to = $${i} OR vt.reviewer_id = $${i} OR vt.assigned_manager_id = $${i})))`;
}

/** يحمّل صف مهمة (ضمن شركة المستخدم فقط). `lock` يقفل صف المهمة داخل المعاملة. */
export async function loadTaskRow(m: Q, companyId: string, id: string, lock = false): Promise<Row | undefined> {
  const rows = await m.query(`SELECT ${TASK_COLUMNS}, ${SUBTASK_COUNT_COLUMNS} ${TASK_FROM} WHERE t.id = $1 AND t.company_id = $2${lock ? ' FOR UPDATE OF t' : ''}`, [id, companyId]);
  return rows[0];
}

export async function loadPolicyContext(m: Q, taskId: string): Promise<PolicyContext> {
  const r = (
    await m.query(
      `SELECT
         (SELECT COUNT(*)::int FROM task_dependencies d JOIN tasks pr ON pr.id = d.predecessor_task_id
            WHERE d.successor_task_id = $1 AND pr.status <> 'COMPLETED' AND pr.archived_at IS NULL) AS blocked_by,
         EXISTS (SELECT 1 FROM task_dependencies d WHERE d.predecessor_task_id = $1 OR d.successor_task_id = $1) AS has_deps,
         EXISTS (SELECT 1 FROM task_submissions s WHERE s.task_id = $1) AS has_subs`,
      [taskId],
    )
  )[0];
  return { blockedByCount: r.blocked_by, hasDependencies: r.has_deps, hasSubmissions: r.has_subs };
}

/** السوابق غير المكتملة (تمنع بدء اللاحقة). */
export async function loadBlockedBy(m: Q, taskId: string): Promise<Array<{ id: string; title: string; status: TaskStatus }>> {
  return m.query(
    `SELECT pr.id, pr.title, pr.status FROM task_dependencies d JOIN tasks pr ON pr.id = d.predecessor_task_id
      WHERE d.successor_task_id = $1 AND pr.status <> 'COMPLETED' AND pr.archived_at IS NULL ORDER BY pr.title, pr.id`,
    [taskId],
  );
}

/**
 * يُعلّم اللاحقات التي بدأ عملها بأنها تحتاج مراجعة (FR-010) ويُرجع أرقامها لتسجيل حدث لكل منها.
 * لا يحذف شيئًا. يُستدعى داخل معاملة المستدعي.
 */
export async function flagStartedSuccessors(m: Q, companyId: string, predecessorId: string): Promise<Array<{ id: string; projectId: string }>> {
  const rows = rowsOf<{ id: string; project_id: string }>(
    await m.query(
    `UPDATE tasks s SET needs_review = TRUE
       FROM task_dependencies d
      WHERE d.predecessor_task_id = $1 AND d.successor_task_id = s.id AND s.company_id = $2
        AND s.status IN ('IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED')
        AND s.archived_at IS NULL AND s.needs_review = FALSE
      RETURNING s.id, s.project_id`,
    [predecessorId, companyId],
  ));
  return rows.map((r) => ({ id: r.id, projectId: r.project_id }));
}

import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ApiException, forbidden, notFound } from '../common/api-exception.js';
import { isManager, type AuthUser } from '../common/auth-user.js';
import { iso, toUserRefPrefixed, type UserRef } from '../common/mappers.js';
import { escapeLike, paged, resolvePage, type Paged } from '../common/pagination.js';
import { recordAudit } from '../work/audit.js';
import {
  STARTED_STATUSES,
  isAllowedTransition,
  isManualTransition,
  isProjectClosed,
  type ProjectStatus,
  type TaskStatus,
} from '../work/model.js';
import { canSeeTask, isAssignedManager, taskCapabilities, type TaskCan } from '../work/policy.js';
import {
  SUBTASK_COUNT_COLUMNS,
  TASK_COLUMNS,
  TASK_FROM,
  flagStartedSuccessors,
  loadBlockedBy,
  loadPolicyContext,
  loadTaskRow,
  projectVisibilitySql,
  rowToPolicyTask,
  rowToTask,
  rowToTaskListItem,
  taskVisibilitySql,
  type Row,
  type TaskDto,
  type TaskListItem,
} from '../work/task-sql.js';
import type { CreateTaskDto, ListTasksQuery, TransitionDto, UpdateTaskDto } from './dto.js';
import { rowsOf } from '../common/db.js';

type Q = Pick<EntityManager, 'query'>;

export interface DependencyDto {
  id: string;
  projectId: string;
  predecessor: { id: string; title: string; status: TaskStatus };
  successor: { id: string; title: string; status: TaskStatus };
  dependencyType: 'FINISH_TO_START_WITH_ACCEPTANCE';
  createdAt: string;
}
export interface TaskDetail extends TaskDto {
  project: { id: string; name: string; status: ProjectStatus };
  parent: { id: string; title: string } | null;
  subtasks: TaskDto[];
  predecessors: DependencyDto[];
  successors: DependencyDto[];
  blockedBy: Array<{ id: string; title: string; status: TaskStatus }>;
  allowedNext: TaskStatus[];
  can: TaskCan;
}
export interface TaskEventDto {
  id: string;
  taskId: string | null;
  type: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  actor: UserRef | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** الحقول التي يفحصها assertPeople فقط (undefined = لم يتغير، null = مسح). */
interface PeopleInput {
  assignedManagerId?: string | null;
  assignedToId?: string | null;
  reviewerId?: string | null;
  specializationId?: string | null;
}

const PRIORITY_RANK_SQL =`CASE t.priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END`;
const SORT_SQL: Record<string, string> = {
  updatedAt: 't.updated_at',
  createdAt: 't.created_at',
  dueDate: 't.due_date',
  priority: PRIORITY_RANK_SQL,
  title: 't.title',
  status: `array_position(ARRAY['PLANNED','BLOCKED','ASSIGNED','IN_PROGRESS','SUBMITTED','UNDER_REVIEW','CHANGES_REQUESTED','COMPLETED'], t.status::text)`,
};

/** حقول تغيّرها يُعلّم اللاحقات التي بدأ عملها (FR-010). */
const CONTENT_FIELDS = ['title', 'description', 'isRequired', 'specializationId', 'assignedToId'] as const;

@Injectable()
export class TasksService {
  constructor(private readonly ds: DataSource) {}

  // ───────────────────────── القوائم ─────────────────────────

  async list(actor: AuthUser, q: ListTasksQuery, fixedProjectId?: string): Promise<Paged<TaskListItem>> {
    const { page, pageSize, offset, limit } = resolvePage(q);
    if (fixedProjectId) {
      // مشروع غير موجود/غير مرئي ← 404 كبقية مسارات المشروع (لا صفحة فارغة توحي بوجوده).
      const pp: unknown[] = [fixedProjectId, actor.companyId];
      const visible = await this.ds.query(`SELECT 1 FROM projects p WHERE p.id = $1 AND p.company_id = $2 AND ${projectVisibilitySql(actor, 'p', pp)}`, pp);
      if (visible.length === 0) throw notFound();
    }
    const params: unknown[] = [actor.companyId];
    const where = ['t.company_id = $1', taskVisibilitySql(actor, 't', params)];
    const projectId = fixedProjectId ?? q.projectId;
    if (projectId) where.push(`t.project_id = $${params.push(projectId)}`);
    if (!q.includeArchived) where.push('t.archived_at IS NULL');
    const scope = q.scope ?? 'all';
    if (scope === 'mine') where.push(`t.assigned_to = $${params.push(actor.id)}`);
    if (scope === 'review') where.push(`t.reviewer_id = $${params.push(actor.id)} AND t.status = 'UNDER_REVIEW'`);
    if (q.status?.length) where.push(`t.status = ANY($${params.push(q.status)})`);
    if (q.priority?.length) where.push(`t.priority = ANY($${params.push(q.priority)})`);
    if (q.assigneeId) where.push(`t.assigned_to = $${params.push(q.assigneeId)}`);
    if (q.parentOnly) where.push('t.parent_task_id IS NULL');
    if (q.overdue) where.push(`t.due_date < CURRENT_DATE AND t.status <> 'COMPLETED'`);
    if (q.needsReview !== undefined) where.push(`t.needs_review = $${params.push(q.needsReview)}`);
    if (q.q?.trim()) where.push(`t.title ILIKE $${params.push(`%${escapeLike(q.q.trim())}%`)} ESCAPE '\\'`);
    const w = where.join(' AND ');

    const total = Number((await this.ds.query(`SELECT COUNT(*)::int AS n FROM tasks t WHERE ${w}`, params))[0].n);
    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    const sort = q.sort ?? 'updatedAt';
    const nulls = sort === 'dueDate' ? ' NULLS LAST' : '';
    const rows = await this.ds.query(
      `SELECT ${TASK_COLUMNS}, ${SUBTASK_COUNT_COLUMNS} ${TASK_FROM} WHERE ${w}
        ORDER BY ${SORT_SQL[sort]} ${dir}${nulls}, t.updated_at DESC, t.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return paged(rows.map(rowToTaskListItem), total, page, pageSize);
  }

  // ───────────────────────── التفاصيل ─────────────────────────

  /** المهمة غير الموجودة أو غير المرئية ← 404 دائمًا (لا تسريب لوجودها). */
  async getDetail(actor: AuthUser, id: string, m: Q = this.ds): Promise<TaskDetail> {
    const row = await loadTaskRow(m, actor.companyId, id);
    if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
    return this.buildDetail(m, actor, row);
  }

  private async buildDetail(m: Q, actor: AuthUser, row: Row): Promise<TaskDetail> {
    const ctx = await loadPolicyContext(m, row.id);
    const { can, allowedNext } = taskCapabilities(actor, rowToPolicyTask(row), ctx);
    const subParams: unknown[] = [row.id, actor.companyId];
    const subVis = taskVisibilitySql(actor, 't', subParams);
    const [subRows, preds, succs, blockedBy, parent] = await Promise.all([
      m.query(`SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE t.parent_task_id = $1 AND t.company_id = $2 AND t.archived_at IS NULL AND ${subVis} ORDER BY t.created_at, t.id`, subParams),
      this.loadDependencies(m, row.id, 'successor'),
      this.loadDependencies(m, row.id, 'predecessor'),
      loadBlockedBy(m, row.id),
      row.parent_task_id ? m.query(`SELECT id, title FROM tasks WHERE id = $1 AND company_id = $2`, [row.parent_task_id, actor.companyId]) : Promise.resolve([]),
    ]);
    return {
      ...rowToTask(row),
      project: { id: row.project_id, name: row.project_name, status: row.project_status },
      parent: parent[0] ? { id: parent[0].id, title: parent[0].title } : null,
      subtasks: (subRows as Row[]).map(rowToTask),
      predecessors: preds,
      successors: succs,
      blockedBy,
      allowedNext,
      can,
    };
  }

  /** side='successor': اعتماديات هذه المهمة لاحقة فيها (سوابقها). side='predecessor': هي سابقة فيها (لاحقاتها). */
  private async loadDependencies(m: Q, taskId: string, side: 'successor' | 'predecessor'): Promise<DependencyDto[]> {
    const col = side === 'successor' ? 'd.successor_task_id' : 'd.predecessor_task_id';
    const rows: Row[] = await m.query(
      `SELECT d.id, d.project_id, d.dependency_type, d.created_at,
              pr.id AS pr_id, pr.title AS pr_title, pr.status AS pr_status,
              su.id AS su_id, su.title AS su_title, su.status AS su_status
         FROM task_dependencies d JOIN tasks pr ON pr.id = d.predecessor_task_id JOIN tasks su ON su.id = d.successor_task_id
        WHERE ${col} = $1 ORDER BY d.created_at, d.id`,
      [taskId],
    );
    return rows.map(rowToDependency);
  }

  async events(actor: AuthUser, id: string): Promise<TaskEventDto[]> {
    await this.getDetailLite(actor, id);
    const rows: Row[] = await this.ds.query(
      `SELECT e.id, e.task_id, e.type, e.from_status, e.to_status, e.meta, e.created_at,
              e.actor_id AS ac_id, ac.full_name AS ac_name, ac.role AS ac_role
         FROM audit_events e LEFT JOIN users ac ON ac.id = e.actor_id
        WHERE e.company_id = $1 AND e.task_id = $2 ORDER BY e.created_at, e.id`,
      [actor.companyId, id],
    );
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      type: r.type,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      actor: toUserRefPrefixed(r, 'ac'),
      meta: r.meta,
      createdAt: iso(r.created_at)!,
    }));
  }

  private async getDetailLite(actor: AuthUser, id: string): Promise<Row> {
    const row = await loadTaskRow(this.ds, actor.companyId, id);
    if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
    return row;
  }

  // ───────────────────────── الإنشاء ─────────────────────────

  async createMain(actor: AuthUser, projectId: string, dto: CreateTaskDto): Promise<TaskDetail> {
    const id = await this.ds.transaction(async (m) => {
      const project = await this.lockProject(m, actor, projectId);
      await this.assertPeople(m, actor.companyId, dto, {});
      return this.insertTask(m, actor, project.id, null, dto);
    });
    return this.getDetail(actor, id);
  }

  async createSubtask(actor: AuthUser, projectId: string, parentId: string, dto: CreateTaskDto): Promise<TaskDetail> {
    const id = await this.ds.transaction(async (m) => {
      const project = await this.lockProject(m, actor, projectId);
      const parent = (await m.query(`SELECT id, parent_task_id, status, archived_at, assigned_manager_id, created_by, assigned_to, reviewer_id FROM tasks WHERE id = $1 AND company_id = $2 AND project_id = $3 FOR SHARE`, [parentId, actor.companyId, projectId]))[0] as Row | undefined;
      if (!parent || !canSeeTask(actor, { createdBy: parent.created_by, assignedManagerId: parent.assigned_manager_id, assignedTo: parent.assigned_to, reviewerId: parent.reviewer_id })) throw notFound();
      if (!isManager(actor.role) && !isAssignedManager(actor, { assignedManagerId: parent.assigned_manager_id })) throw forbidden();
      if (parent.parent_task_id) throw new ApiException(409, 'SUBTASK_DEPTH');
      if (parent.archived_at || parent.status === 'COMPLETED') {
        throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكن إضافة مهمة فرعية لمهمة مكتملة أو مؤرشفة.' });
      }
      await this.assertPeople(m, actor.companyId, dto, {});
      return this.insertTask(m, actor, project.id, parentId, dto);
    });
    return this.getDetail(actor, id);
  }

  /** يقفل المشروع (FOR SHARE) فلا يكتمل/يُغلق بالتوازي مع إنشاء مهمة فيه. */
  private async lockProject(m: Q, actor: AuthUser, projectId: string): Promise<{ id: string; status: ProjectStatus }> {
    const p = (await m.query(`SELECT id, status FROM projects WHERE id = $1 AND company_id = $2 FOR SHARE`, [projectId, actor.companyId]))[0] as { id: string; status: ProjectStatus } | undefined;
    if (!p) throw notFound();
    if (isProjectClosed(p.status)) throw new ApiException(409, 'PROJECT_CLOSED');
    return p;
  }

  private async insertTask(m: Q, actor: AuthUser, projectId: string, parentId: string | null, dto: CreateTaskDto): Promise<string> {
    const row = (
      await m.query(
        `INSERT INTO tasks (company_id, project_id, parent_task_id, title, description, created_by, assigned_manager_id, assigned_to, reviewer_id,
                            specialization_id, is_required, priority, due_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'MEDIUM'), $13) RETURNING id`,
        [
          actor.companyId, projectId, parentId, dto.title, dto.description ?? null, actor.id,
          dto.assignedManagerId ?? null, dto.assignedToId ?? null, dto.reviewerId ?? null,
          dto.specializationId ?? null, dto.isRequired ?? true, dto.priority ?? null, dto.dueDate ?? null,
        ],
      )
    )[0];
    await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: row.id, taskId: row.id, projectId, type: 'TASK_CREATED', toStatus: 'PLANNED', actorId: actor.id, meta: { title: dto.title, subtask: parentId !== null, priority: dto.priority ?? 'MEDIUM' } });
    return row.id as string;
  }

  // ───────────────────────── التعديل ─────────────────────────

  async update(actor: AuthUser, id: string, dto: UpdateTaskDto): Promise<TaskDetail> {
    const keys = ['title', 'description', 'isRequired', 'priority', 'dueDate', 'specializationId', 'assignedManagerId', 'assignedToId', 'reviewerId'] as const;
    const touched = keys.filter((k) => dto[k] !== undefined);
    if (touched.length === 0) {
      throw new ApiException(400, 'VALIDATION_FAILED', { message: 'لم تُرسل أي بيانات للتعديل.', hint: 'أرسل حقلًا واحدًا على الأقل.' });
    }
    await this.ds.transaction(async (m) => {
      const row = await loadTaskRow(m, actor.companyId, id, true);
      if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
      if (isProjectClosed(row.project_status)) throw new ApiException(409, 'PROJECT_CLOSED');
      const ctx = await loadPolicyContext(m, id);
      const { can } = taskCapabilities(actor, rowToPolicyTask(row), ctx);
      // المدير المختص المعيّن يعدّل المكلّف والمراجع فقط؛ المدراء كل الحقول.
      const peopleOnly: ReadonlyArray<(typeof keys)[number]> = ['assignedToId', 'reviewerId'];
      const allowed = can.edit || (can.assign && touched.every((k) => peopleOnly.includes(k)));
      if (!allowed) throw forbidden();
      if (row.archived_at) throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكن تعديل مهمة مؤرشفة.' });
      if (row.status === 'COMPLETED') throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكن تعديل مهمة مكتملة.', hint: 'المهام المكتملة للقراءة فقط.' });
      if (dto.assignedToId !== undefined && dto.assignedToId !== row.assigned_to && STARTED_STATUSES.includes(row.status)) {
        throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكن تغيير المكلّف بعد بدء التنفيذ.', hint: 'يُغيَّر المكلّف قبل أن تبدأ المهمة.' });
      }

      await this.assertPeople(m, actor.companyId, dto, { current: row });

      const sets: string[] = [];
      const params: unknown[] = [id, actor.companyId];
      const add = (col: string, v: unknown): void => void sets.push(`${col} = $${params.push(v)}`);
      if (dto.title !== undefined) add('title', dto.title);
      if (dto.description !== undefined) add('description', dto.description);
      if (dto.isRequired !== undefined) add('is_required', dto.isRequired);
      if (dto.priority !== undefined) add('priority', dto.priority);
      if (dto.dueDate !== undefined) add('due_date', dto.dueDate);
      if (dto.specializationId !== undefined) add('specialization_id', dto.specializationId);
      if (dto.assignedManagerId !== undefined) add('assigned_manager_id', dto.assignedManagerId);
      if (dto.assignedToId !== undefined) add('assigned_to', dto.assignedToId);
      if (dto.reviewerId !== undefined) add('reviewer_id', dto.reviewerId);
      await m.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`, params);

      await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: id, taskId: id, projectId: row.project_id, type: 'TASK_UPDATED', actorId: actor.id, meta: { fields: touched } });
      if (CONTENT_FIELDS.some((f) => dto[f] !== undefined)) await this.flagSuccessors(m, actor, id, row.project_id, 'PREDECESSOR_EDITED');
    });
    return this.getDetail(actor, id);
  }

  /** يعلّم اللاحقات التي بدأت للمراجعة ويكتب حدث DEPENDENCY_PREDECESSOR_CHANGED لكل منها (لا يحذف شيئًا). */
  private async flagSuccessors(m: Q, actor: AuthUser, predecessorId: string, projectId: string, reason: string): Promise<void> {
    const flagged = await flagStartedSuccessors(m, actor.companyId, predecessorId);
    for (const s of flagged) {
      await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: s.id, taskId: s.id, projectId: s.projectId || projectId, type: 'DEPENDENCY_PREDECESSOR_CHANGED', actorId: actor.id, meta: { predecessorId, reason } });
    }
  }

  /**
   * تحقق الأشخاص والتخصص. `dto` هو ما يُراد تغييره؛ `current` صف المهمة الحالي (للتعديل) لتقييم القيم النهائية معًا.
   * 400: مستخدم غير موجود/غير نشط/دور غير صالح. 409: REVIEWER_NOT_ELIGIBLE وSPECIALIZATION_MISMATCH.
   */
  private async assertPeople(m: Q, companyId: string, dto: PeopleInput, opts: { current?: Row }): Promise<void> {
    const cur = opts.current;
    const pick = <T>(next: T | null | undefined, now: T | null | undefined): T | null => (next !== undefined ? (next ?? null) : (now ?? null));
    const final = {
      assignedManagerId: pick(dto.assignedManagerId, cur?.assigned_manager_id),
      assignedToId: pick(dto.assignedToId, cur?.assigned_to),
      reviewerId: pick(dto.reviewerId, cur?.reviewer_id),
      specializationId: pick(dto.specializationId, cur?.specialization_id),
    };
    const ids = [final.assignedManagerId, final.assignedToId, final.reviewerId].filter((v): v is string => v !== null);
    const users: Row[] = ids.length ? await m.query(`SELECT id, role, is_active, specialization_id FROM users WHERE id = ANY($1) AND company_id = $2`, [ids, companyId]) : [];
    const byId = new Map(users.map((u) => [u.id as string, u]));

    const fields: Record<string, string> = {};
    const check = (field: 'assignedManagerId' | 'assignedToId' | 'reviewerId', label: string): void => {
      if (dto[field] === undefined || dto[field] === null) return; // لم يتغير (أو مسح)
      const u = byId.get(dto[field] as string);
      if (!u || !u.is_active) fields[field] = `«${label}» غير موجود في شركتك أو غير نشط.`;
    };
    check('assignedManagerId', 'المدير المختص');
    check('assignedToId', 'المكلّف');
    check('reviewerId', 'المراجع');
    if (dto.assignedManagerId && byId.get(dto.assignedManagerId)?.is_active && byId.get(dto.assignedManagerId)!.role !== 'SPECIALIZED_MANAGER') {
      fields.assignedManagerId = 'يجب أن يكون المدير المختص بدور «مدير مختص».';
    }
    if (dto.specializationId) {
      const ok = (await m.query(`SELECT 1 FROM specializations WHERE id = $1`, [dto.specializationId])).length > 0;
      if (!ok) fields.specializationId = 'التخصص غير موجود.';
    }
    if (Object.keys(fields).length) throw new ApiException(400, 'VALIDATION_FAILED', { fields });

    if (dto.reviewerId !== undefined || dto.assignedToId !== undefined) {
      if (final.reviewerId) {
        const rv = byId.get(final.reviewerId);
        const bad = !rv || rv.role !== 'SPECIALIZED_MANAGER' || final.reviewerId === final.assignedToId;
        if (bad) throw new ApiException(409, 'REVIEWER_NOT_ELIGIBLE', { fields: { reviewerId: 'المراجع يجب أن يكون مديرًا مختصًا نشطًا وغير المكلّف.' } });
      }
    }
    if (final.specializationId && final.assignedToId && (dto.specializationId !== undefined || dto.assignedToId !== undefined)) {
      const as = byId.get(final.assignedToId)?.specialization_id as string | null | undefined;
      if (as && as !== final.specializationId) {
        throw new ApiException(409, 'SPECIALIZATION_MISMATCH', { fields: { assignedToId: 'تخصص المكلّف لا يطابق تخصص المهمة.' } });
      }
    }
  }

  // ───────────────────────── الانتقالات ─────────────────────────

  async transition(actor: AuthUser, id: string, dto: TransitionDto): Promise<TaskDetail> {
    await this.ds.transaction(async (m) => {
      const row = await loadTaskRow(m, actor.companyId, id, true);
      if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
      const from = row.status as TaskStatus;
      const to = dto.to;
      if (!isAllowedTransition(from, to) || !isManualTransition(from, to)) {
        throw new ApiException(409, 'INVALID_TRANSITION', { details: { from, to }, ...(to === 'COMPLETED' || from === 'IN_PROGRESS' || from === 'UNDER_REVIEW' ? { hint: 'التسليم والمراجعة يتمّان من خلال التسليم وقرار المراجع لا بتغيير الحالة مباشرة.' } : {}) });
      }
      if (isProjectClosed(row.project_status)) throw new ApiException(409, 'PROJECT_CLOSED');
      if (row.archived_at) throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكن تغيير حالة مهمة مؤرشفة.' });
      const ctx = await loadPolicyContext(m, id);
      const { can } = taskCapabilities(actor, rowToPolicyTask(row), ctx);
      const starting = to === 'IN_PROGRESS';
      if (starting ? !can.start : !can.assign) throw forbidden();

      if (to === 'ASSIGNED') await this.assertAssignable(m, actor.companyId, row);
      if (starting && from === 'ASSIGNED' && ctx.blockedByCount > 0) {
        throw new ApiException(409, 'DEPENDENCIES_NOT_ACCEPTED', { details: { blockedBy: await loadBlockedBy(m, id) } });
      }

      const res = rowsOf(await m.query(`UPDATE tasks SET status = $3 WHERE id = $1 AND company_id = $2 AND status = $4 RETURNING id`, [id, actor.companyId, to, from]));
      if (res.length === 0) throw new ApiException(409, 'STATE_CONFLICT'); // سبقه تحديث آخر
      await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: id, taskId: id, projectId: row.project_id, type: 'TASK_STATUS_CHANGED', fromStatus: from, toStatus: to, actorId: actor.id, meta: dto.reason ? { reason: dto.reason } : {} });
    });
    return this.getDetail(actor, id);
  }

  /** الإسناد يتطلب مكلّفًا ومراجعًا نشطين ومؤهلين وقت الإسناد (قد تتغير حالتهم بعد التعيين). */
  private async assertAssignable(m: Q, companyId: string, row: Row): Promise<void> {
    const missing = [row.assigned_to ? null : 'assignedToId', row.reviewer_id ? null : 'reviewerId'].filter((v): v is string => v !== null);
    if (missing.length) {
      throw new ApiException(409, 'STATE_CONFLICT', {
        message: 'عيّن المكلّف والمراجع قبل إسناد المهمة.',
        hint: 'عدّل المهمة وحدّد المكلّف والمراجع ثم أعد الإسناد.',
        details: { missing },
        fields: Object.fromEntries(missing.map((k) => [k, k === 'assignedToId' ? 'المكلّف مطلوب للإسناد.' : 'المراجع مطلوب للإسناد.'])),
      });
    }
    const users: Row[] = await m.query(`SELECT id, role, is_active FROM users WHERE id = ANY($1) AND company_id = $2`, [[row.assigned_to, row.reviewer_id], companyId]);
    const byId = new Map(users.map((u) => [u.id as string, u]));
    const a = byId.get(row.assigned_to);
    const r = byId.get(row.reviewer_id);
    if (!a?.is_active) throw new ApiException(409, 'STATE_CONFLICT', { message: 'المكلّف المعيّن لم يعد نشطًا.', hint: 'اختر مكلّفًا آخر.', fields: { assignedToId: 'المكلّف غير نشط.' } });
    if (!r?.is_active || r.role !== 'SPECIALIZED_MANAGER' || row.reviewer_id === row.assigned_to) {
      throw new ApiException(409, 'REVIEWER_NOT_ELIGIBLE', { fields: { reviewerId: 'المراجع يجب أن يكون مديرًا مختصًا نشطًا وغير المكلّف.' } });
    }
  }

  // ───────────────────────── الأرشفة والحذف ─────────────────────────

  async archive(actor: AuthUser, id: string): Promise<TaskDetail> {
    await this.ds.transaction(async (m) => {
      const row = await this.lockForStructuralChange(m, actor, id);
      if (row.archived_at) throw new ApiException(409, 'STATE_CONFLICT', { message: 'المهمة مؤرشفة بالفعل.' });
      await m.query(`UPDATE tasks SET archived_at = NOW() WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
      await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: id, taskId: id, projectId: row.project_id, type: 'TASK_ARCHIVED', fromStatus: row.status, actorId: actor.id, meta: { title: row.title } });
    });
    return this.getDetail(actor, id);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.ds.transaction(async (m) => {
      const row = await this.lockForStructuralChange(m, actor, id);
      const ctx = await loadPolicyContext(m, id);
      if (!['PLANNED', 'BLOCKED'].includes(row.status) || ctx.hasDependencies || ctx.hasSubmissions) {
        throw new ApiException(409, 'STATE_CONFLICT', {
          message: 'لا يمكن حذف هذه المهمة الفرعية.',
          hint: 'يُحذف فقط ما كان مخططًا أو محجوبًا وبلا اعتماديات ولا تسليمات؛ أرشِف غير ذلك.',
        });
      }
      // سجل التدقيق قبل الحذف (يبقى بلا ربط بعد الحذف: ON DELETE SET NULL على task_id).
      await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: id, taskId: id, projectId: row.project_id, type: 'TASK_DELETED', fromStatus: row.status, actorId: actor.id, meta: { title: row.title } });
      await m.query(`DELETE FROM tasks WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
    });
  }

  /** مشترك لـ archive/delete: رؤية، صلاحية، حماية الرئيسية، إغلاق المشروع. */
  private async lockForStructuralChange(m: Q, actor: AuthUser, id: string): Promise<Row> {
    const row = await loadTaskRow(m, actor.companyId, id, true);
    if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
    if (!isManager(actor.role) && !isAssignedManager(actor, { assignedManagerId: row.assigned_manager_id })) throw forbidden();
    if (row.parent_task_id === null) throw new ApiException(409, 'MAIN_TASK_PROTECTED');
    if (isProjectClosed(row.project_status)) throw new ApiException(409, 'PROJECT_CLOSED');
    return row;
  }

  async clearReviewFlag(actor: AuthUser, id: string): Promise<TaskDetail> {
    await this.ds.transaction(async (m) => {
      const row = await loadTaskRow(m, actor.companyId, id, true);
      if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
      if (!isManager(actor.role) && !isAssignedManager(actor, { assignedManagerId: row.assigned_manager_id })) throw forbidden();
      if (!row.needs_review) return;
      await m.query(`UPDATE tasks SET needs_review = FALSE WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
      await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: id, taskId: id, projectId: row.project_id, type: 'REVIEW_FLAG_CLEARED', actorId: actor.id });
    });
    return this.getDetail(actor, id);
  }
}

export function rowToTaskVisibility(r: Row): { createdBy: string; assignedManagerId: string | null; assignedTo: string | null; reviewerId: string | null } {
  return { createdBy: r.created_by, assignedManagerId: r.assigned_manager_id, assignedTo: r.assigned_to, reviewerId: r.reviewer_id };
}

export function rowToDependency(r: Row): DependencyDto {
  return {
    id: r.id,
    projectId: r.project_id,
    predecessor: { id: r.pr_id, title: r.pr_title, status: r.pr_status },
    successor: { id: r.su_id, title: r.su_title, status: r.su_status },
    dependencyType: r.dependency_type,
    createdAt: iso(r.created_at)!,
  };
}

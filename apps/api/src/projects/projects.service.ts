import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ApiException, forbidden, notFound } from '../common/api-exception.js';
import type { AuthUser } from '../common/auth-user.js';
import { iso, type UserRef } from '../common/mappers.js';
import { escapeLike, paged, resolvePage, type Paged } from '../common/pagination.js';
import { recordAudit } from '../work/audit.js';
import { PROJECT_TRANSITIONS, isProjectClosed, type ProjectStatus, type TaskStatus } from '../work/model.js';
import { canCreateProject } from '../work/policy.js';
import { projectVisibilitySql, taskVisibilitySql, type Row } from '../work/task-sql.js';
import type { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './dto.js';
import { rowsOf } from '../common/db.js';

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
  taskCounts: { total: number } & Partial<Record<TaskStatus, number>>;
  /** نسبة المهام الرئيسية المكتملة (غير المؤرشفة وفق ما يراه المستدعي)؛ null بلا مهام رئيسية. */
  progressPct: number | null;
  overdueCount: number;
  allowedNextStatuses: ProjectStatus[];
}

const PROJECT_COLUMNS = `p.id, p.name, p.description, p.status, to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(p.due_date, 'YYYY-MM-DD') AS due_date, p.created_by, p.created_at, p.updated_at,
  cb.full_name AS cb_name, cb.role AS cb_role`;
const PROJECT_FROM = `FROM projects p JOIN users cb ON cb.id = p.created_by`;

const SORT_SQL: Record<string, string> = {
  updatedAt: 'p.updated_at',
  createdAt: 'p.created_at',
  name: 'p.name',
  dueDate: 'p.due_date',
};

@Injectable()
export class ProjectsService {
  constructor(private readonly ds: DataSource) {}

  async list(actor: AuthUser, q: ListProjectsQuery): Promise<Paged<ProjectDto>> {
    const { page, pageSize, offset, limit } = resolvePage(q);
    const params: unknown[] = [actor.companyId];
    const where = ['p.company_id = $1', projectVisibilitySql(actor, 'p', params)];
    if (q.status) where.push(`p.status = $${params.push(q.status)}`);
    if (q.q?.trim()) where.push(`p.name ILIKE $${params.push(`%${escapeLike(q.q.trim())}%`)} ESCAPE '\\'`);
    const w = where.join(' AND ');
    const total = Number((await this.ds.query(`SELECT COUNT(*)::int AS n FROM projects p WHERE ${w}`, params))[0].n);
    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    const col = SORT_SQL[q.sort ?? 'updatedAt']!;
    const nulls = q.sort === 'dueDate' ? ' NULLS LAST' : '';
    const rows = await this.ds.query(
      `SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE ${w} ORDER BY ${col} ${dir}${nulls}, p.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return paged(await this.withCounts(this.ds, actor, rows), total, page, pageSize);
  }

  async get(actor: AuthUser, id: string): Promise<ProjectDto> {
    const dto = await this.load(this.ds, actor, id);
    if (!dto) throw notFound();
    return dto;
  }

  async create(actor: AuthUser, dto: CreateProjectDto): Promise<ProjectDto> {
    if (!canCreateProject(actor)) {
      throw forbidden({ message: 'ليست لديك صلاحية إنشاء المشاريع.', hint: 'يلزم دور مدير تنفيذي أو مدير مشروع مع تفعيل صلاحية إنشاء المشاريع.' });
    }
    this.assertDatesOrder(dto.startDate ?? null, dto.dueDate ?? null);
    const id = await this.ds.transaction(async (m) => {
      const row = (
        await m.query(
          `INSERT INTO projects (company_id, name, description, created_by, start_date, due_date)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [actor.companyId, dto.name, dto.description ?? null, actor.id, dto.startDate ?? null, dto.dueDate ?? null],
        )
      )[0];
      await recordAudit(m, { companyId: actor.companyId, entity: 'PROJECT', entityId: row.id, projectId: row.id, type: 'PROJECT_CREATED', toStatus: 'PLANNED', actorId: actor.id, meta: { name: dto.name } });
      return row.id as string;
    });
    return this.get(actor, id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateProjectDto): Promise<ProjectDto> {
    const fields = ['name', 'description', 'status', 'startDate', 'dueDate'] as const;
    if (!fields.some((f) => dto[f] !== undefined)) {
      throw new ApiException(400, 'VALIDATION_FAILED', { message: 'لم تُرسل أي بيانات للتعديل.', hint: 'أرسل حقلًا واحدًا على الأقل.' });
    }
    await this.ds.transaction(async (m) => {
      const cur = (await m.query(`SELECT id, status, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(due_date,'YYYY-MM-DD') AS due_date FROM projects WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]))[0] as Row | undefined;
      if (!cur) throw notFound();
      const from = cur.status as ProjectStatus;

      const metaChange = dto.name !== undefined || dto.description !== undefined || dto.startDate !== undefined || dto.dueDate !== undefined;
      if (metaChange && isProjectClosed(from)) throw new ApiException(409, 'PROJECT_CLOSED');

      if (dto.status !== undefined && dto.status !== from) {
        if (!PROJECT_TRANSITIONS[from].includes(dto.status)) {
          throw new ApiException(409, 'INVALID_PROJECT_TRANSITION', { details: { from, to: dto.status, allowed: PROJECT_TRANSITIONS[from] } });
        }
        if (dto.status === 'COMPLETED') await this.assertNoOpenTasks(m, actor.companyId, id);
      } else if (dto.status !== undefined && dto.status === from && !metaChange) {
        throw new ApiException(409, 'INVALID_PROJECT_TRANSITION', { details: { from, to: dto.status, allowed: PROJECT_TRANSITIONS[from] } });
      }

      const start = dto.startDate !== undefined ? dto.startDate : (cur.start_date as string | null);
      const due = dto.dueDate !== undefined ? dto.dueDate : (cur.due_date as string | null);
      this.assertDatesOrder(start, due);

      const sets: string[] = [];
      const params: unknown[] = [id, actor.companyId];
      const add = (col: string, v: unknown): void => void sets.push(`${col} = $${params.push(v)}`);
      if (dto.name !== undefined) add('name', dto.name);
      if (dto.description !== undefined) add('description', dto.description);
      if (dto.startDate !== undefined) add('start_date', dto.startDate);
      if (dto.dueDate !== undefined) add('due_date', dto.dueDate);
      const changingStatus = dto.status !== undefined && dto.status !== from;
      if (changingStatus) {
        add('status', dto.status);
        params.push(from);
      }
      const fromIdx = params.length;
      const res = rowsOf(await m.query(
        `UPDATE projects SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2${changingStatus ? ` AND status = $${fromIdx}` : ''} RETURNING id`,
        params,
      ));
      if (res.length === 0) throw new ApiException(409, 'STATE_CONFLICT');

      if (changingStatus) {
        await recordAudit(m, { companyId: actor.companyId, entity: 'PROJECT', entityId: id, projectId: id, type: 'PROJECT_STATUS_CHANGED', fromStatus: from, toStatus: dto.status!, actorId: actor.id });
      }
      if (metaChange) {
        await recordAudit(m, { companyId: actor.companyId, entity: 'PROJECT', entityId: id, projectId: id, type: 'PROJECT_UPDATED', actorId: actor.id, meta: { fields: fields.filter((f) => f !== 'status' && dto[f] !== undefined) } });
      }
    });
    return this.get(actor, id);
  }

  private assertDatesOrder(start: string | null, due: string | null): void {
    if (start && due && due < start) {
      throw new ApiException(400, 'VALIDATION_FAILED', { fields: { dueDate: 'تاريخ الاستحقاق يجب ألا يسبق تاريخ البداية.' } });
    }
  }

  private async assertNoOpenTasks(m: EntityManager, companyId: string, projectId: string): Promise<void> {
    const open: Array<{ id: string; title: string; status: TaskStatus }> = await m.query(
      `SELECT id, title, status FROM tasks WHERE project_id = $1 AND company_id = $2 AND archived_at IS NULL AND status <> 'COMPLETED' ORDER BY created_at LIMIT 10`,
      [projectId, companyId],
    );
    if (open.length > 0) throw new ApiException(409, 'PROJECT_HAS_OPEN_TASKS', { details: { openTasks: open } });
  }

  private async load(m: Pick<EntityManager, 'query'>, actor: AuthUser, id: string): Promise<ProjectDto | null> {
    const params: unknown[] = [id, actor.companyId];
    const vis = projectVisibilitySql(actor, 'p', params);
    const rows = await m.query(`SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE p.id = $1 AND p.company_id = $2 AND ${vis}`, params);
    if (rows.length === 0) return null;
    return (await this.withCounts(m, actor, rows))[0]!;
  }

  /** يضيف العدّادات المقيّدة بما يراه المستدعي (استعلام واحد لكل الصفحة). */
  private async withCounts(m: Pick<EntityManager, 'query'>, actor: AuthUser, projects: Row[]): Promise<ProjectDto[]> {
    if (projects.length === 0) return [];
    const params: unknown[] = [actor.companyId, projects.map((p) => p.id)];
    const vis = taskVisibilitySql(actor, 't', params);
    const agg: Row[] = await m.query(
      `SELECT t.project_id, t.status, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE t.parent_task_id IS NULL)::int AS main_n,
              COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status <> 'COMPLETED')::int AS overdue_n
         FROM tasks t WHERE t.company_id = $1 AND t.project_id = ANY($2) AND t.archived_at IS NULL AND ${vis}
        GROUP BY t.project_id, t.status`,
      params,
    );
    const by = new Map<string, Row[]>();
    for (const a of agg) by.set(a.project_id, [...(by.get(a.project_id) ?? []), a]);
    return projects.map((p) => {
      const rows = by.get(p.id) ?? [];
      const counts: ProjectDto['taskCounts'] = { total: 0 };
      let main = 0;
      let mainDone = 0;
      let overdue = 0;
      for (const r of rows) {
        counts.total += r.n;
        counts[r.status as TaskStatus] = r.n;
        main += r.main_n;
        overdue += r.overdue_n;
        if (r.status === 'COMPLETED') mainDone += r.main_n;
      }
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        startDate: p.start_date,
        dueDate: p.due_date,
        createdBy: { id: p.created_by, fullName: p.cb_name, role: p.cb_role },
        createdAt: iso(p.created_at)!,
        updatedAt: iso(p.updated_at)!,
        taskCounts: counts,
        progressPct: main === 0 ? null : Math.round((mainDone / main) * 100),
        overdueCount: overdue,
        allowedNextStatuses: [...PROJECT_TRANSITIONS[p.status as ProjectStatus]],
      };
    });
  }
}

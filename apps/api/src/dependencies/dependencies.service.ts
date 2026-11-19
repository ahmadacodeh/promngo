import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ApiException, notFound } from '../common/api-exception.js';
import type { AuthUser } from '../common/auth-user.js';
import { rowToDependency, type DependencyDto } from '../tasks/tasks.service.js';
import { recordAudit } from '../work/audit.js';
import { STARTED_STATUSES, isProjectClosed, type ProjectStatus } from '../work/model.js';
import { projectVisibilitySql, taskVisibilitySql, type Row } from '../work/task-sql.js';
import type { CreateDependencyDto } from './dto.js';
import { rowsOf } from '../common/db.js';

type Q = Pick<EntityManager, 'query'>;

const DEP_SELECT = `SELECT d.id, d.project_id, d.dependency_type, d.created_at,
       pr.id AS pr_id, pr.title AS pr_title, pr.status AS pr_status,
       su.id AS su_id, su.title AS su_title, su.status AS su_status
  FROM task_dependencies d
  JOIN tasks pr ON pr.id = d.predecessor_task_id
  JOIN tasks su ON su.id = d.successor_task_id`;

@Injectable()
export class DependenciesService {
  constructor(private readonly ds: DataSource) {}

  /** اعتماديات مشروع: يرى غير المدير منها ما يرى طرفيه فقط؛ المشروع غير المرئي ← 404. */
  async list(actor: AuthUser, projectId: string): Promise<DependencyDto[]> {
    const pp: unknown[] = [projectId, actor.companyId];
    const visible = await this.ds.query(`SELECT 1 FROM projects p WHERE p.id = $1 AND p.company_id = $2 AND ${projectVisibilitySql(actor, 'p', pp)}`, pp);
    if (visible.length === 0) throw notFound();
    const params: unknown[] = [projectId, actor.companyId];
    const rows: Row[] = await this.ds.query(
      `${DEP_SELECT} WHERE d.project_id = $1 AND d.company_id = $2 AND ${taskVisibilitySql(actor, 'pr', params)} AND ${taskVisibilitySql(actor, 'su', params)}
        ORDER BY d.created_at, d.id`,
      params,
    );
    return rows.map(rowToDependency);
  }

  async create(actor: AuthUser, projectId: string, dto: CreateDependencyDto): Promise<DependencyDto> {
    if (dto.predecessorTaskId === dto.successorTaskId) {
      throw new ApiException(400, 'VALIDATION_FAILED', { fields: { successorTaskId: 'لا يمكن ربط المهمة بنفسها.' } });
    }
    const id = await this.ds.transaction(async (m) => {
      await this.lockProject(m, actor, projectId, 'FOR SHARE');
      // قفل استشاري لكل مشروع: يسلسل إضافات الاعتماديات المتزامنة فلا تنشئ طلبان متعاكسان دورة معًا.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [projectId]);

      const tasks: Row[] = await m.query(
        `SELECT id, title, status, archived_at FROM tasks WHERE id = ANY($1) AND company_id = $2 AND project_id = $3`,
        [[dto.predecessorTaskId, dto.successorTaskId], actor.companyId, projectId],
      );
      if (tasks.length !== 2) throw notFound();
      if (tasks.some((t) => t.archived_at)) {
        throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكن ربط مهمة مؤرشفة.', hint: 'اختر مهمة غير مؤرشفة.' });
      }
      const pred = tasks.find((t) => t.id === dto.predecessorTaskId)!;
      const succ = tasks.find((t) => t.id === dto.successorTaskId)!;

      const dup = await m.query(`SELECT 1 FROM task_dependencies WHERE predecessor_task_id = $1 AND successor_task_id = $2`, [pred.id, succ.id]);
      if (dup.length) throw new ApiException(409, 'DEPENDENCY_DUPLICATE');

      // إضافة P→S تُنشئ دورة إذا وُجد مسار S→…→P.
      const cycle = await m.query(
        `WITH RECURSIVE reach(id) AS (
           SELECT successor_task_id FROM task_dependencies WHERE predecessor_task_id = $1
           UNION
           SELECT d.successor_task_id FROM task_dependencies d JOIN reach r ON d.predecessor_task_id = r.id
         ) SELECT 1 FROM reach WHERE id = $2 LIMIT 1`,
        [succ.id, pred.id],
      );
      if (cycle.length) throw new ApiException(409, 'DEPENDENCY_CYCLE');

      const dep = (
        await m.query(
          `INSERT INTO task_dependencies (company_id, project_id, predecessor_task_id, successor_task_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [actor.companyId, projectId, pred.id, succ.id, actor.id],
        )
      )[0];
      await recordAudit(m, {
        companyId: actor.companyId, entity: 'DEPENDENCY', entityId: dep.id, taskId: succ.id, projectId, type: 'DEPENDENCY_ADDED', actorId: actor.id,
        meta: { predecessorTaskId: pred.id, successorTaskId: succ.id, predecessorTitle: pred.title, successorTitle: succ.title },
      });

      // لاحقة بدأ عملها قبل إضافة السابقة ← تحتاج مراجعة (FR-010)؛ لا نغيّر حالتها ولا نحذف شيئًا.
      if ((STARTED_STATUSES as readonly string[]).includes(succ.status)) {
        const flagged = rowsOf(await m.query(`UPDATE tasks SET needs_review = TRUE WHERE id = $1 AND company_id = $2 AND needs_review = FALSE RETURNING id`, [succ.id, actor.companyId]));
        if (flagged.length) {
          await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: succ.id, taskId: succ.id, projectId, type: 'DEPENDENCY_PREDECESSOR_CHANGED', actorId: actor.id, meta: { predecessorId: pred.id, reason: 'DEPENDENCY_ADDED_AFTER_START' } });
        }
      }
      return dep.id as string;
    });
    const rows: Row[] = await this.ds.query(`${DEP_SELECT} WHERE d.id = $1`, [id]);
    return rowToDependency(rows[0]!);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.ds.transaction(async (m) => {
      const dep = (await m.query(`SELECT id, project_id, predecessor_task_id, successor_task_id FROM task_dependencies WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]))[0] as Row | undefined;
      if (!dep) throw notFound();
      await this.lockProject(m, actor, dep.project_id, 'FOR SHARE');
      await m.query(`DELETE FROM task_dependencies WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
      await recordAudit(m, {
        companyId: actor.companyId, entity: 'DEPENDENCY', entityId: id, taskId: dep.successor_task_id, projectId: dep.project_id, type: 'DEPENDENCY_REMOVED', actorId: actor.id,
        meta: { predecessorTaskId: dep.predecessor_task_id, successorTaskId: dep.successor_task_id },
      });
    });
  }

  private async lockProject(m: Q, actor: AuthUser, projectId: string, mode: 'FOR SHARE'): Promise<void> {
    const p = (await m.query(`SELECT id, status FROM projects WHERE id = $1 AND company_id = $2 ${mode}`, [projectId, actor.companyId]))[0] as { id: string; status: ProjectStatus } | undefined;
    if (!p) throw notFound();
    if (isProjectClosed(p.status)) throw new ApiException(409, 'PROJECT_CLOSED');
  }
}

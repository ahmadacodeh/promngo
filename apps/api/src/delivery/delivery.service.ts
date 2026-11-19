import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ApiException, forbidden, notFound } from '../common/api-exception.js';
import type { AuthUser } from '../common/auth-user.js';
import { rowsOf } from '../common/db.js';
import { iso, toUserRefPrefixed, type UserRef } from '../common/mappers.js';
import { ENV_TOKEN, type AppEnv } from '../config/env.js';
import { TasksService, rowToTaskVisibility, type TaskDetail } from '../tasks/tasks.service.js';
import { recordAudit } from '../work/audit.js';
import { FILE_LIMITS, isProjectClosed, type TaskStatus } from '../work/model.js';
import { canSeeTask } from '../work/policy.js';
import { flagStartedSuccessors, loadTaskRow, type Row } from '../work/task-sql.js';
import type { ReviewDto, SubmitTaskDto } from './dto.js';
import { checkFile, downloadContentType, type FileCheckOk } from './file-rules.js';

type Q = Pick<EntityManager, 'query'>;

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  buffer: Buffer;
  size: number;
}
export interface AttachmentDto {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}
export interface SubmissionDto {
  id: string;
  taskId: string;
  round: number;
  submittedBy: UserRef;
  note: string | null;
  submittedAt: string;
  attachments: AttachmentDto[];
}
export interface ReviewRecordDto {
  id: string;
  taskId: string;
  round: number;
  reviewer: UserRef;
  decision: 'APPROVED' | 'CHANGES_REQUESTED';
  comments: string | null;
  reviewedAt: string;
}
export interface OpenedAttachment {
  stream: Readable;
  fileName: string;
  contentType: string;
  size: number;
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Delivery');
  private readonly root: string;

  constructor(
    private readonly ds: DataSource,
    private readonly tasks: TasksService,
    @Inject(ENV_TOKEN) env: AppEnv,
  ) {
    this.root = resolve(env.UPLOAD_DIR);
  }

  // ───────────────────────── التسليم ─────────────────────────

  /**
   * التسليم: ملفات + سجل + انتقال IN_PROGRESS→SUBMITTED→UNDER_REVIEW + حدثان، في معاملة واحدة.
   * الملفات تُكتب أثناء المعاملة بعد اجتياز كل الفحوصات، وتُحذف إن فشل أي جزء (لا يتيم ولا سجل بلا ملف).
   * ترتيب الأخطاء كالانتقالات: 404 ← 409 الحالة ← 409 إغلاق المشروع ← 403 ← 400 التحقق.
   */
  async submit(actor: AuthUser, taskId: string, dto: SubmitTaskDto, files: UploadedFile[]): Promise<{ submission: SubmissionDto; task: TaskDetail }> {
    const written: string[] = [];
    try {
      const submissionId = await this.ds.transaction(async (m) => {
        const row = await loadTaskRow(m, actor.companyId, taskId, true);
        if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
        if (row.status !== 'IN_PROGRESS') {
          throw new ApiException(409, 'INVALID_TRANSITION', {
            details: { from: row.status, to: 'SUBMITTED' },
            hint: row.status === 'CHANGES_REQUESTED' ? 'ابدأ العمل من جديد (الانتقال إلى «قيد التنفيذ») ثم سلّم.' : 'التسليم متاح فقط للمهمة «قيد التنفيذ».',
          });
        }
        if (isProjectClosed(row.project_status)) throw new ApiException(409, 'PROJECT_CLOSED');
        if (row.archived_at) throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكن تسليم مهمة مؤرشفة.' });
        if (row.assigned_to !== actor.id) throw forbidden({ message: 'التسليم للمكلّف بالمهمة فقط.' });

        const checked = this.validateFiles(files);
        const round = Number((await m.query(`SELECT COALESCE(MAX(round), 0) + 1 AS r FROM task_submissions WHERE task_id = $1`, [taskId]))[0].r);

        const sub = (
          await m.query(`INSERT INTO task_submissions (company_id, task_id, round, submitted_by, note) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
            actor.companyId, taskId, round, actor.id, dto.note ? dto.note : null,
          ])
        )[0];
        for (const f of checked) {
          const rel = `${actor.companyId}/${taskId}/${randomUUID()}.${f.ext}`;
          const abs = this.absolute(rel);
          await mkdir(dirname(abs), { recursive: true, mode: 0o750 });
          await writeFile(abs, f.buffer, { flag: 'wx', mode: 0o640 });
          written.push(abs);
          await m.query(
            // clock_timestamp(): NOW() ثابت طوال المعاملة فيضيع ترتيب رفع الملفات داخل التسليم الواحد.
            `INSERT INTO task_attachments (company_id, task_id, submission_id, file_name, mime_type, size_bytes, storage_path, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())`,
            [actor.companyId, taskId, sub.id, f.fileName, f.mime, f.size, rel],
          );
        }

        const res = rowsOf(await m.query(`UPDATE tasks SET status = 'UNDER_REVIEW' WHERE id = $1 AND company_id = $2 AND status = 'IN_PROGRESS' RETURNING id`, [taskId, actor.companyId]));
        if (res.length === 0) throw new ApiException(409, 'STATE_CONFLICT');
        const base = { companyId: actor.companyId, entity: 'TASK' as const, entityId: taskId, taskId, projectId: row.project_id, actorId: actor.id };
        await recordAudit(m, { ...base, type: 'TASK_STATUS_CHANGED', fromStatus: 'IN_PROGRESS', toStatus: 'SUBMITTED', meta: { round, submissionId: sub.id, files: checked.length } });
        await recordAudit(m, { ...base, type: 'TASK_STATUS_CHANGED', fromStatus: 'SUBMITTED', toStatus: 'UNDER_REVIEW', meta: { round, auto: true } });
        return sub.id as string;
      });
      const [submission] = await this.loadSubmissions(this.ds, actor.companyId, { id: submissionId });
      return { submission: submission!, task: await this.tasks.getDetail(actor, taskId) };
    } catch (e) {
      await Promise.all(written.map((p) => unlink(p).catch(() => undefined)));
      throw e;
    }
  }

  private validateFiles(files: UploadedFile[]): Array<FileCheckOk & { buffer: Buffer }> {
    if (files.length === 0) throw new ApiException(400, 'FILES_REQUIRED', { fields: { files: 'أرفق ملفًا واحدًا على الأقل.' } });
    if (files.length > FILE_LIMITS.maxFiles) throw new ApiException(400, 'TOO_MANY_FILES', { fields: { files: 'عدد الملفات أكبر من المسموح (5).' } });
    return files.map((f) => {
      const r = checkFile(f.originalname, f.buffer);
      if (!r.ok) {
        throw new ApiException(r.code === 'FILE_TOO_LARGE' ? 413 : 400, r.code, { fields: { files: r.reason }, details: { fileName: r.fileName } });
      }
      return { ...r, buffer: f.buffer };
    });
  }

  async listSubmissions(actor: AuthUser, taskId: string): Promise<SubmissionDto[]> {
    await this.assertVisible(actor, taskId);
    return this.loadSubmissions(this.ds, actor.companyId, { taskId });
  }

  private async loadSubmissions(m: Q, companyId: string, by: { id?: string; taskId?: string }): Promise<SubmissionDto[]> {
    const params: unknown[] = [companyId, by.id ?? by.taskId];
    const subs: Row[] = await m.query(
      `SELECT s.id, s.task_id, s.round, s.note, s.submitted_at, u.id AS u_id, u.full_name AS u_name, u.role AS u_role
         FROM task_submissions s JOIN users u ON u.id = s.submitted_by
        WHERE s.company_id = $1 AND ${by.id ? 's.id' : 's.task_id'} = $2 ORDER BY s.round DESC`,
      params,
    );
    if (subs.length === 0) return [];
    const atts: Row[] = await m.query(
      `SELECT id, submission_id, file_name, mime_type, size_bytes FROM task_attachments WHERE company_id = $1 AND submission_id = ANY($2) ORDER BY created_at, id`,
      [companyId, subs.map((s) => s.id)],
    );
    return subs.map((s) => ({
      id: s.id,
      taskId: s.task_id,
      round: s.round,
      submittedBy: toUserRefPrefixed(s, 'u')!,
      note: s.note,
      submittedAt: iso(s.submitted_at)!,
      attachments: atts.filter((a) => a.submission_id === s.id).map((a) => ({ id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: Number(a.size_bytes) })),
    }));
  }

  // ───────────────────────── التنزيل ─────────────────────────

  /** يفتح مرفقًا لمن يرى مهمته فقط. المسار يُبنى من القاعدة ويُتحقق أنه داخل UPLOAD_DIR. */
  async openAttachment(actor: AuthUser, id: string): Promise<OpenedAttachment> {
    const a: Row | undefined = (
      await this.ds.query(
        `SELECT a.id, a.file_name, a.mime_type, a.storage_path, t.created_by, t.assigned_manager_id, t.assigned_to, t.reviewer_id
           FROM task_attachments a JOIN tasks t ON t.id = a.task_id AND t.company_id = a.company_id
          WHERE a.id = $1 AND a.company_id = $2`,
        [id, actor.companyId],
      )
    )[0];
    if (!a || !canSeeTask(actor, rowToTaskVisibility(a))) throw notFound();
    const abs = this.absolute(a.storage_path);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) {
      this.logger.error(`ملف مرفق مفقود على الخادم (attachment=${id})`);
      throw new ApiException(404, 'NOT_FOUND', { message: 'ملف المرفق غير متوفر على الخادم.', hint: 'اطلب من المكلّف إعادة التسليم.' });
    }
    return { stream: createReadStream(abs), fileName: a.file_name, contentType: downloadContentType(a.mime_type), size: info.size };
  }

  private absolute(rel: string): string {
    const abs = resolve(this.root, rel);
    if (!abs.startsWith(this.root + sep)) throw new ApiException(500, 'INTERNAL_ERROR'); // لا يحدث إلا بقاعدة مُعبَث بها
    return abs;
  }

  // ───────────────────────── المراجعة ─────────────────────────

  async review(actor: AuthUser, taskId: string, dto: ReviewDto): Promise<{ review: ReviewRecordDto; task: TaskDetail }> {
    const reviewId = await this.ds.transaction(async (m) => {
      const row = await loadTaskRow(m, actor.companyId, taskId, true);
      if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
      const to: TaskStatus = dto.decision === 'APPROVED' ? 'COMPLETED' : 'CHANGES_REQUESTED';
      if (row.status !== 'UNDER_REVIEW') throw new ApiException(409, 'INVALID_TRANSITION', { details: { from: row.status, to } });
      if (isProjectClosed(row.project_status)) throw new ApiException(409, 'PROJECT_CLOSED');
      if (row.archived_at) throw new ApiException(409, 'STATE_CONFLICT', { message: 'لا يمكن مراجعة مهمة مؤرشفة.' });
      // المراجع المعيّن فقط (والمكلّف لا يراجع عمله أبدًا حتى لو عُيّن مراجعًا بتغيير لاحق).
      if (row.reviewer_id !== actor.id || row.assigned_to === actor.id) throw forbidden({ message: 'المراجعة للمراجع المعيّن على هذه المهمة فقط.' });

      const comments = dto.comments?.trim() ? dto.comments.trim() : null;
      if (dto.decision === 'CHANGES_REQUESTED' && !comments) {
        throw new ApiException(400, 'COMMENT_REQUIRED', { fields: { comments: 'اكتب ما المطلوب تعديله.' } });
      }
      if (dto.decision === 'APPROVED') {
        const open: Row[] = await m.query(
          `SELECT id, title, status FROM tasks WHERE parent_task_id = $1 AND company_id = $2 AND archived_at IS NULL AND is_required AND status <> 'COMPLETED' ORDER BY created_at, id LIMIT 20`,
          [taskId, actor.companyId],
        );
        if (open.length) throw new ApiException(409, 'PARENT_HAS_OPEN_SUBTASKS', { details: { openSubtasks: open } });
      }

      const round = Number((await m.query(`SELECT COALESCE(MAX(round), 1) AS r FROM task_submissions WHERE task_id = $1`, [taskId]))[0].r);
      const rec = (
        await m.query(`INSERT INTO review_records (company_id, task_id, reviewer_id, decision, comments, round) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [
          actor.companyId, taskId, actor.id, dto.decision, comments, round,
        ])
      )[0];
      const res = rowsOf(await m.query(`UPDATE tasks SET status = $3 WHERE id = $1 AND company_id = $2 AND status = 'UNDER_REVIEW' RETURNING id`, [taskId, actor.companyId, to]));
      if (res.length === 0) throw new ApiException(409, 'STATE_CONFLICT');

      const base = { companyId: actor.companyId, entity: 'TASK' as const, entityId: taskId, taskId, projectId: row.project_id, actorId: actor.id };
      await recordAudit(m, { ...base, type: 'REVIEW_DECISION', meta: { decision: dto.decision, round, reviewId: rec.id, hasComments: comments !== null } });
      await recordAudit(m, { ...base, type: 'TASK_STATUS_CHANGED', fromStatus: 'UNDER_REVIEW', toStatus: to, meta: { decision: dto.decision, round } });
      if (dto.decision === 'CHANGES_REQUESTED') {
        // سابقة رجعت للتعديل: اللاحقات التي بدأت تحتاج مراجعة (FR-010).
        for (const s of await flagStartedSuccessors(m, actor.companyId, taskId)) {
          await recordAudit(m, { companyId: actor.companyId, entity: 'TASK', entityId: s.id, taskId: s.id, projectId: s.projectId, type: 'DEPENDENCY_PREDECESSOR_CHANGED', actorId: actor.id, meta: { predecessorId: taskId, reason: 'PREDECESSOR_CHANGES_REQUESTED' } });
        }
      }
      return rec.id as string;
    });
    const [review] = await this.loadReviews(this.ds, actor.companyId, { id: reviewId });
    return { review: review!, task: await this.tasks.getDetail(actor, taskId) };
  }

  async listReviews(actor: AuthUser, taskId: string): Promise<ReviewRecordDto[]> {
    await this.assertVisible(actor, taskId);
    return this.loadReviews(this.ds, actor.companyId, { taskId });
  }

  private async loadReviews(m: Q, companyId: string, by: { id?: string; taskId?: string }): Promise<ReviewRecordDto[]> {
    const rows: Row[] = await m.query(
      `SELECT r.id, r.task_id, r.round, r.decision, r.comments, r.reviewed_at, u.id AS u_id, u.full_name AS u_name, u.role AS u_role
         FROM review_records r JOIN users u ON u.id = r.reviewer_id
        WHERE r.company_id = $1 AND ${by.id ? 'r.id' : 'r.task_id'} = $2 ORDER BY r.reviewed_at DESC, r.round DESC, r.id`,
      [companyId, by.id ?? by.taskId],
    );
    return rows.map((r) => ({ id: r.id, taskId: r.task_id, round: r.round, reviewer: toUserRefPrefixed(r, 'u')!, decision: r.decision, comments: r.comments, reviewedAt: iso(r.reviewed_at)! }));
  }

  private async assertVisible(actor: AuthUser, taskId: string): Promise<void> {
    const row = await loadTaskRow(this.ds, actor.companyId, taskId);
    if (!row || !canSeeTask(actor, rowToTaskVisibility(row))) throw notFound();
  }
}

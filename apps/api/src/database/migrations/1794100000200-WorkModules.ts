import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B2 — وحدات العمل (إضافة فوق المخطط المعتمد دون تعديله):
 *  - قرار المالك T4 (2026-11-15): `priority` و`due_date` للمهام، و`start_date`/`due_date` للمشاريع (اختيارية).
 *  - `needs_review` (FR-010: تغيّرت سابقة بعد بدء اللاحق) و`archived_at` (أرشفة المهام الفرعية).
 *  - `task_submissions` + `task_attachments` (قرار مرفقات التسليم، §10-4) و`round` لسجل المراجعة.
 *  - `audit_events` (FR-012: تغيّر الحالة، قرارات المراجعة، الاعتماديات، إدارة المستخدمين) و`audit_reports`.
 * كل العلاقات مركّبة بالشركة (company_id, id) كما في المخطط الأصلي لمنع الربط العابر للشركات.
 */
export class WorkModules1794100000200 implements MigrationInterface {
  name = 'WorkModules1794100000200';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE projects
        ADD COLUMN start_date DATE,
        ADD COLUMN due_date DATE,
        ADD CONSTRAINT projects_dates_order CHECK (start_date IS NULL OR due_date IS NULL OR due_date >= start_date);

      ALTER TABLE tasks
        ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM'
          CONSTRAINT tasks_priority_check CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
        ADD COLUMN due_date DATE,
        ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN archived_at TIMESTAMPTZ;
      CREATE INDEX idx_tasks_company_due ON tasks(company_id, due_date) WHERE archived_at IS NULL;
      CREATE INDEX idx_tasks_company_updated ON tasks(company_id, updated_at DESC);
      CREATE INDEX idx_tasks_company_priority ON tasks(company_id, priority) WHERE archived_at IS NULL;

      ALTER TABLE review_records ADD COLUMN round INTEGER NOT NULL DEFAULT 1 CHECK (round >= 1);
      ALTER TABLE review_records ALTER COLUMN round DROP DEFAULT;

      CREATE TABLE task_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        task_id UUID NOT NULL,
        round INTEGER NOT NULL CHECK (round >= 1),
        submitted_by UUID NOT NULL,
        note TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (task_id, round),
        UNIQUE (company_id, id),
        FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (company_id, submitted_by) REFERENCES users(company_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_submissions_task ON task_submissions(task_id, round DESC);

      CREATE TABLE task_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        task_id UUID NOT NULL,
        submission_id UUID NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
        storage_path TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (company_id, submission_id) REFERENCES task_submissions(company_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_attachments_submission ON task_attachments(submission_id);

      CREATE TABLE audit_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        entity VARCHAR(20) NOT NULL CHECK (entity IN ('TASK', 'PROJECT', 'DEPENDENCY', 'USER', 'AUDIT')),
        entity_id UUID NOT NULL,
        task_id UUID,
        project_id UUID,
        type VARCHAR(50) NOT NULL,
        from_status VARCHAR(30),
        to_status VARCHAR(30),
        actor_id UUID,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- حذف مهمة فرعية مسموح (قبل أي تسليم): يبقى حدثها في السجل بلا ربط (task_id يصبح NULL وentity_id يبقى).
        FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id) ON DELETE SET NULL (task_id),
        FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (company_id, actor_id) REFERENCES users(company_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_audit_company_date ON audit_events(company_id, created_at DESC);
      CREATE INDEX idx_audit_task_date ON audit_events(task_id, created_at);
      CREATE INDEX idx_audit_company_type ON audit_events(company_id, type);

      CREATE TABLE audit_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        period VARCHAR(10) NOT NULL CHECK (period IN ('daily', 'weekly')),
        period_from TIMESTAMPTZ NOT NULL,
        period_to TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        created_by UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_audit_reports_company ON audit_reports(company_id, created_at DESC);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS audit_reports;
      DROP TABLE IF EXISTS audit_events;
      DROP TABLE IF EXISTS task_attachments;
      DROP TABLE IF EXISTS task_submissions;
      ALTER TABLE review_records DROP COLUMN IF EXISTS round;
      DROP INDEX IF EXISTS idx_tasks_company_priority;
      DROP INDEX IF EXISTS idx_tasks_company_updated;
      DROP INDEX IF EXISTS idx_tasks_company_due;
      ALTER TABLE tasks DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS needs_review,
        DROP COLUMN IF EXISTS due_date, DROP COLUMN IF EXISTS priority;
      ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_dates_order,
        DROP COLUMN IF EXISTS due_date, DROP COLUMN IF EXISTS start_date;
    `);
  }
}

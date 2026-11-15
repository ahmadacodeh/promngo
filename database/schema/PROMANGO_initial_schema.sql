-- PROMANGO — Initial PostgreSQL schema
-- Fresh database baseline. Do not run on top of existing tables.
-- Application-level authorization, status transitions, dependency-cycle checks,
-- and parent-task completion rules must also be implemented in the backend.

BEGIN;

CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(180) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(30) NOT NULL
        CHECK (role IN (
            'EXECUTIVE_MANAGER', 'PROJECT_MANAGER',
            'SPECIALIZED_MANAGER', 'EMPLOYEE'
        )),
    can_create_projects BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, id)
);

CREATE TABLE specializations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, id),
    FOREIGN KEY (company_id, created_by)
        REFERENCES users(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    project_id UUID NOT NULL,
    parent_task_id UUID,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL,
    assigned_manager_id UUID,
    assigned_to UUID,
    reviewer_id UUID,
    specialization_id UUID REFERENCES specializations(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN (
            'PLANNED', 'BLOCKED', 'ASSIGNED', 'IN_PROGRESS',
            'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED'
        )),
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (company_id, id),
    UNIQUE (project_id, id),
    CHECK (parent_task_id IS NULL OR parent_task_id <> id),

    FOREIGN KEY (company_id, project_id)
        REFERENCES projects(company_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id, created_by)
        REFERENCES users(company_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id, assigned_manager_id)
        REFERENCES users(company_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id, assigned_to)
        REFERENCES users(company_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id, reviewer_id)
        REFERENCES users(company_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id, parent_task_id)
        REFERENCES tasks(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE task_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    project_id UUID NOT NULL,
    predecessor_task_id UUID NOT NULL,
    successor_task_id UUID NOT NULL,
    dependency_type VARCHAR(40) NOT NULL DEFAULT 'FINISH_TO_START_WITH_ACCEPTANCE'
        CHECK (dependency_type = 'FINISH_TO_START_WITH_ACCEPTANCE'),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (predecessor_task_id <> successor_task_id),
    UNIQUE (predecessor_task_id, successor_task_id),

    FOREIGN KEY (company_id, project_id)
        REFERENCES projects(company_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id, predecessor_task_id)
        REFERENCES tasks(project_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id, successor_task_id)
        REFERENCES tasks(project_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id, created_by)
        REFERENCES users(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE review_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    task_id UUID NOT NULL,
    reviewer_id UUID NOT NULL,
    decision VARCHAR(30) NOT NULL
        CHECK (decision IN ('APPROVED', 'CHANGES_REQUESTED')),
    comments TEXT,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (company_id, task_id)
        REFERENCES tasks(company_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id, reviewer_id)
        REFERENCES users(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_users_company_role ON users(company_id, role);
CREATE INDEX idx_projects_company_status ON projects(company_id, status);
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_assignee_status ON tasks(assigned_to, status);
CREATE INDEX idx_tasks_reviewer_status ON tasks(reviewer_id, status);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX idx_dependencies_successor ON task_dependencies(successor_task_id);
CREATE INDEX idx_reviews_task_date ON review_records(task_id, reviewed_at DESC);

COMMIT;

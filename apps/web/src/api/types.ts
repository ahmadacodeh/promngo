/**
 * API types — a 1:1 transcription of docs/api-contract.md (§1, §3, §6–§10).
 * If the server deviates, fix docs/api-contract.md §13 first, then this file.
 */

export type Role = 'EXECUTIVE_MANAGER' | 'PROJECT_MANAGER' | 'SPECIALIZED_MANAGER' | 'EMPLOYEE';
export type ProjectStatus = 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type TaskStatus =
  | 'PLANNED'
  | 'BLOCKED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'COMPLETED';
export type CompanyStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export const ROLES: readonly Role[] = ['EXECUTIVE_MANAGER', 'PROJECT_MANAGER', 'SPECIALIZED_MANAGER', 'EMPLOYEE'];
export const TASK_STATUSES: readonly TaskStatus[] = [
  'PLANNED',
  'BLOCKED',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'COMPLETED',
];
export const PROJECT_STATUSES: readonly ProjectStatus[] = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

/** Managers = executive manager + project manager (see every project/task of the company). */
export const MANAGER_ROLES: readonly Role[] = ['EXECUTIVE_MANAGER', 'PROJECT_MANAGER'];

export interface UserRef {
  id: string;
  fullName: string;
  role: Role;
}
export interface SpecRef {
  id: string;
  name: string;
}

export interface UserDto {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  canCreateProjects: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  specialization: SpecRef | null;
  createdAt: string;
}
export interface CompanyDto {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  createdAt: string;
}

export interface TaskDto {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  isRequired: boolean;
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
export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
}
export interface DependencyDto {
  id: string;
  projectId: string;
  predecessor: TaskRef;
  successor: TaskRef;
  dependencyType: 'FINISH_TO_START_WITH_ACCEPTANCE';
  createdAt: string;
}
export interface TaskCapabilities {
  edit: boolean;
  assign: boolean;
  start: boolean;
  submit: boolean;
  review: boolean;
  archive: boolean;
  delete: boolean;
  manageDependencies: boolean;
  createSubtask: boolean;
}
export interface TaskDetail extends TaskDto {
  project: { id: string; name: string; status: ProjectStatus };
  parent: { id: string; title: string } | null;
  subtasks: TaskDto[];
  predecessors: DependencyDto[];
  successors: DependencyDto[];
  blockedBy: TaskRef[];
  allowedNext: TaskStatus[];
  can: TaskCapabilities;
}
export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
  taskCounts: { total: number } & Partial<Record<TaskStatus, number>>;
  allowedNextStatuses: ProjectStatus[];
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
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED';
export interface ReviewDto {
  id: string;
  taskId: string;
  round: number;
  reviewer: UserRef;
  decision: ReviewDecision;
  comments: string | null;
  reviewedAt: string;
}
export interface TaskEventDto {
  id: string;
  taskId: string;
  type: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  actor: UserRef | null;
  meta: Record<string, unknown>;
  createdAt: string;
}
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PageQuery {
  page?: number;
  pageSize?: number;
}

/* ---- Errors (contract §0) ---- */
export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  hint?: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  requestId?: string;
}

/* ---- Auth (§3) ---- */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** seconds */
  expiresIn: number;
}
export interface AuthResponse extends AuthTokens {
  user: UserDto;
  company: CompanyDto;
  mustChangePassword: boolean;
}
export interface MeResponse {
  user: UserDto;
  company: CompanyDto;
}

/* ---- Users (§4) ---- */
export interface SpecializationDto extends SpecRef {
  description: string | null;
}
export interface CreateUserInput {
  fullName: string;
  email: string;
  role: Role;
  canCreateProjects?: boolean;
  specializationId?: string | null;
}
export interface UpdateUserInput {
  fullName?: string;
  role?: Role;
  canCreateProjects?: boolean;
  isActive?: boolean;
  specializationId?: string | null;
}
export interface CreateUserResponse {
  user: UserDto;
  temporaryPassword: string;
}
export interface UserListQuery extends PageQuery {
  role?: Role;
  active?: boolean;
  q?: string;
}

/* ---- Projects (§5) ---- */
export interface ProjectListQuery extends PageQuery {
  status?: ProjectStatus;
  q?: string;
}
export interface CreateProjectInput {
  name: string;
  description?: string;
}
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
}

/* ---- Tasks (§6) ---- */
export interface CreateTaskInput {
  title: string;
  description?: string;
  isRequired?: boolean;
  specializationId?: string | null;
  assignedManagerId?: string | null;
  assignedToId?: string | null;
  reviewerId?: string | null;
}
export type UpdateTaskInput = Partial<CreateTaskInput>;
export interface ProjectTaskListQuery extends PageQuery {
  status?: TaskStatus;
  parentOnly?: boolean;
  q?: string;
}
export type TaskScope = 'all' | 'mine' | 'review';
export interface TaskListQuery extends PageQuery {
  scope?: TaskScope;
  status?: TaskStatus;
  projectId?: string;
  q?: string;
  includeArchived?: boolean;
}
export interface TransitionInput {
  to: TaskStatus;
  reason?: string;
}
export interface CreateDependencyInput {
  predecessorTaskId: string;
  successorTaskId: string;
}

/* ---- Submission & review (§7) ---- */
export interface SubmitTaskResponse {
  submission: SubmissionDto;
  task: TaskDetail;
}
export interface CreateReviewInput {
  decision: ReviewDecision;
  comments?: string;
}
export interface CreateReviewResponse {
  review: ReviewDto;
  task: TaskDetail;
}

/* ---- Dashboard & reports (§8) ---- */
export interface DashboardResponse {
  role: Role;
  scope: 'COMPANY' | 'PERSONAL';
  projects: { total: number; byStatus: Partial<Record<ProjectStatus, number>> };
  tasks: { total: number; byStatus: Partial<Record<TaskStatus, number>> };
  myOpenTasks: number;
  awaitingMyReview: number;
  flaggedForReview: number;
  recentTasks: TaskListItem[];
  awaitingReviewTasks: TaskListItem[];
}
export interface ReportsOverview {
  period: { from: string; to: string; days: number };
  projects: { byStatus: Partial<Record<ProjectStatus, number>> };
  tasks: { byStatus: Partial<Record<TaskStatus, number>>; createdInPeriod: number; completedInPeriod: number };
  reviews: {
    approved: number;
    changesRequested: number;
    changesRequestRatePct: number | null;
    avgRoundsToApproval: number | null;
  };
  perProject: {
    projectId: string;
    name: string;
    status: ProjectStatus;
    totalTasks: number;
    completedTasks: number;
    progressPct: number;
  }[];
  perSpecialization: { specializationId: string | null; name: string; total: number; completed: number }[];
  definitions: Record<string, string>;
}

/* ---- Audit (§9) ---- */
export interface AuditEventDto {
  id: string;
  type: string;
  entity: string;
  entityId: string;
  actor: UserRef | null;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  meta: Record<string, unknown>;
  createdAt: string;
}
export interface AuditEventsQuery extends PageQuery {
  type?: string;
  taskId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}
export type AuditPeriod = 'daily' | 'weekly';
export interface AuditReport {
  period: AuditPeriod;
  from: string;
  to: string;
  totalEvents: number;
  byType: Record<string, number>;
  byActor: { actor: UserRef; count: number }[];
  statusChanges: number;
  reviews: { approved: number; changesRequested: number };
}
/** Stored report: contract §9 says only "Paged<...>"; shape inferred as the computed report plus identity fields. */
export interface StoredAuditReport extends AuditReport {
  id: string;
  createdAt: string;
}

/* ---- Subscription (§10) ---- */
export type BillingCycle = 'MONTHLY' | 'YEARLY';
export interface PlanDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  maxUsers: number | null;
  priceMonthly: string;
  priceYearly: string;
  currency: string;
  isSandbox: boolean;
  features: string[];
}
export interface SubscriptionDto {
  id: string;
  plan: PlanDto;
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED';
  billingCycle: BillingCycle;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}
export interface BillingDetails {
  contactName: string;
  contactEmail: string;
  taxId?: string;
  address?: string;
}
export interface OrderDto {
  id: string;
  plan: PlanDto;
  billingCycle: BillingCycle;
  amount: string;
  currency: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  paymentMethod: 'SANDBOX';
  billing: BillingDetails;
  createdAt: string;
  paidAt: string | null;
}
export interface CreateOrderInput {
  planId: string;
  billingCycle: BillingCycle;
  billing: BillingDetails;
}
export interface ConfirmOrderResponse {
  order: OrderDto;
  subscription: SubscriptionDto;
}

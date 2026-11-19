/** أنواع وثوابت وحدات العمل (المشاريع/المهام). نقية بلا اعتماد على قاعدة البيانات. */
export const TASK_STATUSES = ['PLANNED', 'BLOCKED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** الأولوية (قرار المالك T4). الترتيب من الأدنى إلى الأعلى. */
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_RANK: Record<Priority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 };

/** حالات المشروع التي لا تقبل تعديل المهام. */
export const CLOSED_PROJECT_STATUSES: readonly ProjectStatus[] = ['COMPLETED', 'CANCELLED'];
export const isProjectClosed = (s: ProjectStatus): boolean => CLOSED_PROJECT_STATUSES.includes(s);

/** انتقالات المشروع المسموحة (العقد §5). COMPLETED وCANCELLED نهائيتان. */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  PLANNED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** كل انتقالات المهمة المسموحة (FR-008). أي انتقال خارجها مرفوض. */
export const ALL_TASK_TRANSITIONS: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  ['PLANNED', 'ASSIGNED'],
  ['PLANNED', 'BLOCKED'],
  ['BLOCKED', 'ASSIGNED'],
  ['ASSIGNED', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'SUBMITTED'],
  ['SUBMITTED', 'UNDER_REVIEW'],
  ['UNDER_REVIEW', 'COMPLETED'],
  ['UNDER_REVIEW', 'CHANGES_REQUESTED'],
  ['CHANGES_REQUESTED', 'IN_PROGRESS'],
];

/** ما يُسمح به عبر POST /tasks/:id/transitions (الباقي تملكه submit والمراجعة). */
export const MANUAL_TASK_TRANSITIONS: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  ['PLANNED', 'ASSIGNED'],
  ['PLANNED', 'BLOCKED'],
  ['BLOCKED', 'ASSIGNED'],
  ['ASSIGNED', 'IN_PROGRESS'],
  ['CHANGES_REQUESTED', 'IN_PROGRESS'],
];

export const isAllowedTransition = (from: TaskStatus, to: TaskStatus): boolean => ALL_TASK_TRANSITIONS.some(([f, t]) => f === from && t === to);
export const isManualTransition = (from: TaskStatus, to: TaskStatus): boolean => MANUAL_TASK_TRANSITIONS.some(([f, t]) => f === from && t === to);

/** حالات «بدأ العمل»: تغيّر سابقة بعد بلوغها يُعلّم اللاحقة للمراجعة (FR-010). */
export const STARTED_STATUSES: readonly TaskStatus[] = ['IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED'];

export const FILE_LIMITS = { maxFiles: 5, maxBytes: 10 * 1024 * 1024, maxNote: 2000 } as const;

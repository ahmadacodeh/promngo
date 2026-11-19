import { isManager, type Role } from '../common/auth-user.js';
import { isProjectClosed, type ProjectStatus, type TaskStatus } from './model.js';

/** لقطة المهمة كما يحتاجها قرار الصلاحيات. */
export interface PolicyTask {
  status: TaskStatus;
  parentTaskId: string | null;
  createdBy: string;
  assignedManagerId: string | null;
  assignedTo: string | null;
  reviewerId: string | null;
  archived: boolean;
  projectStatus: ProjectStatus;
}
export interface PolicyContext {
  /** عدد السوابق غير المكتملة (غير المؤرشفة). */
  blockedByCount: number;
  hasDependencies: boolean;
  hasSubmissions: boolean;
}
export interface TaskCan {
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
export interface Actor {
  id: string;
  role: Role;
}

/** المدير المختص المعيّن على هذه المهمة (وبدوره SPECIALIZED_MANAGER). */
export const isAssignedManager = (a: Actor, t: Pick<PolicyTask, 'assignedManagerId'>): boolean =>
  a.role === 'SPECIALIZED_MANAGER' && t.assignedManagerId === a.id;

/** هل يرى المستخدم المهمة؟ المدراء كل شيء؛ غيرهم المنشئ/المكلّف/المراجع/المدير المختص. */
export function canSeeTask(a: Actor, t: Pick<PolicyTask, 'createdBy' | 'assignedManagerId' | 'assignedTo' | 'reviewerId'>): boolean {
  return isManager(a.role) || [t.createdBy, t.assignedManagerId, t.assignedTo, t.reviewerId].includes(a.id);
}

/**
 * قرار الصلاحيات الوحيد لما يستطيع المستدعي فعله على مهمة الآن. تستعمله الخدمات للفرض
 * وتعرضه الواجهة (`can`/`allowedNext`) لتبسيط الأزرار فقط — الفرض الحقيقي دائمًا في الخادم.
 */
export function taskCapabilities(a: Actor, t: PolicyTask, ctx: PolicyContext): { can: TaskCan; allowedNext: TaskStatus[] } {
  const open = !isProjectClosed(t.projectStatus) && !t.archived;
  const mgr = isManager(a.role);
  const am = isAssignedManager(a, t);
  const assignee = t.assignedTo === a.id;
  const reviewer = t.reviewerId === a.id && t.assignedTo !== a.id;
  const isSubtask = t.parentTaskId !== null;

  const can: TaskCan = {
    edit: open && mgr,
    assign: open && (mgr || am),
    start: open && assignee && (t.status === 'ASSIGNED' || t.status === 'CHANGES_REQUESTED'),
    submit: open && assignee && t.status === 'IN_PROGRESS',
    review: open && reviewer && t.status === 'UNDER_REVIEW',
    archive: open && isSubtask && (mgr || am),
    delete: open && isSubtask && (mgr || am) && (t.status === 'PLANNED' || t.status === 'BLOCKED') && !ctx.hasDependencies && !ctx.hasSubmissions,
    manageDependencies: open && mgr,
    createSubtask: open && !isSubtask && (mgr || am),
  };

  const next: TaskStatus[] = [];
  const hasPeople = t.assignedTo !== null && t.reviewerId !== null;
  if (can.assign) {
    if (t.status === 'PLANNED') {
      if (hasPeople) next.push('ASSIGNED');
      next.push('BLOCKED');
    }
    if (t.status === 'BLOCKED' && hasPeople) next.push('ASSIGNED');
  }
  if (can.start && ctx.blockedByCount === 0) next.push('IN_PROGRESS');
  return { can, allowedNext: next };
}

/** صلاحية الإنشاء: المدير التنفيذي/مدير المشروع و`canCreateProjects` معًا (لا أحدهما). */
export const canCreateProject = (a: { role: Role; canCreateProjects: boolean }): boolean => isManager(a.role) && a.canCreateProjects;

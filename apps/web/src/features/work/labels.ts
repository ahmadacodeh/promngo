/**
 * Shared presentation rules for projects and tasks (all screens use these; never colour alone:
 * StatusBadge always pairs the tone with an icon and a text label).
 */
import type { Priority, ProjectStatus, TaskStatus } from '@/api/types';
import type { Tone } from '@/components/StatusBadge.vue';
import { PROJECT_STATUS_LABELS, TASK_STATUS_LABELS } from '@/i18n/ar';

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  PLANNED: 'neutral',
  BLOCKED: 'danger',
  ASSIGNED: 'neutral',
  IN_PROGRESS: 'success',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  CHANGES_REQUESTED: 'warning',
  COMPLETED: 'success',
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  PLANNED: 'neutral',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'info',
  CANCELLED: 'danger',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  URGENT: 'عاجلة',
  HIGH: 'عالية',
  MEDIUM: 'متوسطة',
  LOW: 'منخفضة',
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  URGENT: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'neutral',
};

export const taskStatusBadge = (s: TaskStatus) => ({ label: TASK_STATUS_LABELS[s], tone: TASK_STATUS_TONE[s] });
export const projectStatusBadge = (s: ProjectStatus) => ({ label: PROJECT_STATUS_LABELS[s], tone: PROJECT_STATUS_TONE[s] });
export const priorityBadge = (p: Priority) => ({ label: `أولوية ${PRIORITY_LABELS[p]}`, tone: PRIORITY_TONE[p] });

/** Open = anything not completed (the server's own definition for "open" work). */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['PLANNED', 'BLOCKED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'];

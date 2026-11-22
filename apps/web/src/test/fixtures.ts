import type { ProjectDto, TaskCapabilities, TaskDetail, TaskListItem } from '@/api/types';

export const mkTask = (over: Partial<TaskListItem> & Pick<TaskListItem, 'id' | 'title'>): TaskListItem => ({
  projectId: 'p1', parentTaskId: null, description: null, status: 'IN_PROGRESS', isRequired: true, priority: 'MEDIUM',
  dueDate: null, isOverdue: false, specialization: null,
  createdBy: { id: 'u1', fullName: 'سارة', role: 'EXECUTIVE_MANAGER' }, assignedManager: null,
  assignedTo: { id: 'u9', fullName: 'ليلى', role: 'EMPLOYEE' }, reviewer: null, needsReview: false, archivedAt: null,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  projectName: 'بوابة العملاء', subtaskCount: 0, completedSubtaskCount: 0, ...over,
});

export const mkProject = (over: Partial<ProjectDto> & Pick<ProjectDto, 'id' | 'name'>): ProjectDto => ({
  description: null, status: 'ACTIVE', startDate: null, dueDate: null,
  createdBy: { id: 'u1', fullName: 'سارة', role: 'EXECUTIVE_MANAGER' },
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  taskCounts: { total: 0 }, progressPct: 0, overdueCount: 0, allowedNextStatuses: [], ...over,
});

const NO_CAN: TaskCapabilities = { edit: false, assign: false, start: false, submit: false, review: false, archive: false, delete: false, manageDependencies: false, createSubtask: false };
export const mkDetail = (over: Partial<Omit<TaskDetail, 'can'>> & Pick<TaskDetail, 'id' | 'title'> & { can?: Partial<TaskCapabilities> }): TaskDetail => {
  const { can, ...rest } = over;
  const { projectName: _p, subtaskCount: _s, completedSubtaskCount: _c, ...base } = mkTask({ id: over.id, title: over.title });
  return {
    ...base,
    project: { id: 'p1', name: 'بوابة العملاء', status: 'ACTIVE' }, parent: null, subtasks: [], predecessors: [], successors: [], blockedBy: [], allowedNext: [],
    ...rest,
    can: { ...NO_CAN, ...can },
  };
};

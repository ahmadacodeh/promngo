import { http } from '../http';
import type {
  AttachmentDto,
  CreateDependencyInput,
  CreateReviewInput,
  CreateReviewResponse,
  CreateTaskInput,
  DependencyDto,
  Paged,
  ProjectTaskListQuery,
  ReviewDto,
  SubmissionDto,
  SubmitTaskResponse,
  TaskDetail,
  TaskEventDto,
  TaskListItem,
  TaskListQuery,
  TransitionInput,
  UpdateTaskInput,
} from '../types';

export const tasksApi = {
  /** Cross-project list (contract §6): scope=all|mine|review. */
  list: (q: TaskListQuery = {}) => http.get<Paged<TaskListItem>>('/tasks', { query: { ...q } }),
  listForProject: (projectId: string, q: ProjectTaskListQuery = {}) =>
    http.get<Paged<TaskListItem>>(`/projects/${projectId}/tasks`, { query: { ...q } }),
  get: (id: string) => http.get<TaskDetail>(`/tasks/${id}`),
  create: (projectId: string, input: CreateTaskInput) => http.post<TaskDetail>(`/projects/${projectId}/tasks`, input),
  createSubtask: (projectId: string, parentTaskId: string, input: CreateTaskInput) =>
    http.post<TaskDetail>(`/projects/${projectId}/tasks/${parentTaskId}/subtasks`, input),
  update: (id: string, input: UpdateTaskInput) => http.patch<TaskDetail>(`/tasks/${id}`, input),
  /** Manual transitions only: PLANNED>ASSIGNED|BLOCKED, BLOCKED>ASSIGNED, ASSIGNED>IN_PROGRESS, CHANGES_REQUESTED>IN_PROGRESS. */
  transition: (id: string, input: TransitionInput) => http.post<TaskDetail>(`/tasks/${id}/transitions`, input),
  archive: (id: string) => http.post<TaskDetail>(`/tasks/${id}/archive`),
  remove: (id: string) => http.delete<void>(`/tasks/${id}`),
  clearReviewFlag: (id: string) => http.post<TaskDetail>(`/tasks/${id}/clear-review-flag`),
  events: (id: string) => http.get<TaskEventDto[]>(`/tasks/${id}/events`),
};

export const dependenciesApi = {
  create: (projectId: string, input: CreateDependencyInput) =>
    http.post<DependencyDto>(`/projects/${projectId}/dependencies`, input),
  remove: (id: string) => http.delete<void>(`/dependencies/${id}`),
};

export const deliveryApi = {
  /** multipart: `note` (optional) + `files` (1–5). The server moves the task to UNDER_REVIEW. */
  submit: (taskId: string, input: { note?: string; files: File[] }) => {
    const fd = new FormData();
    if (input.note) fd.append('note', input.note);
    for (const f of input.files) fd.append('files', f, f.name);
    return http.post<SubmitTaskResponse>(`/tasks/${taskId}/submit`, fd, { timeoutMs: 120_000 });
  },
  submissions: (taskId: string) => http.get<SubmissionDto[]>(`/tasks/${taskId}/submissions`),
  review: (taskId: string, input: CreateReviewInput) =>
    http.post<CreateReviewResponse>(`/tasks/${taskId}/reviews`, input),
  reviews: (taskId: string) => http.get<ReviewDto[]>(`/tasks/${taskId}/reviews`),
  /** Returns the raw file; use saveBlob() from utils/download to hand it to the user. */
  downloadAttachment: (attachment: Pick<AttachmentDto, 'id'>) =>
    http.get<Blob>(`/attachments/${attachment.id}/download`, { responseType: 'blob', timeoutMs: 120_000 }),
};

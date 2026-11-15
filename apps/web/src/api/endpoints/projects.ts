import { http } from '../http';
import type {
  CreateProjectInput,
  Paged,
  ProjectDto,
  ProjectListQuery,
  UpdateProjectInput,
} from '../types';

export const projectsApi = {
  list: (q: ProjectListQuery = {}) => http.get<Paged<ProjectDto>>('/projects', { query: { ...q } }),
  create: (input: CreateProjectInput) => http.post<ProjectDto>('/projects', input),
  get: (id: string) => http.get<ProjectDto>(`/projects/${id}`),
  update: (id: string, input: UpdateProjectInput) => http.patch<ProjectDto>(`/projects/${id}`, input),
};

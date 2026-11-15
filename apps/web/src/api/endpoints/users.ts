import { http } from '../http';
import type {
  CompanyDto,
  CreateUserInput,
  CreateUserResponse,
  Paged,
  SpecializationDto,
  UpdateUserInput,
  UserDto,
  UserListQuery,
} from '../types';

export const usersApi = {
  list: (q: UserListQuery = {}) =>
    http.get<Paged<UserDto>>('/users', { query: { ...q } }),
  get: (id: string) => http.get<UserDto>(`/users/${id}`),
  /** EXEC only. The temporary password is returned ONCE. */
  create: (input: CreateUserInput) => http.post<CreateUserResponse>('/users', input),
  update: (id: string, input: UpdateUserInput) => http.patch<UserDto>(`/users/${id}`, input),
  resetPassword: (id: string) => http.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
};

export const specializationsApi = {
  list: (page = 1, pageSize = 200) =>
    http.get<Paged<SpecializationDto>>('/specializations', { query: { page, pageSize } }),
};

export const companyApi = {
  current: () => http.get<CompanyDto>('/companies/current'),
  /** EXEC only. */
  update: (input: { name: string }) => http.patch<CompanyDto>('/companies/current', input),
};

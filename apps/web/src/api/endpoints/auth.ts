import { http } from '../http';
import type { AuthResponse, MeResponse } from '../types';

export const authApi = {
  login: (email: string, password: string) => http.post<AuthResponse>('/auth/login', { email, password }, { auth: false }),
  refresh: (refreshToken: string) => http.post<AuthResponse>('/auth/refresh', { refreshToken }, { auth: false }),
  /** Public: accepts an expired refresh token too (contract §3). */
  logout: (refreshToken: string) => http.post<void>('/auth/logout', { refreshToken }, { auth: false }),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<AuthResponse>('/auth/change-password', { currentPassword, newPassword }),
  me: () => http.get<MeResponse>('/auth/me'),
  health: () => http.get<{ status: 'ok'; db: 'up' }>('/health', { auth: false }),
};

import { http } from '../http';
import type { DashboardResponse, ReportsOverview } from '../types';

export const dashboardApi = {
  get: () => http.get<DashboardResponse>('/dashboard'),
};

export const reportsApi = {
  /** EXEC/PM only (others get 403). */
  overview: (days: 7 | 30 | 90 = 30) => http.get<ReportsOverview>('/reports/overview', { query: { days } }),
};

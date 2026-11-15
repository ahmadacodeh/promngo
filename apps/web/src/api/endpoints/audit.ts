import { http } from '../http';
import type {
  AuditEventDto,
  AuditEventsQuery,
  AuditPeriod,
  AuditReport,
  PageQuery,
  Paged,
  StoredAuditReport,
} from '../types';

/** All audit endpoints are EXEC only (contract §9: assumption pending owner confirmation). */
export const auditApi = {
  events: (q: AuditEventsQuery = {}) => http.get<Paged<AuditEventDto>>('/audit/events', { query: { ...q } }),
  report: (period: AuditPeriod, date?: string) => http.get<AuditReport>('/audit/report', { query: { period, date } }),
  saveReport: (period: AuditPeriod) => http.post<StoredAuditReport>('/audit/reports', { period }),
  reports: (q: PageQuery = {}) => http.get<Paged<StoredAuditReport>>('/audit/reports', { query: { ...q } }),
  /** Manual purge; the server keeps at least 7 days. */
  purge: (olderThanDays: number) =>
    http.delete<{ deleted: number }>('/audit/events', { query: { olderThanDays } }),
};

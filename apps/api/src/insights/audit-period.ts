/**
 * فترات تقرير التدقيق بتوقيت UTC (الخادم لا يعرف منطقة المستخدم الزمنية).
 *  - daily: اليوم المحدد كاملًا [00:00، 00:00 اليوم التالي).
 *  - weekly: 7 أيام تنتهي باليوم المحدد (شاملًا).
 * `date` تاريخ تقويمي YYYY-MM-DD؛ الافتراضي اليوم (UTC).
 */
export type AuditPeriod = 'daily' | 'weekly';
const DAY_MS = 86_400_000;

export function auditPeriodRange(period: AuditPeriod, date: string | undefined, now: Date = new Date()): { from: Date; to: Date } {
  const day = date ? new Date(`${date}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(day.getTime() + DAY_MS);
  const from = period === 'daily' ? day : new Date(day.getTime() - 6 * DAY_MS);
  return { from, to };
}

/** نطاق تاريخين شاملين [from، to] إلى حدود زمنية نصف مفتوحة. */
export function inclusiveDayBounds(from?: string, to?: string): { gte?: Date; lt?: Date } {
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS) } : {}),
  };
}

export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 30;

/**
 * دالة نقية: كم ثانية يجب الانتظار حتى يُسمح بمحاولة جديدة؟
 * failureTimes = أزمنة المحاولات الفاشلة داخل النافذة (بأي ترتيب).
 * الحجب يرتفع عندما تخرج الفاشلة رقم (n - limit + 1) من النافذة.
 */
export function computeRetryAfterSeconds(failureTimes: Date[], limit: number, now: Date, windowMs = THROTTLE_WINDOW_MS): number {
  const live = failureTimes.map((d) => d.getTime()).filter((t) => t > now.getTime() - windowMs).sort((a, b) => a - b);
  if (live.length < limit) return 0;
  const liftsAt = live[live.length - limit]! + windowMs;
  return Math.max(1, Math.ceil((liftsAt - now.getTime()) / 1000));
}

/**
 * Arabic formatting with Western digits (as in the Figma designs: "12", "92%").
 * All functions are pure; `now` is injectable for tests.
 */
const LOCALE = 'ar-u-nu-latn';

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
const numFmt = new Intl.NumberFormat(LOCALE);

/** Calendar date "YYYY-MM-DD" (no time zone shift). Returns '' for null/invalid. */
export function formatDate(ymd: string | null | undefined, short = false): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return '';
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : (short ? shortDateFmt : dateFmt).format(d);
}

/** "منذ 20 دقيقة"، "أمس"… from an ISO timestamp. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.round((t - now.getTime()) / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(sec / 86_400), 'day');
  if (abs < 365 * 86_400) return rtf.format(Math.round(sec / (30 * 86_400)), 'month');
  return rtf.format(Math.round(sec / (365 * 86_400)), 'year');
}

export const formatNumber = (n: number): string => numFmt.format(n);

/** Whole percentage of part/total; null when total is 0 (show "—", never a fake 0%). */
export function percent(part: number, total: number): number | null {
  if (!total) return null;
  return Math.round((part / total) * 100);
}

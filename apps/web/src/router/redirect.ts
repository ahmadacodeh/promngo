/** Only same-origin app paths are accepted as post-login targets (blocks open redirects like //evil.com or https://…). */
export function safeRedirect(raw: unknown, fallback = '/dashboard'): string {
  if (typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\r\n]/.test(raw)) return fallback;
  if (raw.startsWith('/login')) return fallback;
  return raw;
}

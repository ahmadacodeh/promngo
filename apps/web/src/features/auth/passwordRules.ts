import { AUTH_COPY } from './copy';

export const MIN_LENGTH = 10;
export const MAX_BYTES = 72;

/** Client-side mirror of the server policy (UX only — the server is the authority). Returns the first problem or ''. */
export function newPasswordProblem(pw: string, current: string, email: string): string {
  if (!pw) return AUTH_COPY.newRequired;
  if ([...pw].length < MIN_LENGTH) return AUTH_COPY.tooShort;
  if (new TextEncoder().encode(pw).length > MAX_BYTES) return AUTH_COPY.tooLong;
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) return AUTH_COPY.needLetterDigit;
  if (pw === current) return AUTH_COPY.same;
  if (pw.toLowerCase() === email.toLowerCase()) return AUTH_COPY.same;
  return '';
}

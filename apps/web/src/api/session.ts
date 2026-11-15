/**
 * Token holder.
 *  - access token: memory only (lost on reload; recovered through the refresh token).
 *  - refresh token: sessionStorage (cleared when the tab closes). Known trade-off recorded in
 *    docs/phase-j-audit.md §6: an httpOnly cookie would be stronger but needs an architecture decision.
 * Passwords are never stored here.
 */
const REFRESH_KEY = 'promango.rt';

let accessToken: string | null = null;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  try {
    return storage()?.getItem(REFRESH_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setTokens(tokens: { accessToken: string; refreshToken: string }): void {
  accessToken = tokens.accessToken;
  try {
    storage()?.setItem(REFRESH_KEY, tokens.refreshToken);
  } catch {
    /* storage blocked: the session will simply not survive a reload */
  }
}

export function clearTokens(): void {
  accessToken = null;
  try {
    storage()?.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

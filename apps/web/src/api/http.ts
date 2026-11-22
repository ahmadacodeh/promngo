import type { ApiError, AuthResponse } from './types';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './session';
import { NETWORK_MESSAGES, statusFallbackMessage } from '@/i18n/ar';

/** Normalised error thrown by every API call (contract §0 ApiError + client-side flags). */
export class HttpError extends Error implements ApiError {
  readonly statusCode: number;
  readonly code: string;
  readonly hint?: string;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  /** true when no HTTP response was received (offline, DNS, refused, CORS). */
  readonly isNetwork: boolean;
  readonly isTimeout: boolean;

  constructor(e: ApiError, flags: { isNetwork?: boolean; isTimeout?: boolean } = {}) {
    super(e.message);
    this.name = 'HttpError';
    this.statusCode = e.statusCode;
    this.code = e.code;
    if (e.hint !== undefined) this.hint = e.hint;
    if (e.fields !== undefined) this.fields = e.fields;
    if (e.details !== undefined) this.details = e.details;
    if (e.requestId !== undefined) this.requestId = e.requestId;
    this.isNetwork = flags.isNetwork ?? false;
    this.isTimeout = flags.isTimeout ?? false;
  }
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}

export interface RequestOptions {
  /** Arrays are sent comma-separated (the API splits them); empty values are dropped. */
  query?: Record<string, string | number | boolean | readonly string[] | null | undefined>;
  /** JSON body (object) or FormData (multipart: Content-Type is set by the browser). */
  body?: unknown;
  /** false for public endpoints (login/refresh/logout/health). Default true. */
  auth?: boolean;
  responseType?: 'json' | 'blob';
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HttpHooks {
  /** Called after a silent refresh so the auth store can sync the user/company. */
  onTokensRefreshed?: (res: AuthResponse) => void;
  /** Called when the session cannot be recovered (refresh failed). */
  onSessionExpired?: () => void;
  /** Called for every non-2xx API response (after normalisation) so global codes can be handled in one place. */
  onApiError?: (err: HttpError) => void;
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** 401 codes that mean "wrong input", not "expired token": never trigger a refresh. */
const NO_REFRESH_CODES = new Set(['INVALID_CREDENTIALS', 'INVALID_REFRESH_TOKEN']);

export function buildQuery(params?: RequestOptions['query']): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','));
      continue;
    }
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'STATE_CONFLICT';
    case 413:
      return 'FILE_TOO_LARGE';
    case 429:
      return 'TOO_MANY_ATTEMPTS';
    default:
      return 'INTERNAL_ERROR';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Turns any failed response into the contract ApiError, even when the body is not JSON. */
async function normaliseErrorResponse(res: Response): Promise<HttpError> {
  let body: unknown = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (isRecord(body) && typeof body.code === 'string' && typeof body.message === 'string') {
    const err: ApiError = {
      statusCode: typeof body.statusCode === 'number' ? body.statusCode : res.status,
      code: body.code,
      message: body.message,
    };
    if (typeof body.hint === 'string') err.hint = body.hint;
    if (isRecord(body.fields)) err.fields = body.fields as Record<string, string>;
    if (isRecord(body.details)) err.details = body.details;
    if (typeof body.requestId === 'string') err.requestId = body.requestId;
    return new HttpError(err);
  }
  return new HttpError({
    statusCode: res.status,
    code: codeForStatus(res.status),
    message: statusFallbackMessage(res.status),
  });
}

export interface HttpClient {
  request<T>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  get<T>(path: string, opts?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  delete<T>(path: string, opts?: RequestOptions): Promise<T>;
  configure(hooks: HttpHooks): void;
}

export function createHttpClient(config: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): HttpClient {
  const baseUrl = config.baseUrl ?? '/api';
  const doFetch = (input: string, init: RequestInit) => (config.fetchImpl ?? fetch)(input, init);
  let hooks: HttpHooks = {};
  let refreshInFlight: Promise<boolean> | null = null;

  /** Single-flight silent refresh: N concurrent 401s trigger exactly one /auth/refresh call. */
  function refreshSession(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await doFetch(`${baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as AuthResponse;
        setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        hooks.onTokensRefreshed?.(data);
        return true;
      } catch {
        return false;
      } finally {
        // cleared on the next microtask so concurrent awaiters all observe the same result
        queueMicrotask(() => {
          refreshInFlight = null;
        });
      }
    })();
    return refreshInFlight;
  }

  async function send(method: string, path: string, opts: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const headers: Record<string, string> = { Accept: opts.responseType === 'blob' ? '*/*' : 'application/json' };
    let body: BodyInit | undefined;
    if (opts.body instanceof FormData) {
      body = opts.body;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (opts.auth !== false) {
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    try {
      const init: RequestInit = { method, headers, signal: controller.signal };
      if (body !== undefined) init.body = body;
      return await doFetch(`${baseUrl}${path}${buildQuery(opts.query)}`, init);
    } catch (e) {
      if (opts.signal?.aborted && !timedOut) throw e; // caller cancelled: let AbortError through
      if (timedOut) {
        throw new HttpError(
          { statusCode: 0, code: 'TIMEOUT', message: NETWORK_MESSAGES.timeout },
          { isNetwork: true, isTimeout: true },
        );
      }
      throw new HttpError(
        { statusCode: 0, code: 'NETWORK_ERROR', message: NETWORK_MESSAGES.offline },
        { isNetwork: true },
      );
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    let res = await send(method, path, opts);

    if (res.status === 401 && opts.auth !== false) {
      const err = await normaliseErrorResponse(res.clone());
      if (!NO_REFRESH_CODES.has(err.code)) {
        const ok = await refreshSession();
        if (ok) {
          res = await send(method, path, opts); // retry exactly once
        } else {
          clearTokens();
          hooks.onSessionExpired?.();
          throw err;
        }
      }
    }

    if (!res.ok) {
      const err = await normaliseErrorResponse(res);
      if (res.status === 401 && opts.auth !== false && !NO_REFRESH_CODES.has(err.code)) {
        // still 401 after a successful refresh: the session is unusable
        clearTokens();
        hooks.onSessionExpired?.();
      }
      hooks.onApiError?.(err);
      throw err;
    }
    if (res.status === 204) return undefined as T;
    if (opts.responseType === 'blob') return (await res.blob()) as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new HttpError({ statusCode: res.status, code: 'BAD_RESPONSE', message: NETWORK_MESSAGES.badResponse });
    }
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    delete: (path, opts) => request('DELETE', path, opts),
    configure(h) {
      hooks = h;
    },
  };
}

/** App-wide singleton used by src/api/endpoints/*. */
export const http: HttpClient = createHttpClient();

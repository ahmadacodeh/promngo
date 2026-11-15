import { readonly, shallowReactive } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  run: () => void;
}
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: ToastAction;
}
export interface ToastOptions {
  detail?: string;
  /** e.g. { label: 'إعادة المحاولة', run: retryFn } on error toasts */
  action?: ToastAction;
  /** ms; 0 = sticky. Defaults: success/info 4000, error 8000 (error with action: sticky). */
  duration?: number;
}

const toasts = shallowReactive<ToastItem[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let seq = 0;
const MAX_VISIBLE = 4;

function dismiss(id: number): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  const i = toasts.findIndex((x) => x.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

function push(kind: ToastKind, message: string, opts: ToastOptions = {}): number {
  const id = ++seq;
  const item: ToastItem = { id, kind, message };
  if (opts.detail) item.detail = opts.detail;
  if (opts.action) item.action = opts.action;
  toasts.push(item);
  while (toasts.length > MAX_VISIBLE) {
    const first = toasts[0];
    if (!first) break;
    dismiss(first.id);
  }
  const duration = opts.duration ?? (kind === 'error' ? (opts.action ? 0 : 8000) : 4000);
  if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration));
  return id;
}

function clear(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  toasts.splice(0, toasts.length);
}

/** Global toast queue (module singleton). Render it once with <ToastHost />. */
export function useToast() {
  return {
    toasts: readonly(toasts),
    push,
    success: (message: string, opts?: ToastOptions) => push('success', message, opts),
    error: (message: string, opts?: ToastOptions) => push('error', message, opts),
    info: (message: string, opts?: ToastOptions) => push('info', message, opts),
    dismiss,
    clear,
  };
}

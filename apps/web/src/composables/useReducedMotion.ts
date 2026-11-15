import { onScopeDispose, ref, type Ref } from 'vue';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Non-reactive snapshot (use inside plain functions). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/**
 * Reactive `prefers-reduced-motion: reduce`. The single place JS animations consult
 * (CSS is covered globally in styles/base.css).
 */
export function useReducedMotion(): Ref<boolean> {
  const reduced = ref(prefersReducedMotion());
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return reduced;
  const mql = window.matchMedia(QUERY);
  const onChange = (ev: MediaQueryListEvent) => {
    reduced.value = ev.matches;
  };
  mql.addEventListener('change', onChange);
  onScopeDispose(() => mql.removeEventListener('change', onChange));
  return reduced;
}

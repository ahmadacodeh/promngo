import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { prefersReducedMotion } from './useReducedMotion';

/**
 * Animated number: eases from the previous value to `target` (ease-out cubic).
 * Under prefers-reduced-motion (or no rAF) it jumps straight to the final value.
 */
export function useCountUp(target: Ref<number>, durationMs = 700): Ref<number> {
  const shown = ref(0);
  let raf = 0;

  function cancel() {
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
  }

  function run(to: number) {
    cancel();
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function' || durationMs <= 0) {
      shown.value = to;
      return;
    }
    const from = shown.value;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      shown.value = Math.round(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else raf = 0;
    };
    raf = requestAnimationFrame(step);
  }

  watch(target, (v) => run(v), { immediate: true });
  onScopeDispose(cancel);
  return shown;
}

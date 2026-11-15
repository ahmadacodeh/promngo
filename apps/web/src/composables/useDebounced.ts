import { onScopeDispose, ref, watch, type Ref } from 'vue';

/** Returns a ref that follows `source` after `delayMs` of silence (search boxes). */
export function useDebounced<T>(source: Ref<T>, delayMs = 300): Ref<T> {
  const out = ref(source.value) as Ref<T>;
  let t: ReturnType<typeof setTimeout> | undefined;
  watch(source, (v) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      out.value = v;
    }, delayMs);
  });
  onScopeDispose(() => {
    if (t) clearTimeout(t);
  });
  return out;
}

import { onScopeDispose, ref, shallowRef, type Ref } from 'vue';

export interface AsyncData<T> {
  data: Ref<T | null>;
  error: Ref<unknown>;
  loading: Ref<boolean>;
  /** true after the first completed attempt (success or failure) */
  settled: Ref<boolean>;
  load: () => Promise<void>;
}

/**
 * Standard loading/error/data holder for views: `await load()` can be called again for "retry".
 * Out-of-order responses are discarded (only the latest call wins).
 */
export function useAsyncData<T>(fetcher: () => Promise<T>): AsyncData<T> {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const error = shallowRef<unknown>(null);
  const loading = ref(false);
  const settled = ref(false);
  let seq = 0;
  let alive = true;
  onScopeDispose(() => {
    alive = false;
  });

  async function load() {
    const mine = ++seq;
    loading.value = true;
    error.value = null;
    try {
      const res = await fetcher();
      if (alive && mine === seq) data.value = res;
    } catch (e) {
      if (alive && mine === seq) error.value = e;
    } finally {
      if (alive && mine === seq) {
        loading.value = false;
        settled.value = true;
      }
    }
  }
  return { data, error, loading, settled, load };
}

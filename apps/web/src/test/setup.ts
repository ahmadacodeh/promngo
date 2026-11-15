import { afterEach } from 'vitest';
import { config } from '@vue/test-utils';

// jsdom has no matchMedia/scrollTo; components use them defensively but tests must not crash.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
}
config.global.stubs = { transition: false, 'transition-group': false };
afterEach(() => {
  document.body.innerHTML = '';
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

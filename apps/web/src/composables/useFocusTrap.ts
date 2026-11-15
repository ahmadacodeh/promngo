import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `active`: Tab/Shift+Tab cycle inside `container`, focus moves in on open and
 * returns to the previously focused element on close.
 */
export function useFocusTrap(container: Ref<HTMLElement | null>, active: Ref<boolean>, initialFocus?: Ref<HTMLElement | null>) {
  let previous: HTMLElement | null = null;

  function focusables(): HTMLElement[] {
    return container.value ? Array.from(container.value.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) {
      e.preventDefault();
      container.value?.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const current = document.activeElement;
    if (e.shiftKey && (current === first || !container.value?.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !container.value?.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  }

  watch(
    active,
    async (on) => {
      if (on) {
        previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.addEventListener('keydown', onKeydown);
        await nextTick();
        const target = initialFocus?.value ?? focusables()[0] ?? container.value;
        target?.focus();
      } else {
        document.removeEventListener('keydown', onKeydown);
        previous?.focus();
        previous = null;
      }
    },
    { immediate: true, flush: 'post' },
  );

  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
}

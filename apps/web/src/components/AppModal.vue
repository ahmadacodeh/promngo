<script setup lang="ts">
import { computed, ref, toRef, useId } from 'vue';
import AppIcon from './AppIcon.vue';
import { COMMON } from '@/i18n/ar';
import { useFocusTrap } from '@/composables/useFocusTrap';

const props = withDefaults(defineProps<{ open: boolean; title: string; closeOnBackdrop?: boolean; width?: string }>(), { closeOnBackdrop: true, width: '520px' });
const emit = defineEmits<{ close: [] }>();

const titleId = useId();
const panel = ref<HTMLElement | null>(null);
useFocusTrap(panel, toRef(props, 'open'));
const style = computed(() => ({ maxInlineSize: props.width }));

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('close');
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="props.open" class="backdrop" @mousedown.self="props.closeOnBackdrop && emit('close')" @keydown="onKey">
        <div ref="panel" class="modal" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" :style="style">
          <header class="modal__head">
            <h2 :id="titleId">{{ props.title }}</h2>
            <button type="button" class="modal__x" :aria-label="COMMON.close" @click="emit('close')"><AppIcon name="x" /></button>
          </header>
          <div class="modal__body"><slot /></div>
          <footer v-if="$slots.footer" class="modal__foot"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: var(--z-modal); display: grid; place-items: center; padding: var(--sp-4); background: var(--overlay); }
.modal { inline-size: 100%; max-block-size: calc(100vh - 2 * var(--sp-4)); display: grid; grid-template-rows: auto 1fr auto; background: var(--surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-pop); overflow: hidden; }
.modal__head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5); border-block-end: 1px solid var(--line); }
.modal__x { background: none; border: 0; color: var(--muted); border-radius: var(--radius-sm); padding: var(--sp-1); }
.modal__body { padding: var(--sp-5); overflow: auto; }
.modal__foot { display: flex; justify-content: flex-end; gap: var(--sp-2); padding: var(--sp-4) var(--sp-5); border-block-start: 1px solid var(--line); background: var(--canvas); }
.modal-enter-active, .modal-leave-active { transition: opacity var(--dur-base) ease; }
.modal-enter-active .modal, .modal-leave-active .modal { transition: transform var(--dur-base) var(--ease); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal { transform: translateY(var(--rise)); }
</style>

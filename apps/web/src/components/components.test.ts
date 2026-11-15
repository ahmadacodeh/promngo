import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppModal from './AppModal.vue';
import ErrorState from './ErrorState.vue';
import StatusBadge from './StatusBadge.vue';
import TextField from './TextField.vue';
import ToastHost from './ToastHost.vue';
import { HttpError } from '@/api/http';
import { useToast } from '@/composables/useToast';

describe('TextField', () => {
  it('الوسم مرتبط بالحقل، والخطأ معلن للقارئات (aria-invalid/describedby/role=alert)', () => {
    const w = mount(TextField, { props: { modelValue: '', label: 'البريد', error: 'مطلوب', hint: 'تلميح' } });
    const input = w.find('input');
    expect(w.find('label').attributes('for')).toBe(input.attributes('id'));
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toContain(`${input.attributes('id')}-err`);
    expect(w.find('[role="alert"]').text()).toContain('مطلوب');
    expect(w.text()).not.toContain('تلميح'); // التلميح يُخفى أثناء الخطأ
  });
  it('v-model يصدر update:modelValue', async () => {
    const w = mount(TextField, { props: { modelValue: '', label: 'س' } });
    await w.find('input').setValue('abc');
    expect(w.emitted('update:modelValue')![0]).toEqual(['abc']);
  });
});

describe('StatusBadge', () => {
  it.each(['success', 'warning', 'danger', 'info', 'neutral'] as const)('%s: نص + أيقونة (لا اعتماد على اللون وحده)', (tone) => {
    const w = mount(StatusBadge, { props: { tone, label: 'مكتملة' } });
    expect(w.text()).toContain('مكتملة');
    expect(w.find('svg').exists()).toBe(true);
  });
});

const err = (code: string, message = 'رسالة الخادم') => new HttpError({ statusCode: 500, code, message, requestId: 'req-123' });

describe('ErrorState', () => {
  it('يعرض ماذا/لماذا/كيف ورقم الطلب، ويصدر retry لأخطاء قابلة للإعادة', async () => {
    const w = mount(ErrorState, { props: { error: err('INTERNAL_ERROR') } });
    expect(w.text()).toContain('السبب المحتمل');
    expect(w.text()).toContain('كيف تعالجه');
    expect(w.text()).toContain('req-123');
    await w.find('button').trigger('click');
    expect(w.emitted('retry')).toHaveLength(1);
  });
  it('allowRetry=false يخفي الزر', () => {
    const w = mount(ErrorState, { props: { error: err('INTERNAL_ERROR'), allowRetry: false } });
    expect(w.find('button').exists()).toBe(false);
  });
  it('خطأ غير معروف الشكل (نص/null) لا يكسر العرض', () => {
    expect(mount(ErrorState, { props: { error: 'boom' } }).text()).toContain('السبب المحتمل');
    expect(mount(ErrorState, { props: { error: null } }).text()).toContain('كيف تعالجه');
  });
});

describe('ToastHost', () => {
  beforeEach(() => useToast().clear());
  it('يعرض التنبيه ويُغلق بالزر، وrole=alert للأخطاء', async () => {
    const w = mount(ToastHost, { attachTo: document.body });
    useToast().error('فشل الحفظ', { detail: 'تفصيل', duration: 0 });
    useToast().success('تم', { duration: 0 });
    await nextTick();
    expect(w.text()).toContain('فشل الحفظ');
    expect(w.find('[role="alert"]').exists()).toBe(true);
    await w.find('button[aria-label="إغلاق"]').trigger('click');
    await vi.waitFor(() => expect(w.text()).not.toContain('فشل الحفظ')); // الخروج المتحرك ينتهي في الإطار التالي
    expect(w.text()).toContain('تم');
  });
  it('زر الإجراء (إعادة المحاولة) ينفّذ ويُغلق', async () => {
    const run = vi.fn();
    const w = mount(ToastHost, { attachTo: document.body });
    useToast().error('تعذّر', { action: { label: 'إعادة المحاولة', run } });
    await nextTick();
    await w.find('.toast__action').trigger('click');
    expect(run).toHaveBeenCalledOnce();
    expect(useToast().toasts).toHaveLength(0);
  });
  it('يُخفي تلقائيًا بعد المدة', async () => {
    vi.useFakeTimers();
    useToast().success('عابر', { duration: 1000 });
    expect(useToast().toasts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(useToast().toasts).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('AppModal', () => {
  const Host = defineComponent({
    components: { AppModal },
    setup() {
      const open = ref(true);
      return { open };
    },
    template: `<div><button id="opener">فتح</button><AppModal :open="open" title="حوار" @close="open=false"><input id="first" /><button id="last">حفظ</button></AppModal></div>`,
  });

  it('role=dialog مع aria-modal وعنوان مرتبط، ويُغلق بـ Esc', async () => {
    const w = mount(Host, { attachTo: document.body });
    await nextTick();
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')!)!.textContent).toBe('حوار');
    dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    w.unmount();
  });
  it('Tab من آخر عنصر يعود لأول عنصر (حبس التركيز)', async () => {
    const w = mount(Host, { attachTo: document.body });
    await nextTick();
    await nextTick();
    const last = document.getElementById('last')!;
    last.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.querySelector('[role="dialog"]')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    w.unmount();
  });
});

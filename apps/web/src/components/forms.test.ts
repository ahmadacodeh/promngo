import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '@/api/http';
import CheckboxField from './CheckboxField.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import PaginationBar from './PaginationBar.vue';
import SelectField from './SelectField.vue';
import TextField from './TextField.vue';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SelectField', () => {
  const options = [
    { value: '', label: 'الكل' },
    { value: 'a', label: 'أ' },
    { value: 'b', label: 'ب' },
  ];

  it('الوسم مرتبط بالقائمة، والخطأ معلن للقارئات، والتلميح يختفي مع الخطأ', async () => {
    const w = mount(SelectField, { props: { modelValue: '', label: 'الدور', options, hint: 'تلميح', error: '' } });
    const select = w.find('select');
    expect(w.find('label').attributes('for')).toBe(select.attributes('id'));
    expect(w.text()).toContain('تلميح');
    await w.setProps({ error: 'مطلوب' });
    expect(select.attributes('aria-invalid')).toBe('true');
    expect(w.find('[role="alert"]').text()).toContain('مطلوب');
    expect(w.text()).not.toContain('تلميح');
    expect(select.attributes('aria-describedby')).toBe(w.find('[role="alert"]').attributes('id'));
  });

  it('الاختيار يصدر update:modelValue بالقيمة، والمعطّل لا يُحرَّر', async () => {
    const w = mount(SelectField, { props: { modelValue: '', label: 'الدور', options } });
    await w.find('select').setValue('b');
    expect(w.emitted('update:modelValue')).toEqual([['b']]);
    await w.setProps({ disabled: true });
    expect(w.find('select').attributes('disabled')).toBeDefined();
  });

  it('labelHidden يُخفي الوسم بصريًا لا للقارئات', () => {
    const w = mount(SelectField, { props: { modelValue: '', label: 'تصفية', options, labelHidden: true } });
    expect(w.find('label').classes()).toContain('sr-only');
    expect(w.find('label').text()).toBe('تصفية');
  });
});

describe('aria-describedby لا يشير إلى تلميح محذوف (حقول النص والقائمة)', () => {
  it.each([
    ['TextField', TextField, { modelValue: '', label: 'ح', hint: 'تلميح' }, 'input'],
    ['SelectField', SelectField, { modelValue: '', label: 'ح', hint: 'تلميح', options: [{ value: '', label: 'ا' }] }, 'select'],
  ] as const)('%s', async (_n, comp, props, tag) => {
    const w = mount(comp as never, { props: { ...props } as never, attachTo: document.body });
    const ref = () => w.find(tag).attributes('aria-describedby');
    expect(document.getElementById(ref()!)?.textContent).toContain('تلميح'); // بلا خطأ: التلميح
    await w.setProps({ error: 'خطأ' } as never);
    expect(document.getElementById(ref()!)?.textContent).toContain('خطأ'); // مع خطأ: الخطأ وحده
    expect(ref()!.split(' ')).toHaveLength(1);
    await w.setProps({ error: '', hint: '' } as never);
    expect(ref()).toBeUndefined();
    w.unmount();
  });
});

describe('CheckboxField', () => {
  it('الوسم يبدّل الخانة ويصدر القيمة المنطقية، والتلميح مرتبط', async () => {
    const w = mount(CheckboxField, { props: { modelValue: false, label: 'خيار', hint: 'شرح' } });
    const box = w.find('input');
    expect(w.find('label').attributes('for')).toBe(box.attributes('id'));
    expect(box.attributes('aria-describedby')).toBeTruthy();
    await box.setValue(true);
    expect(w.emitted('update:modelValue')).toEqual([[true]]);
    await w.setProps({ modelValue: true });
    expect((box.element as HTMLInputElement).checked).toBe(true);
  });
});

describe('PaginationBar', () => {
  it('«عرض من–إلى» صحيح في الصفحة الأولى والأخيرة (غير الكاملة)', async () => {
    const w = mount(PaginationBar, { props: { page: 1, pageSize: 20, total: 45 } });
    expect(w.text()).toContain('عرض 1–20 من 45');
    expect(w.text()).toContain('صفحة 1 من 3');
    await w.setProps({ page: 3 });
    expect(w.text()).toContain('عرض 41–45 من 45');
  });

  it('السابق معطّل في الأولى والتالي معطّل في الأخيرة، والنقر يصدر الصفحة المطلوبة', async () => {
    const w = mount(PaginationBar, { props: { page: 1, pageSize: 20, total: 45 } });
    const [prev, next] = w.findAll('button');
    expect(prev!.attributes('disabled')).toBeDefined();
    await next!.trigger('click');
    expect(w.emitted('update:page')).toEqual([[2]]);
    await w.setProps({ page: 3 });
    expect(w.findAll('button')[1]!.attributes('disabled')).toBeDefined();
    await w.findAll('button')[0]!.trigger('click');
    expect(w.emitted('update:page')!.at(-1)).toEqual([2]);
  });

  it('صفحة واحدة: بلا أزرار؛ بلا نتائج: لا شيء؛ disabled يعطّل الأزرار أثناء التحميل', async () => {
    const one = mount(PaginationBar, { props: { page: 1, pageSize: 20, total: 5 } });
    expect(one.text()).toContain('عرض 1–5 من 5');
    expect(one.findAll('button')).toHaveLength(0);
    expect(mount(PaginationBar, { props: { page: 1, pageSize: 20, total: 0 } }).html()).not.toContain('عرض');
    const busy = mount(PaginationBar, { props: { page: 2, pageSize: 20, total: 60, disabled: true } });
    expect(busy.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });
});

const mountDlg = (props: Record<string, unknown> = {}) =>
  mount(ConfirmDialog, { props: { open: true, title: 'تأكيد؟', confirmLabel: 'نفّذ', ...props }, slots: { default: '<p>شرح الأثر</p>' }, attachTo: document.body });
const dlg = () => document.querySelector('[role="dialog"]')!;
const btn = (text: string) => [...dlg().querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

describe('ConfirmDialog', () => {

  it('يعرض الأثر ويصدر confirm/close من الزرين', async () => {
    const w = mountDlg();
    expect(dlg().textContent).toContain('شرح الأثر');
    btn('نفّذ').click();
    btn('إلغاء').click();
    expect(w.emitted('confirm')).toHaveLength(1);
    expect(w.emitted('close')).toHaveLength(1);
    w.unmount();
  });

  it('أثناء التنفيذ: لا إغلاق ولا إلغاء (يمنع ضياع نتيجة عملية جارية)', async () => {
    const w = mountDlg({ loading: true });
    expect(btn('إلغاء').disabled).toBe(true);
    dlg().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(w.emitted('close')).toBeUndefined();
    w.unmount();
  });

  it('الخطأ يظهر ماذا/لماذا/كيف داخل الحوار وزر إعادة المحاولة يصدر confirm من جديد', async () => {
    const err = new HttpError({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'خطأ' });
    const w = mountDlg({ error: err });
    expect(dlg().textContent).toContain('كيف تعالجه');
    btn('إعادة المحاولة').click();
    expect(w.emitted('confirm')).toHaveLength(1);
    w.unmount();
  });

  it('النبرة الخطرة تلوّن زر التأكيد بـ danger', () => {
    const w = mountDlg({ tone: 'danger' });
    expect(btn('نفّذ').className).toContain('btn--danger');
    w.unmount();
  });
});

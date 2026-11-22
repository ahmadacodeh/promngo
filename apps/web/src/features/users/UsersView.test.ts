import { DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, SpecializationDto, UserDto } from '@/api/types';
import { useToast } from '@/composables/useToast';
import { featureRoutes } from '@/router';
import { decideNavigation } from '@/router/guards';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch, mountView } from '@/test/utils';
import UsersView from './UsersView.vue';

/* ---------- fixtures: an in-memory "server" so the view talks to real-shaped responses ---------- */
const SPECS: SpecializationDto[] = [
  { id: 's-design', name: 'التصميم', description: null },
  { id: 's-dev', name: 'البرمجة', description: null },
];
const SELF_ID = 'u1'; // authResponse() signs in as this EXECUTIVE_MANAGER

function mkUser(over: Partial<UserDto> & Pick<UserDto, 'id' | 'fullName'>): UserDto {
  return {
    email: `${over.id}@alpha.test`,
    role: 'EMPLOYEE',
    canCreateProjects: false,
    isActive: true,
    mustChangePassword: false,
    specialization: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
const SELF = mkUser({ id: SELF_ID, fullName: 'سارة المدير', email: 'sara@alpha.test', role: 'EXECUTIVE_MANAGER', canCreateProjects: true });
const NOUR = mkUser({ id: 'u2', fullName: 'نور الموظفة', email: 'nour@alpha.test', specialization: { id: 's-design', name: 'التصميم' }, mustChangePassword: true });
const OMAR = mkUser({ id: 'u3', fullName: 'عمر المعطّل', email: 'omar@alpha.test', isActive: false });
const PM = mkUser({ id: 'u4', fullName: 'باسل مدير المشروع', email: 'basel@alpha.test', role: 'PROJECT_MANAGER', canCreateProjects: true });

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}
interface Api {
  calls: Call[];
  users: UserDto[];
  total?: number;
  failList?: boolean;
  failSpecs?: boolean;
  onWrite?: (c: Call) => Response | undefined;
}

function installApi(initial: UserDto[], extra: Partial<Api> = {}): Api {
  const api: Api = { calls: [], users: [...initial], ...extra };
  mockFetch((url, init) => {
    const u = new URL(url, 'http://x');
    const call: Call = { method: init.method ?? 'GET', path: u.pathname, query: u.searchParams, body: init.body ? JSON.parse(String(init.body)) : undefined };
    api.calls.push(call);
    const { method, path } = call;
    if (method === 'GET' && path === '/api/specializations') {
      return api.failSpecs ? jsonResponse(500, { statusCode: 500, code: 'INTERNAL_ERROR', message: 'خطأ' }) : jsonResponse(200, { items: SPECS, total: SPECS.length, page: 1, pageSize: 200 });
    }
    if (method === 'GET' && path === '/api/users') {
      if (api.failList) return jsonResponse(500, { statusCode: 500, code: 'INTERNAL_ERROR', message: 'خطأ', requestId: 'req-77' });
      const page = Number(u.searchParams.get('page') ?? 1);
      const pageSize = Number(u.searchParams.get('pageSize') ?? 20);
      let rows = api.users;
      const text = u.searchParams.get('q');
      if (text) rows = rows.filter((x) => x.fullName.includes(text) || x.email.includes(text));
      const role = u.searchParams.get('role');
      if (role) rows = rows.filter((x) => x.role === role);
      const active = u.searchParams.get('active');
      if (active) rows = rows.filter((x) => x.isActive === (active === 'true'));
      return jsonResponse(200, { items: rows.slice((page - 1) * pageSize, page * pageSize), total: api.total ?? rows.length, page, pageSize });
    }
    const forced = method !== 'GET' ? api.onWrite?.(call) : undefined;
    if (forced) return forced;
    if (method === 'POST' && path === '/api/users') {
      const b = call.body as { fullName: string; email: string; role: Role; canCreateProjects?: boolean; specializationId?: string };
      const spec = SPECS.find((s) => s.id === b.specializationId);
      const created = mkUser({ id: `new-${api.users.length}`, fullName: b.fullName, email: b.email, role: b.role, canCreateProjects: b.canCreateProjects ?? false, mustChangePassword: true, specialization: spec ? { id: spec.id, name: spec.name } : null });
      api.users.push(created);
      return jsonResponse(201, { user: created, temporaryPassword: 'Temp-Pass-9xQ2' });
    }
    const m = /^\/api\/users\/([^/]+)(\/reset-password)?$/.exec(path);
    if (m && method === 'POST' && m[2]) return jsonResponse(200, { temporaryPassword: 'Reset-Pass-7kP4' });
    if (m && method === 'PATCH') {
      const i = api.users.findIndex((x) => x.id === m[1]);
      const b = call.body as Partial<UserDto> & { specializationId?: string | null };
      const cur = api.users[i]!;
      const next: UserDto = { ...cur, ...(b.fullName !== undefined ? { fullName: b.fullName } : {}), ...(b.role !== undefined ? { role: b.role } : {}), ...(b.isActive !== undefined ? { isActive: b.isActive } : {}), ...(b.canCreateProjects !== undefined ? { canCreateProjects: b.canCreateProjects } : {}) };
      if (b.specializationId !== undefined) {
        const s = SPECS.find((x) => x.id === b.specializationId);
        next.specialization = s ? { id: s.id, name: s.name } : null;
      }
      api.users[i] = next;
      return jsonResponse(200, next);
    }
    return jsonResponse(404, { statusCode: 404, code: 'NOT_FOUND', message: 'غير موجود' });
  });
  return api;
}
const writes = (api: Api): Call[] => api.calls.filter((c) => c.method !== 'GET');
const listCalls = (api: Api): Call[] => api.calls.filter((c) => c.method === 'GET' && c.path === '/api/users');

/* ---------- DOM helpers (modals are teleported to <body>) ---------- */
let ctx: ReturnType<typeof freshApp>;
let wrapper: VueWrapper | null = null;

async function open(api: Api): Promise<VueWrapper> {
  void api;
  wrapper = await mountView(UsersView, { router: ctx.router, path: '/users' });
  return wrapper;
}
const dialog = (): DOMWrapper<Element> => {
  const all = document.querySelectorAll('[role="dialog"]');
  const el = all[all.length - 1]; // الأحدث: الحوار المغادر يبقى لحظة حتى ينتهي انتقاله
  if (!el) throw new Error('لا يوجد حوار مفتوح');
  return new DOMWrapper(el);
};
const hasDialog = (): boolean => document.querySelector('[role="dialog"]') !== null;
const body = (): DOMWrapper<Element> => new DOMWrapper(document.body);
function field(root: DOMWrapper<Element>, label: string): DOMWrapper<HTMLInputElement | HTMLSelectElement> {
  const l = [...root.element.querySelectorAll('label')].find((x) => (x.textContent ?? '').replace('*', '').trim() === label);
  if (!l) throw new Error(`لا حقل بالوسم «${label}»`);
  return new DOMWrapper(root.element.ownerDocument.getElementById(l.htmlFor) as HTMLInputElement | HTMLSelectElement);
}
function button(root: DOMWrapper<Element>, text: string, nth = 0): DOMWrapper<HTMLButtonElement> {
  const hits = root.findAll('button').filter((b) => b.text().trim() === text);
  const b = hits[nth];
  if (!b) throw new Error(`لا زر «${text}»`);
  return b as DOMWrapper<HTMLButtonElement>;
}
const rowOf = (w: VueWrapper, name: string) => {
  const r = w.findAll('tbody tr').find((x) => x.text().includes(name));
  if (!r) throw new Error(`لا صف للمستخدم ${name}`);
  return r;
};
const toasts = (): string[] => useToast().toasts.map((t) => t.message);

beforeEach(() => {
  ctx = freshApp();
  ctx.auth.apply(authResponse());
  useToast().clear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

describe('مسار /users', () => {
  it('للمدير التنفيذي فقط في الواجهة (والخادم يفرضه مجددًا)، ويظهر في القائمة الجانبية', () => {
    const r = featureRoutes.find((x) => x.name === 'users');
    expect(r?.meta?.roles).toEqual(['EXECUTIVE_MANAGER']);
    expect(r?.meta?.nav?.label).toBe('المستخدمون');
    const route = { name: 'users', meta: r?.meta ?? {}, fullPath: '/users' } as never;
    for (const role of ['PROJECT_MANAGER', 'SPECIALIZED_MANAGER', 'EMPLOYEE'] as const) {
      ctx.auth.apply(authResponse({ user: { ...authResponse().user, role } }));
      expect(decideNavigation(route, ctx.auth), role).toEqual({ name: 'forbidden' });
    }
    ctx.auth.apply(authResponse());
    expect(decideNavigation(route, ctx.auth)).toBe(true);
  });
});

describe('القائمة', () => {
  it('تعرض المستخدمين ببياناتهم وحالاتهم الحقيقية من GET /users، والبريد LTR، والعدد في العنوان', async () => {
    const api = installApi([SELF, NOUR, OMAR, PM]);
    const w = await open(api);
    expect(listCalls(api)[0]!.query.get('page')).toBe('1');
    expect(listCalls(api)[0]!.query.get('pageSize')).toBe('20');
    expect(w.find('h1').text()).toBe('المستخدمون');
    expect(w.text()).toContain('4 مستخدم في شركتك');
    const nour = rowOf(w, 'نور الموظفة');
    expect(nour.text()).toContain('الموظف');
    expect(nour.text()).toContain('التصميم');
    expect(nour.text()).toContain('نشط');
    expect(nour.text()).toContain('كلمة مرور مؤقتة');
    expect(nour.find('.mail').attributes('dir')).toBe('ltr');
    expect(rowOf(w, 'عمر المعطّل').text()).toContain('معطّل');
    expect(rowOf(w, 'باسل').text()).toContain('ينشئ مشاريع');
    expect(rowOf(w, 'سارة المدير').text()).toContain('(أنت)');
  });

  it('صف المستخدم نفسه بلا تعطيل ولا إعادة تعيين؛ الآخرون النشطون لهم الاثنان، والمعطّل له «تفعيل»', async () => {
    const w = await open(installApi([SELF, NOUR, OMAR]));
    const labels = (name: string) => rowOf(w, name).findAll('button').map((b) => b.text());
    expect(labels('سارة المدير')).toEqual(['تعديل']);
    expect(labels('نور الموظفة')).toEqual(['تعديل', 'إعادة تعيين كلمة المرور', 'تعطيل']);
    expect(labels('عمر المعطّل')).toEqual(['تعديل', 'تفعيل']);
  });

  it('أزرار الصف تحمل اسم المستخدم لقارئات الشاشة', async () => {
    const w = await open(installApi([SELF, NOUR]));
    const names = rowOf(w, 'نور الموظفة').findAll('button').map((b) => b.attributes('aria-label'));
    expect(names).toEqual(['تعديل نور الموظفة', 'إعادة تعيين كلمة المرور نور الموظفة', 'تعطيل نور الموظفة']);
  });

  it('فشل التحميل: ماذا/لماذا/كيف مع رقم الطلب، و«إعادة المحاولة» تنجح بعد عودة الخادم', async () => {
    const api = installApi([SELF, NOUR], { failList: true });
    const w = await open(api);
    expect(w.text()).toContain('حدث خطأ غير متوقع في الخادم.');
    expect(w.text()).toContain('كيف تعالجه');
    expect(w.text()).toContain('req-77');
    api.failList = false;
    await button(new DOMWrapper(w.element), 'إعادة المحاولة').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('نور الموظفة');
    expect(w.text()).not.toContain('حدث خطأ غير متوقع');
  });

  it('لا مستخدمين: حالة فارغة بزر إضافة', async () => {
    const w = await open(installApi([]));
    expect(w.text()).toContain('لا يوجد مستخدمون');
    expect(w.findAll('button').filter((b) => b.text() === 'إضافة مستخدم')).toHaveLength(2); // الرأس + الحالة الفارغة
  });

  it('البحث (بعد تأخير) والدور والحالة تُرسل للخادم، ولا نتائج ← «مسح التصفية» تعيد الكل', async () => {
    const api = installApi([SELF, NOUR, OMAR]);
    const w = await open(api);
    await w.find('input[type="search"]').setValue('لا يوجد أحد بهذا الاسم');
    expect(listCalls(api)).toHaveLength(1); // لم يُرسل بعد: التأخير 300ms
    await vi.waitFor(() => expect(listCalls(api).at(-1)!.query.get('q')).toBe('لا يوجد أحد بهذا الاسم'), { timeout: 2000 });
    await flushPromises();
    expect(w.text()).toContain('لا نتائج مطابقة');
    await button(new DOMWrapper(w.element), 'مسح التصفية').trigger('click');
    await vi.waitFor(() => expect(w.text()).toContain('نور الموظفة'), { timeout: 2000 });
    expect(listCalls(api).at(-1)!.query.get('q')).toBeNull();

    await field(new DOMWrapper(w.element), 'تصفية بالدور').setValue('EMPLOYEE');
    await flushPromises();
    expect(listCalls(api).at(-1)!.query.get('role')).toBe('EMPLOYEE');
    await field(new DOMWrapper(w.element), 'تصفية بالحالة').setValue('inactive');
    await flushPromises();
    expect(listCalls(api).at(-1)!.query.get('active')).toBe('false');
    expect(w.findAll('tbody tr')).toHaveLength(1);
    expect(w.text()).toContain('عمر المعطّل');
  });

  it('الترقيم: «عرض 1–20 من 45» والتالي يطلب الصفحة 2', async () => {
    const many = Array.from({ length: 45 }, (_, i) => mkUser({ id: `m${i}`, fullName: `موظف ${i}` }));
    const api = installApi(many);
    const w = await open(api);
    expect(w.text()).toContain('عرض 1–20 من 45');
    expect(w.text()).toContain('صفحة 1 من 3');
    expect(button(new DOMWrapper(w.element), 'السابق').attributes('disabled')).toBeDefined();
    await button(new DOMWrapper(w.element), 'التالي').trigger('click');
    await flushPromises();
    expect(listCalls(api).at(-1)!.query.get('page')).toBe('2');
    expect(w.text()).toContain('عرض 21–40 من 45');
    expect(w.text()).toContain('موظف 20');
  });

  it('إذا فرغت الصفحة الحالية (تغيّرت البيانات) تعود إلى آخر صفحة موجودة', async () => {
    const many = Array.from({ length: 21 }, (_, i) => mkUser({ id: `m${i}`, fullName: `موظف ${i}` }));
    const api = installApi(many);
    const w = await open(api);
    await button(new DOMWrapper(w.element), 'التالي').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('عرض 21–21 من 21');
    api.users = api.users.slice(0, 20); // بقي 20 فقط، فالصفحة 2 لم تعد موجودة
    await field(new DOMWrapper(w.element), 'تصفية بالحالة').setValue('active'); // أي إعادة تحميل
    await flushPromises();
    expect(w.text()).toContain('عرض 1–20 من 20');
  });
});

describe('الإنشاء', () => {
  it('نموذج فارغ: رسائل عربية للاسم والبريد ولا طلب شبكة', async () => {
    const api = installApi([SELF]);
    const w = await open(api);
    await button(new DOMWrapper(w.element), 'إضافة مستخدم').trigger('click');
    await flushPromises();
    await dialog().find('form').trigger('submit');
    await flushPromises();
    expect(dialog().text()).toContain('أدخل الاسم الكامل.');
    expect(dialog().text()).toContain('أدخل البريد الإلكتروني.');
    await field(dialog(), 'البريد الإلكتروني').setValue('not-an-email');
    await dialog().find('form').trigger('submit');
    expect(dialog().text()).toContain('صيغة البريد غير صحيحة');
    expect(writes(api)).toHaveLength(0);
  });

  it('نجاح: POST /users بالحقول الصحيحة فقط، ثم كلمة مرور مؤقتة تُعرض مرة واحدة وتُنسخ وتُمسح من الصفحة عند الإغلاق', async () => {
    const api = installApi([SELF]);
    const w = await open(api);
    await button(new DOMWrapper(w.element), 'إضافة مستخدم').trigger('click');
    await flushPromises();
    await field(dialog(), 'الاسم الكامل').setValue('  ليلى الجديدة  ');
    await field(dialog(), 'البريد الإلكتروني').setValue('layla@alpha.test');
    await field(dialog(), 'التخصص').setValue('s-dev');
    await dialog().find('form').trigger('submit');
    await flushPromises();

    expect(writes(api)).toHaveLength(1);
    expect(writes(api)[0]).toMatchObject({ method: 'POST', path: '/api/users', body: { fullName: 'ليلى الجديدة', email: 'layla@alpha.test', role: 'EMPLOYEE', canCreateProjects: false, specializationId: 's-dev' } });
    expect(dialog().text()).toContain('تم إنشاء المستخدم');
    expect(dialog().text()).toContain('تظهر كلمة المرور هذه الآن فقط');
    const code = dialog().find('[data-testid="temp-password"]');
    expect(code.text()).toBe('Temp-Pass-9xQ2');
    expect(code.attributes('dir')).toBe('ltr');
    expect(toasts()).toContain('أُنشئ المستخدم ليلى الجديدة.');

    await button(dialog(), 'نسخ كلمة المرور').trigger('click');
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Temp-Pass-9xQ2');
    expect(toasts()).toContain('نُسخت كلمة المرور.');

    await button(dialog(), 'تم، حفظتها').trigger('click');
    await vi.waitFor(() => expect(hasDialog()).toBe(false));
    expect(body().text()).not.toContain('Temp-Pass-9xQ2'); // لا أثر لكلمة المرور بعد الإغلاق
    expect(w.text()).toContain('ليلى الجديدة'); // والقائمة أُعيد تحميلها
  });

  it('فشل النسخ التلقائي: تنبيه عربي ويبقى النص قابلًا للتحديد', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    const api = installApi([SELF]);
    const w = await open(api);
    await button(new DOMWrapper(w.element), 'إضافة مستخدم').trigger('click');
    await flushPromises();
    await field(dialog(), 'الاسم الكامل').setValue('ليلى');
    await field(dialog(), 'البريد الإلكتروني').setValue('l@alpha.test');
    await dialog().find('form').trigger('submit');
    await flushPromises();
    await button(dialog(), 'نسخ كلمة المرور').trigger('click');
    await flushPromises();
    expect(dialog().text()).toContain('تعذّر النسخ تلقائيًا');
    expect(dialog().find('[data-testid="temp-password"]').text()).toBe('Temp-Pass-9xQ2');
  });

  it('البريد مستخدم (409): رسالة تحت الحقل + ماذا/لماذا/كيف، والنموذج يبقى مفتوحًا بما كُتب', async () => {
    const api = installApi([SELF], {
      onWrite: (c) => (c.method === 'POST' && c.path === '/api/users' ? jsonResponse(409, { statusCode: 409, code: 'EMAIL_TAKEN', message: 'هذا البريد مستخدم بالفعل.', fields: { email: 'هذا البريد مستخدم بالفعل.' } }) : undefined),
    });
    const w = await open(api);
    await button(new DOMWrapper(w.element), 'إضافة مستخدم').trigger('click');
    await flushPromises();
    await field(dialog(), 'الاسم الكامل').setValue('ليلى');
    await field(dialog(), 'البريد الإلكتروني').setValue('sara@alpha.test');
    await dialog().find('form').trigger('submit');
    await flushPromises();
    expect(hasDialog()).toBe(true);
    expect(dialog().text()).toContain('هذا البريد مستخدم بالفعل.');
    expect(dialog().text()).toContain('كيف تعالجه');
    expect((field(dialog(), 'الاسم الكامل').element as HTMLInputElement).value).toBe('ليلى');
    expect(dialog().text()).not.toContain('تظهر كلمة المرور');
  });

  it('خانة «يمكنه إنشاء مشاريع» تظهر للمدراء فقط وتُصفَّر عند التحويل لدور آخر', async () => {
    const api = installApi([SELF]);
    const w = await open(api);
    await button(new DOMWrapper(w.element), 'إضافة مستخدم').trigger('click');
    await flushPromises();
    expect(dialog().text()).not.toContain('يمكنه إنشاء مشاريع');
    await field(dialog(), 'الدور').setValue('PROJECT_MANAGER');
    expect(dialog().text()).toContain('يمكنه إنشاء مشاريع');
    await field(dialog(), 'يمكنه إنشاء مشاريع').setValue(true);
    await field(dialog(), 'الدور').setValue('EMPLOYEE');
    expect(dialog().text()).not.toContain('يمكنه إنشاء مشاريع');
    await field(dialog(), 'الاسم الكامل').setValue('كريم');
    await field(dialog(), 'البريد الإلكتروني').setValue('k@alpha.test');
    await dialog().find('form').trigger('submit');
    await flushPromises();
    expect((writes(api)[0]!.body as { canCreateProjects: boolean }).canCreateProjects).toBe(false);
  });
});

describe('التعديل', () => {
  it('يفتح بالقيم الحالية والبريد غير قابل للتغيير؛ بلا تغيير ← إغلاق بلا أي طلب', async () => {
    const api = installApi([SELF, NOUR]);
    const w = await open(api);
    await button(rowOf(w, 'نور الموظفة'), 'تعديل').trigger('click');
    await flushPromises();
    expect((field(dialog(), 'الاسم الكامل').element as HTMLInputElement).value).toBe('نور الموظفة');
    expect(field(dialog(), 'البريد الإلكتروني').attributes('disabled')).toBeDefined();
    expect((field(dialog(), 'التخصص').element as HTMLSelectElement).value).toBe('s-design');
    await dialog().find('form').trigger('submit');
    await flushPromises();
    await vi.waitFor(() => expect(hasDialog()).toBe(false));
    expect(writes(api)).toHaveLength(0);
  });

  it('يرسل الحقول المتغيّرة فقط؛ وإزالة التخصص ترسل null؛ ثم تُحدَّث القائمة', async () => {
    const api = installApi([SELF, NOUR]);
    const w = await open(api);
    await button(rowOf(w, 'نور الموظفة'), 'تعديل').trigger('click');
    await flushPromises();
    await field(dialog(), 'الاسم الكامل').setValue('نور الدين');
    await field(dialog(), 'التخصص').setValue('');
    await dialog().find('form').trigger('submit');
    await flushPromises();
    expect(writes(api)).toHaveLength(1);
    expect(writes(api)[0]).toMatchObject({ method: 'PATCH', path: '/api/users/u2', body: { fullName: 'نور الدين', specializationId: null } });
    expect(Object.keys(writes(api)[0]!.body as object).toSorted()).toEqual(['fullName', 'specializationId']);
    await vi.waitFor(() => expect(hasDialog()).toBe(false));
    expect(toasts()).toContain('حُفظت تغييرات نور الدين.');
    expect(w.text()).toContain('نور الدين');
  });

  it('المستخدم لا يغيّر دوره بنفسه (القائمة معطّلة مع شرح)', async () => {
    const w = await open(installApi([SELF]));
    await button(rowOf(w, 'سارة المدير'), 'تعديل').trigger('click');
    await flushPromises();
    expect(field(dialog(), 'الدور').attributes('disabled')).toBeDefined();
    expect(dialog().text()).toContain('لا يمكنك تغيير دورك بنفسك');
  });

  it('تعديل المستخدم نفسه يحدّث اسمه في الجلسة (الشريط الجانبي)', async () => {
    const api = installApi([SELF]);
    const w = await open(api);
    await button(rowOf(w, 'سارة المدير'), 'تعديل').trigger('click');
    await flushPromises();
    await field(dialog(), 'الاسم الكامل').setValue('سارة الجديدة');
    await dialog().find('form').trigger('submit');
    await flushPromises();
    expect(ctx.auth.user?.fullName).toBe('سارة الجديدة');
  });

  it('فشل الحفظ (آخر مدير تنفيذي) يبقي النموذج ويشرح السبب والحل', async () => {
    const api = installApi([SELF, PM], {
      onWrite: (c) => (c.method === 'PATCH' ? jsonResponse(409, { statusCode: 409, code: 'LAST_EXECUTIVE', message: 'لا يمكن ترك الشركة بلا مدير تنفيذي نشط.' }) : undefined),
    });
    const w = await open(api);
    await button(rowOf(w, 'باسل'), 'تعديل').trigger('click');
    await flushPromises();
    await field(dialog(), 'الدور').setValue('EMPLOYEE');
    await dialog().find('form').trigger('submit');
    await flushPromises();
    expect(hasDialog()).toBe(true);
    expect(dialog().text()).toContain('سيترك الشركة بلا مدير تنفيذي نشط.');
    expect(dialog().text()).toContain('عيّن مديرًا تنفيذيًا آخر نشطًا أولًا');
  });
});

describe('التعطيل والتفعيل وإعادة التعيين', () => {
  it('التعطيل يطلب تأكيدًا يشرح الأثر؛ الإلغاء لا يرسل شيئًا', async () => {
    const api = installApi([SELF, NOUR]);
    const w = await open(api);
    await button(rowOf(w, 'نور الموظفة'), 'تعطيل').trigger('click');
    await flushPromises();
    expect(dialog().text()).toContain('تعطيل نور الموظفة؟');
    expect(dialog().text()).toContain('تُنهى جلساته الحالية فورًا');
    await button(dialog(), 'إلغاء').trigger('click');
    await vi.waitFor(() => expect(hasDialog()).toBe(false));
    expect(writes(api)).toHaveLength(0);
  });

  it('تأكيد التعطيل: PATCH {isActive:false} ثم تنبيه وتحديث الصف', async () => {
    const api = installApi([SELF, NOUR]);
    const w = await open(api);
    await button(rowOf(w, 'نور الموظفة'), 'تعطيل').trigger('click');
    await flushPromises();
    await button(dialog(), 'تعطيل المستخدم').trigger('click');
    await flushPromises();
    expect(writes(api)[0]).toMatchObject({ method: 'PATCH', path: '/api/users/u2', body: { isActive: false } });
    await vi.waitFor(() => expect(hasDialog()).toBe(false));
    expect(toasts()).toContain('عُطّل نور الموظفة.');
    expect(rowOf(w, 'نور الموظفة').text()).toContain('معطّل');
    expect(rowOf(w, 'نور الموظفة').findAll('button').map((b) => b.text())).toContain('تفعيل');
  });

  it('فشل التعطيل: الحوار يبقى مع الشرح وإعادة المحاولة تنجح', async () => {
    let fail = true;
    const api = installApi([SELF, NOUR], {
      onWrite: (c) => (fail && c.method === 'PATCH' ? jsonResponse(500, { statusCode: 500, code: 'INTERNAL_ERROR', message: 'خطأ' }) : undefined),
    });
    const w = await open(api);
    await button(rowOf(w, 'نور الموظفة'), 'تعطيل').trigger('click');
    await flushPromises();
    await button(dialog(), 'تعطيل المستخدم').trigger('click');
    await flushPromises();
    expect(hasDialog()).toBe(true);
    expect(dialog().text()).toContain('كيف تعالجه');
    fail = false;
    await button(dialog(), 'إعادة المحاولة').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(hasDialog()).toBe(false));
    expect(rowOf(w, 'نور الموظفة').text()).toContain('معطّل');
  });

  it('التفعيل مباشر بلا حوار: PATCH {isActive:true}', async () => {
    const api = installApi([SELF, OMAR]);
    const w = await open(api);
    await button(rowOf(w, 'عمر المعطّل'), 'تفعيل').trigger('click');
    await flushPromises();
    expect(writes(api)[0]).toMatchObject({ method: 'PATCH', path: '/api/users/u3', body: { isActive: true } });
    expect(toasts()).toContain('فُعّل عمر المعطّل.');
    expect(rowOf(w, 'عمر المعطّل').text()).toContain('نشط');
  });

  it('فشل التفعيل: تنبيه خطأ بإجراء «إعادة المحاولة»', async () => {
    const api = installApi([SELF, OMAR], { onWrite: (c) => (c.method === 'PATCH' ? jsonResponse(500, { statusCode: 500, code: 'INTERNAL_ERROR', message: 'خطأ' }) : undefined) });
    const w = await open(api);
    await button(rowOf(w, 'عمر المعطّل'), 'تفعيل').trigger('click');
    await flushPromises();
    const t = useToast().toasts.find((x) => x.kind === 'error');
    expect(t?.message).toBe('تعذّر تفعيل عمر المعطّل.');
    expect(t?.action?.label).toBe('إعادة المحاولة');
  });

  it('إعادة التعيين: تأكيد يشرح الأثر ثم كلمة مؤقتة جديدة تُعرض مرة واحدة وتُمسح عند الإغلاق', async () => {
    const api = installApi([SELF, NOUR]);
    const w = await open(api);
    await button(rowOf(w, 'نور الموظفة'), 'إعادة تعيين كلمة المرور').trigger('click');
    await flushPromises();
    expect(dialog().text()).toContain('كلمة مروره الحالية لن تعمل بعد الآن');
    await button(dialog(), 'إعادة التعيين').trigger('click');
    await flushPromises();
    expect(writes(api)[0]).toMatchObject({ method: 'POST', path: '/api/users/u2/reset-password' });
    await vi.waitFor(() => expect(dialog().find('[data-testid="temp-password"]').exists()).toBe(true));
    expect(dialog().text()).toContain('كلمة مرور مؤقتة جديدة');
    expect(dialog().find('[data-testid="temp-password"]').text()).toBe('Reset-Pass-7kP4');
    expect(dialog().text()).toContain('أُنهيت جلساته الحالية');
    await button(dialog(), 'تم، حفظتها').trigger('click');
    await vi.waitFor(() => expect(hasDialog()).toBe(false));
    expect(body().text()).not.toContain('Reset-Pass-7kP4');
  });
});

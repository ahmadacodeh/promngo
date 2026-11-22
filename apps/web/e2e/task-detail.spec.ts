import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_PROJECT_PREFIX } from './db';
import { byLabel, SEED_USERS, seedPassword, uiLoginToDashboard } from './helpers';

/**
 * T23 على API حقيقي: إنشاء مهمة من الواجهة ← تفاصيلها ← إسناد ← بدء التنفيذ من حساب المكلّف ← فرعية ← اعتمادية.
 * كل إجراء يظهر فقط حين يعيده الخادم في can/allowedNext، وكل ممنوع يرفضه الخادم أيضًا.
 * المشاريع بالبادئة «E2E » يحذفها التنظيف التلقائي مع مهامها.
 */
async function tokenFor(request: APIRequestContext, email: string): Promise<string> {
  const r = await request.post('/api/auth/login', { data: { email, password: seedPassword() } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { accessToken: string }).accessToken;
}
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** مشروع نشط جديد لكل اختبار (عبر API) حتى لا تُمسّ مشاريع البذر. */
async function activeProject(request: APIRequestContext, token: string): Promise<{ id: string; name: string }> {
  const name = `${E2E_PROJECT_PREFIX}مهام ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const c = await request.post('/api/projects', { ...auth(token), data: { name } });
  expect(c.status()).toBe(201);
  const { id } = (await c.json()) as { id: string };
  expect((await request.patch(`/api/projects/${id}`, { ...auth(token), data: { status: 'ACTIVE' } })).status()).toBe(200);
  return { id, name };
}
async function userId(request: APIRequestContext, token: string, email: string): Promise<string> {
  const r = await request.get(`/api/users?q=${encodeURIComponent(email)}`, auth(token));
  const items = ((await r.json()) as { items: Array<{ id: string; email: string }> }).items;
  return items.find((u) => u.email === email)!.id;
}
const statusBadges = (page: Page) => page.locator('.summary__badges');
const dialog = (page: Page) => page.getByRole('dialog');

test.describe('تفاصيل المهمة (T23)', () => {
  test('مدير المشروع ينشئ مهمة بالإسناد والأولوية والاستحقاق ← يسندها ← الموظف يبدأها، والحالة محفوظة بعد إعادة التحميل', async ({ page, request, browser }) => {
    const pmToken = await tokenFor(request, SEED_USERS.pm.email);
    const project = await activeProject(request, pmToken);
    const title = `تطوير الدخول ${Date.now().toString(36)}`;

    await uiLoginToDashboard(page, SEED_USERS.pm.email, seedPassword());
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('button', { name: 'مهمة جديدة' }).click();
    const dlg = dialog(page);
    await expect(dlg).toHaveAccessibleName('مهمة جديدة');
    await dlg.getByRole('button', { name: 'إنشاء المهمة' }).click();
    await expect(dlg.getByText('عنوان المهمة مطلوب.')).toBeVisible();
    await byLabel(page, 'عنوان المهمة').fill(title);
    await byLabel(page, 'الأولوية').selectOption('URGENT');
    await byLabel(page, 'تاريخ الاستحقاق').fill('2027-01-20');
    // اختيار بالمعرّف الحقيقي من الخادم (لا أسماء مكتوبة في الاختبار).
    const empId = await userId(request, pmToken, SEED_USERS.emp.email);
    const specId = await userId(request, pmToken, SEED_USERS.spec.email);
    await byLabel(page, 'الموظف المكلّف').selectOption(empId);
    await byLabel(page, 'المراجع').selectOption(specId);
    await dlg.getByRole('button', { name: 'إنشاء المهمة' }).click();

    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    const taskId = page.url().split('/').pop()!;
    await expect(page.locator('.summary__title')).toHaveText(title);
    await expect(statusBadges(page)).toContainText('مخططة');
    await expect(statusBadges(page)).toContainText('أولوية عاجلة');
    await expect(page.getByText('20 يناير 2027')).toBeVisible();

    // الإسناد من allowedNext (المكلّف والمراجع محددان)
    await page.getByRole('button', { name: 'إسناد المهمة' }).click();
    await dialog(page).getByRole('button', { name: 'إسناد المهمة' }).click();
    await expect(statusBadges(page)).toContainText('مسندة');
    await expect(page.locator('.timeline li').first()).toContainText('مخططة ← مسندة');
    // مدير المشروع لا يبدأ عمل غيره: لا زر بدء، والخادم يرفض
    await expect(page.getByRole('button', { name: 'بدء التنفيذ' })).toHaveCount(0);
    const pmStart = await request.post(`/api/tasks/${taskId}/transitions`, { ...auth(pmToken), data: { to: 'IN_PROGRESS' } });
    expect(pmStart.status()).toBe(403);

    // الموظف المكلّف: يبدأ، ولا أزرار تعديل/حذف
    const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined, locale: 'ar' });
    const emp = await ctx.newPage();
    await uiLoginToDashboard(emp, SEED_USERS.emp.email, seedPassword());
    await emp.goto(`/tasks/${taskId}`);
    await expect(emp.getByRole('button', { name: 'تعديل المهمة' })).toHaveCount(0);
    await expect(emp.getByRole('button', { name: 'إضافة اعتمادية' })).toHaveCount(0);
    await emp.getByRole('button', { name: 'بدء التنفيذ' }).click();
    await emp.getByRole('dialog').getByRole('button', { name: 'بدء التنفيذ' }).click();
    await expect(emp.locator('.summary__badges')).toContainText('قيد التنفيذ');
    await emp.reload();
    await expect(emp.locator('.summary__badges')).toContainText('قيد التنفيذ');
    const empToken = await tokenFor(request, SEED_USERS.emp.email);
    const empPatch = await request.patch(`/api/tasks/${taskId}`, { ...auth(empToken), data: { title: 'x' } });
    expect(empPatch.status()).toBe(403);
    await ctx.close();
  });

  test('مهمة فرعية من صفحة الأم، ورابطها في جدول الفرعيات، والعودة إلى الأم', async ({ page, request }) => {
    const pmToken = await tokenFor(request, SEED_USERS.pm.email);
    const project = await activeProject(request, pmToken);
    const parent = await request.post(`/api/projects/${project.id}/tasks`, { ...auth(pmToken), data: { title: 'المهمة الأم' } });
    const parentId = ((await parent.json()) as { id: string }).id;

    await uiLoginToDashboard(page, SEED_USERS.pm.email, seedPassword());
    await page.goto(`/tasks/${parentId}`);
    await expect(page.getByText('لا مهام فرعية')).toBeVisible();
    await page.getByRole('button', { name: 'مهمة فرعية جديدة' }).click();
    await expect(dialog(page)).toContainText('ضمن المهمة الرئيسية: المهمة الأم');
    await byLabel(page, 'عنوان المهمة').fill('تصميم الواجهات');
    await dialog(page).getByRole('button', { name: 'إنشاء المهمة' }).click();
    await expect(page.locator('.summary__title')).toHaveText('تصميم الواجهات');
    await expect(page.getByText('إلزامية', { exact: true })).toBeVisible();
    // الفرعية لا تنشئ فرعية (عمق مستوى واحد): لا زر
    await expect(page.getByRole('button', { name: 'مهمة فرعية جديدة' })).toHaveCount(0);
    await page.getByRole('link', { name: '→ المهمة الرئيسية' }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${parentId}$`));
    await expect(page.getByRole('link', { name: 'تصميم الواجهات', exact: true })).toBeVisible();
  });

  test('الاعتماديات: إضافة سابقة من الواجهة تظهر في الجهتين، والمرتبطة لا تُعرض خيارًا، والخادم يرفض الدورة (DEPENDENCY_CYCLE)', async ({ page, request }) => {
    const pmToken = await tokenFor(request, SEED_USERS.pm.email);
    const project = await activeProject(request, pmToken);
    const mk = async (title: string) => ((await (await request.post(`/api/projects/${project.id}/tasks`, { ...auth(pmToken), data: { title } })).json()) as { id: string }).id;
    const a = await mk('التحليل');
    const b = await mk('التنفيذ');

    await uiLoginToDashboard(page, SEED_USERS.pm.email, seedPassword());
    await page.goto(`/tasks/${b}`);
    await page.getByRole('button', { name: 'إضافة اعتمادية' }).click();
    await byLabel(page, 'المهمة السابقة').selectOption(a);
    await dialog(page).getByRole('button', { name: 'إضافة', exact: true }).click();
    await expect(page.locator('.deps').first()).toContainText('التحليل');

    // من جهة السابقة: B تنتظرها، ومحاولة جعل B سابقة لـA دورة يرفضها الخادم
    await page.getByRole('link', { name: 'التحليل', exact: true }).click();
    await expect(page.locator('.summary__title')).toHaveText('التحليل');
    await expect(page.getByText('التنفيذ', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'إضافة اعتمادية' }).click();
    // B لا تظهر خيارًا (مرتبطة أصلًا)، والدورة نفسها يرفضها الخادم
    await expect(byLabel(page, 'المهمة السابقة').locator(`option[value="${b}"]`)).toHaveCount(0);
    const cycle = await request.post(`/api/projects/${project.id}/dependencies`, { ...auth(pmToken), data: { predecessorTaskId: b, successorTaskId: a } });
    expect(cycle.status()).toBe(409);
    expect(((await cycle.json()) as { code: string }).code).toBe('DEPENDENCY_CYCLE');
  });

  test('روابط المهام تعمل من قائمة المهام، ومهمة غير مرئية للموظف تعرض «غير موجودة»', async ({ page, request }) => {
    const pmToken = await tokenFor(request, SEED_USERS.pm.email);
    const project = await activeProject(request, pmToken);
    const t = await request.post(`/api/projects/${project.id}/tasks`, { ...auth(pmToken), data: { title: 'مهمة لا يراها الموظف' } });
    const hiddenId = ((await t.json()) as { id: string }).id;

    await uiLoginToDashboard(page, SEED_USERS.emp.email, seedPassword());
    await page.goto('/tasks');
    const first = page.locator('a.dt-title').first();
    const name = (await first.innerText()).trim();
    await first.click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    await expect(page.locator('.summary__title')).toHaveText(name);

    await page.goto(`/tasks/${hiddenId}`);
    await expect(page.getByText('المهمة غير موجودة')).toBeVisible();
    const empToken = await tokenFor(request, SEED_USERS.emp.email);
    expect((await request.get(`/api/tasks/${hiddenId}`, auth(empToken))).status()).toBe(404);
  });
});

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_PROJECT_PREFIX } from './db';
import { SEED_USERS, seedPassword, uiLoginToDashboard } from './helpers';

/**
 * اللوحات والمشاريع والمهام على API حقيقي: كل رقم في الواجهة يُقارن بما يعيده الخادم لنفس المستخدم،
 * لا بأرقام مكتوبة في الاختبار (البيانات تتغير بين التشغيلات).
 */
async function tokenFor(request: APIRequestContext, email: string): Promise<string> {
  const r = await request.post('/api/auth/login', { data: { email, password: seedPassword() } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { accessToken: string }).accessToken;
}
async function api<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const r = await request.get(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status(), path).toBe(200);
  return (await r.json()) as T;
}
const stat = (page: Page, label: string) => page.locator('.stat').filter({ has: page.getByText(label, { exact: true }) }).locator('.stat__value');

interface Dash { projects: { total: number; byStatus: Record<string, number> }; tasks: { total: number; byStatus: Record<string, number>; overdue: number }; myOpenTasks: number; awaitingMyReview: number }

test.describe('اللوحات حسب الدور', () => {
  test('المدير التنفيذي: المؤشرات = استجابة /dashboard', async ({ page, request }) => {
    const d = await api<Dash>(request, await tokenFor(request, SEED_USERS.exec.email), '/dashboard');
    await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^مرحبًا بك، /);
    await expect(stat(page, 'إجمالي المشاريع')).toHaveText(String(d.projects.total));
    await expect(stat(page, 'مشاريع نشطة')).toHaveText(String(d.projects.byStatus.ACTIVE ?? 0));
    await expect(stat(page, 'المهام المكتملة')).toHaveText(String(d.tasks.byStatus.COMPLETED ?? 0));
    const pct = d.tasks.total ? `${Math.round(((d.tasks.byStatus.COMPLETED ?? 0) / d.tasks.total) * 100)}%` : '—';
    await expect(stat(page, 'معدل الإنجاز')).toHaveText(pct);
    await expect(page.getByRole('heading', { name: 'آخر تحديثات العمل' })).toBeVisible();
  });

  test('الموظف: «مهامي اليوم» ومؤشراته الشخصية', async ({ page, request }) => {
    const d = await api<Dash>(request, await tokenFor(request, SEED_USERS.emp.email), '/dashboard');
    await uiLoginToDashboard(page, SEED_USERS.emp.email, seedPassword());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مهامي اليوم');
    await expect(stat(page, 'مهامي المفتوحة')).toHaveText(String(d.myOpenTasks));
    await expect(stat(page, 'تحتاج تعديلات')).toHaveText(String(d.tasks.byStatus.CHANGES_REQUESTED ?? 0));
  });

  test('المدير المختص: «بانتظار مراجعتي» من الخادم', async ({ page, request }) => {
    const d = await api<Dash>(request, await tokenFor(request, SEED_USERS.spec.email), '/dashboard');
    await uiLoginToDashboard(page, SEED_USERS.spec.email, seedPassword());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة إدارة التخصص');
    await expect(stat(page, 'بانتظار مراجعتي')).toHaveText(String(d.awaitingMyReview));
  });
});

test.describe('المشاريع', () => {
  test('مدير المشروع: إنشاء ← التفاصيل ← تفعيل ← تعليق، وكل حالة محفوظة بعد إعادة التحميل', async ({ page }) => {
    const name = `${E2E_PROJECT_PREFIX}مشروع ${Date.now().toString(36)}`;
    await uiLoginToDashboard(page, SEED_USERS.pm.email, seedPassword());
    await page.getByRole('link', { name: '＋ مشروع جديد' }).click();
    const dlg = page.getByRole('dialog', { name: 'مشروع جديد' });
    await dlg.getByLabel(/^اسم المشروع/).fill(name);
    await dlg.getByLabel('تاريخ البداية').fill('2026-12-01');
    await dlg.getByLabel('تاريخ التسليم').fill('2026-11-01');
    await dlg.getByRole('button', { name: 'إنشاء المشروع' }).click();
    await expect(dlg.getByText('تاريخ التسليم يجب ألا يسبق تاريخ البداية.')).toBeVisible();
    await dlg.getByLabel('تاريخ التسليم').fill('2027-01-15');
    await dlg.getByRole('button', { name: 'إنشاء المشروع' }).click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(page.locator('.overview__name')).toHaveText(name);
    await expect(page.locator('.overview__head')).toContainText('مخطط');
    await expect(page.getByText('15 يناير 2027')).toBeVisible();

    await page.getByRole('button', { name: 'تفعيل المشروع' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'تفعيل المشروع' }).click();
    await expect(page.locator('.overview__head')).toContainText('نشط');
    await page.getByRole('button', { name: 'تعليق المشروع' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'تعليق المشروع' }).click();
    await expect(page.locator('.overview__head')).toContainText('معلّق');
    await page.reload();
    await expect(page.locator('.overview__head')).toContainText('معلّق');

    await page.goto('/projects');
    await page.getByLabel('ابحث عن مشروع').fill(name);
    await expect(page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) })).toContainText('معلّق');
  });

  test('الموظف: لا زر إنشاء ولا إجراءات على المشروع، والخادم يرفض التعديل (403)', async ({ page, request }) => {
    const token = await tokenFor(request, SEED_USERS.emp.email);
    const list = await api<{ items: Array<{ id: string }> }>(request, token, '/projects');
    await uiLoginToDashboard(page, SEED_USERS.emp.email, seedPassword());
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'المشاريع الحالية' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'مشروع جديد' })).toHaveCount(0);
    test.skip(!list.items.length, 'لا مشاريع ظاهرة للموظف في بيانات البذر');
    await page.goto(`/projects/${list.items[0]!.id}`);
    await expect(page.getByRole('heading', { name: 'المهام الرئيسية' })).toBeVisible();
    await expect(page.getByRole('button', { name: /المشروع$|تعديل البيانات/ })).toHaveCount(0);
    const patch = await request.patch(`/api/projects/${list.items[0]!.id}`, { headers: { Authorization: `Bearer ${token}` }, data: { name: 'x' } });
    expect(patch.status()).toBe(403);
  });
});

test.describe('المهام', () => {
  test('ترتيب افتراضي بالأولوية، وتصفية «عاجلة» و«المتأخرة» تطابق الخادم وتبقى بعد إعادة التحميل', async ({ page, request }) => {
    const token = await tokenFor(request, SEED_USERS.exec.email);
    const urgent = await api<{ total: number }>(request, token, '/tasks?priority=URGENT&overdue=false');
    const overdue = await api<{ total: number }>(request, token, '/tasks?overdue=true');
    await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
    await page.goto('/tasks');
    const prio = page.locator('tbody tr td[data-label="الأولوية"]');
    await expect(prio.first()).toBeVisible();
    const order = ['عاجلة', 'عالية', 'متوسطة', 'منخفضة'];
    const seen = (await prio.allInnerTexts()).map((t) => order.indexOf(t.trim()));
    expect(seen).toEqual(seen.toSorted((a, b) => a - b));

    await page.getByLabel('الأولوية', { exact: true }).selectOption('URGENT');
    await expect(page.locator('.count')).toHaveText(`(${urgent.total})`);
    await expect(page).toHaveURL(/priority=URGENT/);
    await page.getByLabel('الأولوية', { exact: true }).selectOption('');
    await page.getByLabel('المتأخرة عن موعدها فقط').check();
    await expect(page.locator('.count')).toHaveText(`(${overdue.total})`);
    await page.reload();
    await expect(page.getByLabel('المتأخرة عن موعدها فقط')).toBeChecked();
    await expect(page.locator('.count')).toHaveText(`(${overdue.total})`);
  });

  test('الموظف: «مهامي» = scope=mine في الخادم، ولا نطاق للمراجعة', async ({ page, request }) => {
    const mine = await api<{ total: number }>(request, await tokenFor(request, SEED_USERS.emp.email), '/tasks?scope=mine');
    await uiLoginToDashboard(page, SEED_USERS.emp.email, seedPassword());
    await page.goto('/tasks');
    await expect(page.getByRole('button', { name: 'للمراجعة' })).toHaveCount(0);
    await page.getByRole('button', { name: 'مهامي' }).click();
    await expect(page.locator('.count')).toHaveText(`(${mine.total})`);
  });
});

test.describe('الشركة', () => {
  test('المدير التنفيذي يعدّل الاسم فيبقى بعد إعادة التحميل؛ ومدير المشروع ممنوع واجهةً وخادمًا', async ({ page, request }, info) => {
    test.skip(info.project.name === 'mobile', 'تعديل اسم الشركة المشتركة مرة واحدة يكفي (يتجنب سباق المشروعين على البيانات نفسها)');
    const token = await tokenFor(request, SEED_USERS.exec.email);
    const original = (await api<{ name: string }>(request, token, '/companies/current')).name;
    const renamed = `${original} — E2E`;
    try {
      await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
      await page.getByRole('link', { name: 'الشركة' }).first().click();
      await page.getByLabel(/^الاسم الظاهر للفريق/).fill(renamed);
      await page.getByRole('button', { name: 'حفظ الاسم' }).click();
      await expect(page.getByText('حُفظ اسم الشركة.')).toBeVisible();
      await page.reload();
      await expect(page.getByLabel(/^الاسم الظاهر للفريق/)).toHaveValue(renamed);
    } finally {
      await request.patch('/api/companies/current', { headers: { Authorization: `Bearer ${token}` }, data: { name: original } });
    }
    const pmToken = await tokenFor(request, SEED_USERS.pm.email);
    expect((await request.patch('/api/companies/current', { headers: { Authorization: `Bearer ${pmToken}` }, data: { name: 'x' } })).status()).toBe(403);
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await uiLoginToDashboard(page, SEED_USERS.pm.email, seedPassword());
    await page.goto('/company');
    await expect(page.getByText('لا تملك صلاحية', { exact: false }).first()).toBeVisible();
  });
});

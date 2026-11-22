import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { SEED_USERS, createMustChangeUser, execToken, isMobile, seedPassword, uiLoginToDashboard } from './helpers';

/**
 * شاشة المستخدمين ضد الخادم وقاعدة البيانات الحقيقيين (لا محاكاة).
 * المستخدمون الذين تنشئهم الاختبارات بريدهم فريد، فلا تتعارض الجولات المتكررة.
 */

const lbl = (root: Page | Locator, text: string): Locator => root.getByLabel(new RegExp(`^${text}\\s*\\*?$`));

async function openUsers(page: Page): Promise<void> {
  await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
  await page.goto('/users');
  await expect(page.getByRole('heading', { level: 1, name: 'المستخدمون' })).toBeVisible();
}

/**
 * صف المستخدم بمطابقة تامة على نص البريد. المطابقة الجزئية (hasText) تلتقط بريدًا آخر ينتهي بالنص نفسه
 * (مثل e2e-…pm@alpha.test مع pm@alpha.test) فتجعل الاختبار هشًّا.
 */
const rowOf = (page: Page, email: string): Locator => page.getByRole('row').filter({ has: page.getByText(email, { exact: true }) });

/** يبحث عن مستخدم بالبريد (القائمة مرقّمة) ويعيد صفه. */
async function rowFor(page: Page, email: string): Promise<Locator> {
  await page.getByLabel('بحث بالاسم أو البريد').fill(email);
  const row = rowOf(page, email);
  await expect(row).toHaveCount(1);
  return row;
}

const login = (request: APIRequestContext, email: string, password: string) => request.post('/api/auth/login', { data: { email, password } });
const uniqueEmail = (): string => `e2e-ui-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@alpha.test`;

test.describe('المستخدمون — المدير التنفيذي', () => {
  test('القائمة الحقيقية: مستخدمو شركته فقط (بلا شركة بيتا)، وصفه محمي من التعطيل', async ({ page }, info) => {
    await openUsers(page);
    // القائمة مرقّمة (20/صفحة) فلا نفترض أن مستخدمي البذر كلهم في الصفحة الأولى: نبحث عن كلٍّ بريده.
    for (const email of [SEED_USERS.pm.email, SEED_USERS.spec.email, SEED_USERS.emp.email]) {
      await rowFor(page, email);
    }
    // عزل الشركات: لا يظهر أحد من شركة بيتا حتى عند البحث عنه صراحةً.
    await page.getByLabel('بحث بالاسم أو البريد').fill('@beta.test');
    await expect(page.getByText('لا نتائج مطابقة')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '@beta.test' })).toHaveCount(0);
    const self = await rowFor(page, SEED_USERS.exec.email);
    await expect(self).toContainText('(أنت)');
    await expect(self.getByRole('button')).toHaveCount(1); // «تعديل» فقط
    await expect(self.getByRole('button', { name: /تعطيل|إعادة تعيين/ })).toHaveCount(0);
    // لا تمرير أفقي في أي عرض (جدول على سطح المكتب، بطاقات على الجوال)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `تمرير أفقي في ${info.project.name}`).toBeLessThanOrEqual(0);
  });

  test('إنشاء مستخدم: كلمة مؤقتة تُعرض وتُنسخ وتعمل في الدخول، ثم تختفي نهائيًا من الصفحة', async ({ page, request, context }, info) => {
    test.skip(info.project.name === 'webkit', 'الحافظة غير مدعومة');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openUsers(page);
    const email = uniqueEmail();

    await page.getByRole('button', { name: 'إضافة مستخدم' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('button', { name: 'إنشاء المستخدم' }).click(); // فارغ ← رسائل عربية
    await expect(dlg.getByText('أدخل الاسم الكامل.')).toBeVisible();
    await expect(dlg.getByText('أدخل البريد الإلكتروني.')).toBeVisible();

    await lbl(dlg, 'الاسم الكامل').fill('ليلى اختبار الواجهة');
    await lbl(dlg, 'البريد الإلكتروني').fill(email);
    await lbl(dlg, 'الدور').selectOption('EMPLOYEE');
    await dlg.getByRole('button', { name: 'إنشاء المستخدم' }).click();

    await expect(page.getByRole('dialog').getByText('تم إنشاء المستخدم')).toBeVisible();
    const pwBox = page.getByTestId('temp-password');
    const pw = (await pwBox.innerText()).trim();
    expect(pw.length).toBeGreaterThanOrEqual(10);
    await expect(pwBox).toHaveAttribute('dir', 'ltr');

    await page.getByRole('button', { name: 'نسخ كلمة المرور' }).click();
    await expect(page.getByText('نُسخت كلمة المرور.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(pw);

    // الكلمة المعروضة هي التي يقبلها الخادم فعلًا، ومعها إجبار التغيير
    const ok = await login(request, email, pw);
    expect(ok.status()).toBe(200);
    expect(((await ok.json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

    await page.getByRole('button', { name: 'تم، حفظتها' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(pw)).toHaveCount(0); // لا أثر لها في الصفحة
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain(pw); // ولا في التخزين

    const row = await rowFor(page, email);
    await expect(row).toContainText('ليلى اختبار الواجهة');
    await expect(row).toContainText('الموظف');
    await expect(row).toContainText('كلمة مرور مؤقتة');
  });

  test('بريد مستخدم سابقًا: رسالة تحت الحقل وشرح الحل، والنموذج يحتفظ بما كُتب', async ({ page }) => {
    await openUsers(page);
    await page.getByRole('button', { name: 'إضافة مستخدم' }).click();
    const dlg = page.getByRole('dialog');
    await lbl(dlg, 'الاسم الكامل').fill('مكرر');
    await lbl(dlg, 'البريد الإلكتروني').fill(SEED_USERS.pm.email);
    await dlg.getByRole('button', { name: 'إنشاء المستخدم' }).click();
    await expect(dlg.getByText('هذا البريد مستخدم بالفعل.').first()).toBeVisible();
    await expect(dlg.getByText('كيف تعالجه')).toBeVisible();
    await expect(lbl(dlg, 'الاسم الكامل')).toHaveValue('مكرر');
    await expect(dlg.getByText('تظهر كلمة المرور هذه الآن فقط')).toHaveCount(0);
  });

  test('تعديل الاسم يُحفظ في الخادم ويبقى بعد إعادة التحميل', async ({ page, request }) => {
    const { email } = await createMustChangeUser(request);
    await openUsers(page);
    const row = await rowFor(page, email);
    await row.getByRole('button', { name: /^تعديل/ }).click();
    const dlg = page.getByRole('dialog');
    await expect(lbl(dlg, 'البريد الإلكتروني')).toBeDisabled();
    const newName = `اسم معدّل ${Date.now().toString(36)}`;
    await lbl(dlg, 'الاسم الكامل').fill(newName);
    await dlg.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toContainText(newName);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'المستخدمون' })).toBeVisible();
    await expect(await rowFor(page, email)).toContainText(newName);
  });

  test('تعطيل ثم تفعيل: الدخول يُرفض أثناء التعطيل ويعود بعد التفعيل', async ({ page, request }) => {
    const { email, temporaryPassword } = await createMustChangeUser(request);
    await openUsers(page);
    const row = await rowFor(page, email);

    await row.getByRole('button', { name: /^تعطيل/ }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('تُنهى جلساته الحالية فورًا');
    await dlg.getByRole('button', { name: 'إلغاء' }).click(); // الإلغاء لا يغيّر شيئًا
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await login(request, email, temporaryPassword)).status()).toBe(200);

    await row.getByRole('button', { name: /^تعطيل/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'تعطيل المستخدم' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toContainText('معطّل');
    expect((await login(request, email, temporaryPassword)).status(), 'المعطّل لا يدخل').toBe(401);

    await row.getByRole('button', { name: /^تفعيل/ }).click();
    await expect(row).toContainText('نشط');
    expect((await login(request, email, temporaryPassword)).status()).toBe(200);
  });

  test('إعادة تعيين كلمة المرور: كلمة جديدة تعمل والقديمة تتوقف', async ({ page, request }) => {
    const { email, temporaryPassword: oldPw } = await createMustChangeUser(request);
    await openUsers(page);
    const row = await rowFor(page, email);
    await row.getByRole('button', { name: /^إعادة تعيين كلمة المرور/ }).click();
    await expect(page.getByRole('dialog')).toContainText('كلمة مروره الحالية لن تعمل بعد الآن');
    await page.getByRole('dialog').getByRole('button', { name: 'إعادة التعيين' }).click();

    const pwBox = page.getByTestId('temp-password');
    await expect(pwBox).toBeVisible();
    const newPw = (await pwBox.innerText()).trim();
    expect(newPw).not.toBe(oldPw);
    await page.getByRole('button', { name: 'تم، حفظتها' }).click();
    await expect(page.getByText(newPw)).toHaveCount(0);

    expect((await login(request, email, oldPw)).status(), 'القديمة لا تعمل').toBe(401);
    const ok = await login(request, email, newPw);
    expect(ok.status()).toBe(200);
    expect(((await ok.json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
  });

  test('المدير التنفيذي لا يغيّر دوره بنفسه من النموذج', async ({ page }) => {
    await openUsers(page);
    const self = rowOf(page, SEED_USERS.exec.email);
    await self.getByRole('button', { name: /^تعديل/ }).click();
    await expect(lbl(page.getByRole('dialog'), 'الدور')).toBeDisabled();
    await expect(page.getByRole('dialog')).toContainText('لا يمكنك تغيير دورك بنفسك');
  });
});

test.describe('المستخدمون — الأدوار الأخرى', () => {
  for (const key of ['pm', 'spec', 'emp'] as const) {
    test(`دور ${SEED_USERS[key].roleLabel}: لا رابط في القائمة، والفتح المباشر «لا تملك صلاحية»، والخادم يرفض الكتابة`, async ({ page, request }, info) => {
      await uiLoginToDashboard(page, SEED_USERS[key].email, seedPassword());
      if (!isMobile(info.project.name)) await expect(page.locator('#sidebar').getByRole('link', { name: 'المستخدمون' })).toHaveCount(0);
      await page.goto('/users');
      await expect(page.getByText('لا تملك صلاحية هذه الصفحة')).toBeVisible();
      await expect(page.getByLabel('بحث بالاسم أو البريد')).toHaveCount(0);

      // لا اعتماد على الواجهة وحدها: الخادم يرفض الكتابة لهذا الدور
      const res = await login(request, SEED_USERS[key].email, seedPassword());
      const token = ((await res.json()) as { accessToken: string }).accessToken;
      const w = await request.post('/api/users', { headers: { Authorization: `Bearer ${token}` }, data: { fullName: 'س', email: uniqueEmail(), role: 'EMPLOYEE' } });
      expect(w.status()).toBe(403);
    });
  }

  test('المدير التنفيذي يرى رابط المستخدمين في القائمة (سطح المكتب)', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'القائمة مخفية في الجوال');
    await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
    await page.locator('#sidebar').getByRole('link', { name: 'المستخدمون' }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.locator('#sidebar').getByRole('link', { name: 'المستخدمون' })).toHaveAttribute('aria-current', 'page');
  });
});

test('رمز المدير التنفيذي يعمل مباشرة على الـAPI (تحقق من البيئة قبل الاختبارات)', async ({ request }) => {
  expect((await execToken(request)).length).toBeGreaterThan(20);
});

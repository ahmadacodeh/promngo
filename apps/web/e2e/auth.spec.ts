import { expect, test } from '@playwright/test';
import { SEED_USERS, byLabel, createMustChangeUser, isMobile, seedPassword, uiLogin, uiLoginToDashboard, unknownEmail } from './helpers';

const emailField = (page: import('@playwright/test').Page) => byLabel(page, 'البريد الإلكتروني');
const passField = (page: import('@playwright/test').Page) => byLabel(page, 'كلمة المرور');

test.describe('الدخول (API حقيقي)', () => {
  test('الصفحة عربية RTL بالهوية المعتمدة (Cairo + Canvas)', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'تسجيل الدخول' })).toBeVisible();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(248, 250, 249)'); // #F8FAF9
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toContain('Cairo');
    expect(await page.evaluate(() => document.fonts.check('16px Cairo'))).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, 'لا تمرير أفقي').toBe(false);
  });

  test('إرسال فارغ: رسائل عربية لكل حقل بلا طلب شبكة', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/auth/login', (r) => {
      calls += 1;
      return r.continue();
    });
    await page.goto('/login');
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page.getByText('أدخل بريدك الإلكتروني.')).toBeVisible();
    await expect(page.getByText('أدخل كلمة المرور.')).toBeVisible();
    await emailField(page).fill('ليس-بريدا');
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page.getByText('صيغة البريد غير صحيحة', { exact: false })).toBeVisible();
    expect(calls).toBe(0);
  });

  test('كلمة مرور خاطئة: خطأ عربي (ماذا/لماذا/كيف) دون كشف وجود الحساب، وتبقى في الدخول', async ({ page }) => {
    await uiLogin(page, SEED_USERS.exec.email, 'Wrong-Password-1');
    const alert = page.getByRole('alert').first();
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('السبب المحتمل');
    await expect(alert).toContainText('كيف تعالجه');
    await expect(page).toHaveURL(/\/login/);
    await expect(passField(page)).toHaveValue(''); // لا بقاء لكلمة المرور في الحقل بعد المحاولة
    // البريد غير الموجود يعطي العنوان نفسه (لا تعداد حسابات)
    const title = await alert.locator('.alert__title').innerText();
    await page.reload();
    await uiLogin(page, unknownEmail(), 'Wrong-Password-1');
    await expect(page.getByRole('alert').first().locator('.alert__title')).toHaveText(title);
  });

  test('نجاح الدخول: لوحة التحكم باسم المستخدم والدور والشركة، وكلمة المرور لا تُخزَّن في المتصفح', async ({ page }) => {
    const pw = seedPassword();
    await uiLoginToDashboard(page, SEED_USERS.exec.email, pw);
    await expect(page.getByText('شركة ألفا').first()).toBeVisible();
    await expect(page.getByText(SEED_USERS.exec.roleLabel).first()).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    expect(stored).not.toContain(pw);
    const leaked = await page.evaluate((v) => Array.from(document.querySelectorAll('input')).some((i) => i.value === v), pw);
    expect(leaked, 'لا حقل يحمل كلمة المرور بعد الدخول').toBe(false);
  });

  test('لوحة كل دور تعرض دوره، وعزل الشركتين ظاهر في الواجهة', async ({ page }) => {
    const pw = seedPassword();
    const logout = async (): Promise<void> => {
      await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
      await expect(page).toHaveURL(/\/login/);
    };
    for (const u of [SEED_USERS.pm, SEED_USERS.spec, SEED_USERS.emp]) {
      await uiLoginToDashboard(page, u.email, pw);
      await expect(page.getByText(u.roleLabel).first()).toBeVisible();
      await expect(page.getByText('شركة ألفا').first()).toBeVisible();
      await logout();
    }
    await uiLoginToDashboard(page, SEED_USERS.betaExec.email, pw);
    await expect(page.getByText('شركة بيتا').first()).toBeVisible();
    await expect(page.getByText('شركة ألفا')).toHaveCount(0);
  });

  test('لوحة المفاتيح: كتابة + Tab + Enter تُدخل المستخدم، والتركيز مرئي', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'لوحة المفاتيح الفيزيائية خاصة بسطح المكتب');
    await page.goto('/login');
    await emailField(page).focus();
    await page.keyboard.type(SEED_USERS.exec.email);
    await page.keyboard.press('Tab');
    await expect(passField(page)).toBeFocused();
    const ring = await passField(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`;
    });
    expect(ring, 'مؤشر تركيز ظاهر على الحقل').not.toMatch(/^none\|0px\|none$/);
    await page.keyboard.type(seedPassword());
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('انقطاع الشبكة: رسالة اتصال عربية وزر إعادة المحاولة ينجح بعد عودتها', async ({ page }) => {
    await page.route('**/api/auth/login', (r) => r.abort('connectionrefused'));
    await uiLogin(page, SEED_USERS.exec.email, seedPassword());
    const alert = page.getByRole('alert').first();
    await expect(alert).toContainText('تعذّر الاتصال بالخادم');
    await page.unroute('**/api/auth/login');
    // كلمة المرور فُرِّغت بعد المحاولة؛ أعد إدخالها ثم أعد المحاولة بالضغط على الزر.
    await passField(page).fill(seedPassword());
    await alert.getByRole('button', { name: 'إعادة المحاولة' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('حد المحاولات: بعد 5 إخفاقات يظهر انتظار بعدّاد ويتعطل الزر', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'يكفي مرة واحدة (الحد مخزّن في القاعدة ويتراكم لكل IP)');
    const email = unknownEmail();
    await page.goto('/login');
    for (let i = 0; i < 6; i += 1) {
      await emailField(page).fill(email);
      await passField(page).fill('Wrong-Password-1');
      const btn = page.getByRole('button', { name: /دخول|جارٍ التحقق/ });
      if (await btn.isDisabled()) break;
      await btn.click();
      await expect(page.getByRole('alert').first()).toBeVisible();
    }
    await expect(page.getByRole('timer')).toContainText('يمكنك المحاولة مرة أخرى بعد');
    await expect(page.getByRole('button', { name: 'دخول' })).toBeDisabled();
  });
});

test.describe('التوجيه بعد الدخول', () => {
  test('الزائر يُحوَّل إلى الدخول مع redirect ثم يعود إلى وجهته', async ({ page }) => {
    await page.goto('/change-password');
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)change-password/);
    await emailField(page).fill(SEED_USERS.pm.email);
    await passField(page).fill(seedPassword());
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page).toHaveURL(/\/change-password$/);
  });

  for (const evil of ['https://evil.example/steal', '//evil.example', 'javascript:alert(1)']) {
    test(`redirect خارجي مرفوض: ${evil}`, async ({ page }) => {
      await page.goto(`/login?redirect=${encodeURIComponent(evil)}`);
      await emailField(page).fill(SEED_USERS.emp.email);
      await passField(page).fill(seedPassword());
      await page.getByRole('button', { name: 'دخول' }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      expect(new URL(page.url()).hostname).toBe('127.0.0.1');
    });
  }

  test('صفحة غير موجودة داخل القالب بعد الدخول', async ({ page }) => {
    await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
    await page.goto('/no-such-page');
    await expect(page.locator('#main').getByText('الصفحة غير موجودة')).toBeVisible();
    await expect(page.getByRole('link', { name: /لوحة التحكم/ }).first()).toBeVisible();
  });
});

test.describe('تغيير كلمة المرور الإلزامي (مستخدم جديد حقيقي)', () => {
  test('كلمة مؤقتة → إجبار على التغيير → دخول بالجديدة وفشل المؤقتة', async ({ page, request }) => {
    const u = await createMustChangeUser(request);
    await uiLogin(page, u.email, u.temporaryPassword);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByText('يجب تعيين كلمة مرور جديدة', { exact: false })).toBeVisible();

    // لا مهرب من الصفحة قبل التغيير
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/change-password$/);

    const cur = byLabel(page, 'كلمة المرور الحالية');
    const next = byLabel(page, 'كلمة المرور الجديدة');
    const conf = byLabel(page, 'تأكيد كلمة المرور الجديدة');
    await cur.fill(u.temporaryPassword);
    await next.fill('short1');
    await conf.fill('short1');
    await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
    await expect(page.getByText('قصيرة', { exact: false })).toBeVisible();

    const fresh = `Fresh-${Date.now().toString(36)}-Pass9`;
    await next.fill(fresh);
    await conf.fill(fresh);
    await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(u.email)).toBeVisible();

    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/login/);
    await uiLoginToDashboard(page, u.email, fresh); // الجديدة تعمل
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await uiLogin(page, u.email, u.temporaryPassword); // المؤقتة لم تعد تعمل
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('كلمة حالية خاطئة: خطأ عربي مربوط بالحقل ولا تتغير الحالة', async ({ page, request }) => {
    const u = await createMustChangeUser(request);
    await uiLogin(page, u.email, u.temporaryPassword);
    await expect(page).toHaveURL(/\/change-password$/);
    await byLabel(page, 'كلمة المرور الحالية').fill('Not-The-Temp-1');
    await byLabel(page, 'كلمة المرور الجديدة').fill('Another-Pass-2026');
    await byLabel(page, 'تأكيد كلمة المرور الجديدة').fill('Another-Pass-2026');
    await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/change-password$/);
  });
});

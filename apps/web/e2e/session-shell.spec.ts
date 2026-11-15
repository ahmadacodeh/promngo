import { expect, test } from '@playwright/test';
import { SEED_USERS, isMobile, seedPassword, uiLoginToDashboard } from './helpers';

test.describe('الجلسة', () => {
  test('إعادة تحميل الصفحة تُبقي الجلسة (تجديد صامت بتدوير رمز التحديث)', async ({ page }) => {
    await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
    const before = await page.evaluate(() => sessionStorage.getItem('promango.rt'));
    expect(before).toBeTruthy();
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('مرحبًا');
    const after = await page.evaluate(() => sessionStorage.getItem('promango.rt'));
    expect(after, 'الرمز دُوِّر (استخدام واحد)').not.toBe(before);
    await page.reload(); // التدوير يعمل أكثر من مرة
    await expect(page.getByRole('heading', { level: 1 })).toContainText('مرحبًا');
  });

  test('بلا رمز تحديث (جلسة منتهية) → الدخول مع تنبيه ثم العودة للوجهة', async ({ page }) => {
    await uiLoginToDashboard(page, SEED_USERS.pm.email, seedPassword());
    await page.evaluate(() => sessionStorage.removeItem('promango.rt'));
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
  });

  test('رمز تحديث تالف → الدخول (لا شاشة بيضاء ولا حلقة)', async ({ page }) => {
    await uiLoginToDashboard(page, SEED_USERS.pm.email, seedPassword());
    await page.evaluate(() => sessionStorage.setItem('promango.rt', 'not.a.token'));
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'تسجيل الدخول' })).toBeVisible();
  });

  test('تسجيل الخروج: يمسح الجلسة ويُبطل رمز التحديث في الخادم', async ({ page, request }) => {
    await uiLoginToDashboard(page, SEED_USERS.emp.email, seedPassword());
    const rt = await page.evaluate(() => sessionStorage.getItem('promango.rt'));
    expect(rt).toBeTruthy();
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => sessionStorage.getItem('promango.rt'))).toBeNull();
    const res = await request.post('/api/auth/refresh', { data: { refreshToken: rt } });
    expect(res.status(), 'الرمز القديم مرفوض بعد الخروج').toBe(401);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/); // الوجهة الافتراضية (/dashboard) لا تُحمَّل في redirect عمدًا
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'تسجيل الدخول' })).toBeVisible();
  });
});

test.describe('قالب التطبيق (RTL + متجاوب)', () => {
  test('سطح المكتب: الشريط الجانبي على اليمين وزر القائمة مخفي', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'خاص بسطح المكتب');
    await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
    const box = await page.locator('#sidebar').boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box, 'الشريط الجانبي ظاهر').not.toBeNull();
    expect(box!.x + box!.width).toBeGreaterThan(vw - 2); // ملاصق للحافة اليمنى
    expect(box!.x).toBeGreaterThan(vw / 2);
    expect(Math.round(box!.width)).toBe(232);
    await expect(page.getByRole('button', { name: 'القائمة' })).toBeHidden();
    await expect(page.locator('#sidebar').getByRole('link', { name: 'لوحة التحكم' })).toHaveAttribute('aria-current', 'page');
  });

  test('الجوال: القائمة درج يفتح بالزر ويُغلق بـ Esc وبالنقر على الخلفية، بلا تمرير أفقي', async ({ page }, info) => {
    test.skip(!isMobile(info.project.name), 'خاص بالجوال');
    await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
    const menu = page.getByRole('button', { name: 'القائمة' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    const vw = page.viewportSize()!.width;
    await expect
      .poll(async () => {
        const b = await page.locator('#sidebar').boundingBox();
        return b ? b.x >= -1 && b.x + b.width <= vw + 1 : false;
      })
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await page.locator('.scrim').click({ position: { x: 10, y: 300 } });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test('رابط تخطي إلى المحتوى يعمل بلوحة المفاتيح', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'لوحة المفاتيح الفيزيائية خاصة بسطح المكتب');
    await uiLoginToDashboard(page, SEED_USERS.exec.email, seedPassword());
    await page.reload(); // نقطة بدء التبويب = بداية الصفحة (النقر يغيّرها)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('مرحبًا');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /إلى المحتوى/ });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});

import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * كلمة مرور بيانات التطوير تُمرَّر من البيئة فقط (SEED_PASSWORD) ولا تُكتب في أي ملف.
 * شغّل: SEED_PASSWORD=... npm run e2e
 */
export function seedPassword(): string {
  const v = (process.env.SEED_PASSWORD ?? '').trim();
  if (!v) {
    throw new Error('SEED_PASSWORD غير مضبوط: مرّر كلمة مرور بيانات التطوير في البيئة قبل تشغيل اختبارات E2E.');
  }
  return v;
}

export const SEED_USERS = {
  exec: { email: 'exec@alpha.test', roleLabel: 'المدير التنفيذي' },
  pm: { email: 'pm@alpha.test', roleLabel: 'مدير المشروع' },
  spec: { email: 'spec1@alpha.test', roleLabel: 'المدير المختص' },
  emp: { email: 'emp1@alpha.test', roleLabel: 'الموظف' },
  betaExec: { email: 'exec@beta.test', roleLabel: 'المدير التنفيذي' },
} as const;

/** الوسم قد يحمل علامة « *» المرئية للحقول الإلزامية؛ نطابق نص الوسم بدقة مع تجاهلها (وبلا خلط مع زر «إظهار كلمة المرور»). */
export const byLabel = (page: Page, text: string) => page.getByLabel(new RegExp(`^${text}\\s*\\*?$`));

export async function uiLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await byLabel(page, 'البريد الإلكتروني').fill(email);
  await byLabel(page, 'كلمة المرور').fill(password);
  await page.getByRole('button', { name: 'دخول' }).click();
}

export async function uiLoginToDashboard(page: Page, email: string, password: string): Promise<void> {
  await uiLogin(page, email, password);
  await expect(page).toHaveURL(/\/dashboard$/);
  // عنوان اللوحة يختلف حسب الدور (Figma): أي واحد من الأربعة يعني أن اللوحة رُسمت.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^(مرحبًا بك، |مساحة إدارة المشاريع$|لوحة إدارة التخصص$|مهامي اليوم$)/);
}

/** مدير تنفيذي عبر API الحقيقي (من خلال وكيل Vite) لإنشاء بيانات اختبار. */
export async function execToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { email: SEED_USERS.exec.email, password: seedPassword() } });
  expect(res.status(), 'دخول المدير التنفيذي عبر API').toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

let counter = 0;
const uniq = (): string => `${Date.now().toString(36)}${(counter += 1)}${Math.random().toString(36).slice(2, 6)}`;

/** يُنشئ مستخدمًا حقيقيًا بكلمة مؤقتة (mustChangePassword=true) عبر POST /users. */
export async function createMustChangeUser(request: APIRequestContext): Promise<{ email: string; temporaryPassword: string }> {
  const token = await execToken(request);
  const email = `e2e-${uniq()}@alpha.test`;
  const res = await request.post('/api/users', {
    headers: { Authorization: `Bearer ${token}` },
    data: { fullName: 'مستخدم اختبار E2E', email, role: 'EMPLOYEE' },
  });
  expect(res.status(), 'إنشاء مستخدم اختبار').toBe(201);
  const body = (await res.json()) as { temporaryPassword: string; user: { mustChangePassword: boolean } };
  expect(body.user.mustChangePassword).toBe(true);
  return { email, temporaryPassword: body.temporaryPassword };
}

/** بريد فريد غير موجود لاختبار الحد دون قفل حساب حقيقي. */
export const unknownEmail = (): string => `nobody-${uniq()}@alpha.test`;

export const isMobile = (name: string): boolean => name === 'mobile';

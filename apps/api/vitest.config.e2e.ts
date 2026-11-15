import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * اختبارات E2E حقيقية: تطبيق NestJS كامل + PostgreSQL فعلي (قاعدة *_test فقط).
 * ملفات الاختبار تعمل تباعًا (قاعدة واحدة مشتركة) ولا شيء مُحاكى في المصادقة أو القاعدة.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/e2e/**/*.e2e-spec.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** اختبارات وحدة سريعة: لا قاعدة بيانات ولا شبكة. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    clearMocks: true,
  },
});

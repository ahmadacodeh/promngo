import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the REAL API (apps/api) through the Vite dev proxy.
 * Start the API first (port 3000), then `npm run e2e`.
 * Set E2E_BASE_URL to target an already running server instead of starting Vite.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL, locale: 'ar', timezoneId: 'Asia/Damascus', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run dev -- --host 127.0.0.1', url: baseURL, reuseExistingServer: true, timeout: 60_000 },
});

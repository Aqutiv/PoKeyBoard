import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the production preview build: real service worker,
 * real sample pack, real wasm encoder — the same artifact that deploys.
 * `npm run test:e2e` builds first via the pretest:e2e hook.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/globalSetup.ts',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

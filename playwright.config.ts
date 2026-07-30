import { defineConfig, devices } from '@playwright/test';
// The .js extension is what nodenext resolution wants; it maps to the .ts file.
import { PREVIEW_URL } from './tests/e2e/previewServer.js';

/**
 * E2E tests run against the production preview build — the same artifact that
 * deploys. `npm run test:e2e` builds first via the pretest:e2e hook.
 *
 * Two deliberate departures from a plain visit, both for speed: the service
 * worker is blocked, and tests/e2e/fixtures.ts trims the sample manifest to six
 * real samples so `data-piano-ready` no longer waits on ~12 MB of audio. Specs
 * that are *about* the worker or about sample loading opt back out; see the
 * `samplePack` fixture. POKEYBOARD_E2E_REAL_PACK=1 runs the whole suite the
 * unmodified way.
 */
const realPack = process.env.POKEYBOARD_E2E_REAL_PACK === '1';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/globalSetup.ts',
  timeout: 45_000,
  fullyParallel: true,
  workers: process.env.CI ? '50%' : '75%',
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // POKEYBOARD_E2E_PORT moves this, for running two checkouts at once.
    baseURL: PREVIEW_URL,
    // Locally (retries: 0) nothing is recorded; `--trace on` when debugging.
    trace: 'on-first-retry',
    // The worker CacheFirsts /piano/ and claims the page, and Playwright cannot
    // route requests a worker itself makes — so the manifest stub only lands
    // with the worker out of the way. It also drops an install and a precache
    // from every test.
    serviceWorkers: realPack ? 'allow' : 'block',
  },
  projects: [
    {
      name: 'e2e',
      testIgnore: /serviceWorker\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The service-worker tests, serial and last. `dependencies` keeps them
      // clear of the pool — one of them byte-mutates dist/service-worker.js,
      // which every other test loads — and `fullyParallel: false` over a single
      // file keeps them clear of each other, including --repeat-each copies.
      // The longer timeout is because a real install and activate has to happen
      // for real; it costs nothing when the wait is already satisfied.
      name: 'service-worker',
      testMatch: /serviceWorker\.spec\.ts/,
      dependencies: ['e2e'],
      fullyParallel: false,
      timeout: 90_000,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

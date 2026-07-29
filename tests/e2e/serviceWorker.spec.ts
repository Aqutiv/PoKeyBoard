import { copyFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { expect, test } from './fixtures';
import { SW_BACKUP_PATH, SW_PATH, writeServiceWorkerAtomically } from './serviceWorkerFile';
import { gotoAppReady, nav } from './helpers';

/**
 * Every test that needs a real service worker, in one file on purpose.
 *
 * playwright.config.ts gives this file a project of its own that runs after the
 * main pool with `fullyParallel: false`, which is what makes it a single file
 * rather than two. Two reasons it cannot live in the pool:
 *
 *  - The update test byte-mutates dist/service-worker.js — shared build output
 *    that every other test loads — and restores it afterwards.
 *  - Both tests wait on a real install and activate. workbox-window defers
 *    registration until after the load event, then precaches the whole shell,
 *    and with N workers against one single-threaded Vite preview server that
 *    does not reliably finish inside a normal timeout.
 *
 * The generous timeouts here are the project's, not a workaround: waiting on an
 * install costs nothing when the condition is already met.
 */
test.use({ serviceWorkers: 'allow' });

test.describe('offline shell', () => {
  test('service worker activates and the shell loads offline', async ({ page, context }) => {
    // Not gotoAppReady: the shell and the worker are what is under test, and the
    // sample decode is unrelated to both.
    await page.goto('/');
    await expect(nav(page)).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
      timeout: 30_000,
    });
    await context.setOffline(true);
    await page.reload();
    await expect(nav(page)).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });
});

/**
 * Simulates shipping a new version: byte-change the served service worker,
 * revisit, and expect the in-app "update available" flow to offer it.
 */
test.describe('service worker update prompt', () => {
  // The real pack too, so the one test covering a real worker and a real pack
  // together is deterministic — with the worker active, the manifest stub cannot
  // be routed reliably anyway.
  test.use({ samplePack: 'real' });

  test('a changed service worker surfaces the update in Settings', async ({ page }) => {
    await gotoAppReady(page);
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
      timeout: 30_000,
    });

    // The pristine bytes go to disk before anything is touched, so a Ctrl+C
    // between here and the finally still leaves globalSetup able to repair it.
    copyFileSync(SW_PATH, SW_BACKUP_PATH);
    try {
      const original = readFileSync(SW_BACKUP_PATH, 'utf8');
      writeServiceWorkerAtomically(`${original}\n// e2e update ${Date.now()}\n`);
      // A navigation triggers the browser's SW update check.
      await page.reload();
      await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByText('An update is ready.')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Apply update and reload' })).toBeEnabled();
    } finally {
      copyFileSync(SW_BACKUP_PATH, `${SW_PATH}.e2e-tmp`);
      renameSync(`${SW_PATH}.e2e-tmp`, SW_PATH);
      rmSync(SW_BACKUP_PATH);
    }
  });
});

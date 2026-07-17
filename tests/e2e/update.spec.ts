import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { gotoAppReady } from './helpers';

const SW_PATH = path.resolve('dist', 'service-worker.js');

/**
 * Simulates shipping a new version: byte-change the served service worker,
 * revisit, and expect the in-app "update available" flow to offer it.
 */
test.describe('service worker update prompt', () => {
  test('a changed service worker surfaces the update in Settings', async ({ page }) => {
    await gotoAppReady(page);
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
      timeout: 15_000,
    });

    const original = readFileSync(SW_PATH, 'utf8');
    try {
      writeFileSync(SW_PATH, `${original}\n// e2e update ${Date.now()}\n`);
      // A navigation triggers the browser's SW update check.
      await page.reload();
      await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByText('An update is ready.')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Apply update and reload' })).toBeEnabled();
    } finally {
      writeFileSync(SW_PATH, original);
    }
  });
});

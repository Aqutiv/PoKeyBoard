import { expect, test } from '@playwright/test';
import { gotoAppReady, recordShortTake } from './helpers';

test.describe('MP3 export', () => {
  test('renders a take to a real MP3 and downloads it', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    await page.getByRole('button', { name: 'Share audio' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export audio' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Render audio' }).click();

    await expect(dialog.getByText(/Audio ready/)).toBeVisible({ timeout: 30_000 });

    // Headless Chromium has no share targets → Share audio falls back to
    // a download. This IS the download-fallback path from the spec.
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Share audio' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^PoKeyBoard - .*\.mp3$/);

    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    const { statSync, readFileSync } = await import('node:fs');
    expect(statSync(filePath!).size).toBeGreaterThan(5_000);
    const head = readFileSync(filePath!).subarray(0, 2);
    const isMp3 = head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0;
    const isId3 = head[0] === 0x49 && head[1] === 0x44;
    expect(isMp3 || isId3).toBe(true);
  });

  test('reuses the cached export for an unchanged take', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    // First export.
    await page.getByRole('button', { name: 'Share audio' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export audio' });
    await dialog.getByRole('button', { name: 'Render audio' }).click();
    await expect(dialog.getByText(/Audio ready/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Second export of the identical take hits the cache.
    await page.getByRole('button', { name: 'Share audio' }).click();
    await dialog.getByRole('button', { name: 'Render audio' }).click();
    await expect(dialog.getByText(/reused cached export/)).toBeVisible({ timeout: 15_000 });
  });
});

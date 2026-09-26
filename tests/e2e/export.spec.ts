import { expect, test } from './fixtures';
import { gotoAppReady, nav, recordShortTake } from './helpers';

test.describe('MP3 export', () => {
  // The suite's guarantee that the real 42-file core pack still decodes and
  // renders audible audio through the wasm encoder: the size and header
  // assertions below fail on a silent or empty render.
  test.use({ samplePack: 'real' });

  for (const piano of ['Salamander', 'bitKlavier', 'Wurlitzer'])
    test(`renders a ${piano} take to a real MP3 and downloads it`, async ({ page }) => {
      await gotoAppReady(page);
      if (piano !== 'Salamander') {
        await nav(page).getByRole('button', { name: 'Settings' }).click();
        await page.getByRole('radio', { name: new RegExp(`^${piano}`) }).check();
        await nav(page).getByRole('button', { name: 'Play' }).click();
        await page.locator('section[data-piano-ready="true"]').waitFor();
      }
      await recordShortTake(page);

      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Audio (MP3)' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export audio' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('radio', { name: /^Even/ })).toBeChecked();
      await dialog.getByRole('button', { name: 'Render audio' }).click();

      await expect(dialog.getByText(/Audio ready/)).toBeVisible({ timeout: 30_000 });

      // Headless Chromium has no share targets → Share audio falls back to
      // a download. This IS the download-fallback path from the spec.
      const downloadPromise = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Share audio' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^PoKeyBoard - .*\.mp3$/);
      // Named after the piano it was rendered with.
      expect(download.suggestedFilename()).toContain(`(${piano}).mp3`);

      const filePath = await download.path();
      expect(filePath).not.toBeNull();
      const { statSync, readFileSync } = await import('node:fs');
      expect(statSync(filePath!).size).toBeGreaterThan(5_000);
      // An ID3 tag naming the take, then the first MP3 frame right after it.
      const bytes = readFileSync(filePath!);
      expect(bytes.subarray(0, 3).toString('latin1')).toBe('ID3');
      const tagSize = (bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!;
      expect(bytes.subarray(10, 14).toString('latin1')).toBe('TIT2');
      const frame = bytes.subarray(10 + tagSize, 12 + tagSize);
      expect(frame[0] === 0xff && ((frame[1] ?? 0) & 0xe0) === 0xe0).toBe(true);
    });

  test('reuses the cached export for an unchanged take', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    // First export.
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Audio (MP3)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export audio' });
    await dialog.getByRole('button', { name: 'Render audio' }).click();
    await expect(dialog.getByText(/Audio ready/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Second export of the identical take hits the cache.
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Audio (MP3)' }).click();
    await dialog.getByRole('button', { name: 'Render audio' }).click();
    await expect(dialog.getByText(/reused cached export/)).toBeVisible({ timeout: 15_000 });
  });
});

import { expect, test } from '@playwright/test';
import { gotoAppReady, nav, recordShortTake } from './helpers';

const VALID_TAKE = {
  schemaVersion: 1,
  id: 'e2e-import-0000-0000-000000000001',
  title: 'Imported scale',
  createdAt: '2026-07-17T10:00:00.000Z',
  updatedAt: '2026-07-17T10:00:00.000Z',
  durationMs: 2000,
  samplePackVersion: 'salamander-grand-v1',
  tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 0 },
  instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
  notes: [
    { id: 'i1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
    { id: 'i2', midi: 62, startMs: 500, durationMs: 400, velocity: 0.7 },
    { id: 'i3', midi: 64, startMs: 1000, durationMs: 400, velocity: 0.7 },
  ],
  pedalEvents: [],
  display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
};

test.describe('takes library', () => {
  test('lists a recorded take; rename, duplicate, and delete work', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    const item = page.locator('.take-item').first();
    await expect(item).toContainText('2 notes');

    // Rename.
    await item.getByRole('button', { name: /More actions/ }).click();
    await item.getByRole('button', { name: 'Rename' }).click();
    await item.getByLabel('New title').fill('My e2e take');
    await item.getByLabel('New title').press('Enter');
    await expect(page.locator('.take-item').first()).toContainText('My e2e take');

    // Duplicate — the actions row is still expanded after the rename.
    const first = page.locator('.take-item').first();
    await first.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByText('My e2e take copy')).toBeVisible();

    // Delete the copy (confirm dialog).
    page.once('dialog', (dialog) => void dialog.accept());
    const copyItem = page.locator('.take-item', { hasText: 'My e2e take copy' });
    await copyItem.getByRole('button', { name: /More actions/ }).click();
    await copyItem.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('My e2e take copy')).toHaveCount(0);
  });

  test('exports take JSON as a download', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    const item = page.locator('.take-item').first();
    await item.getByRole('button', { name: /More actions/ }).click();
    const downloadPromise = page.waitForEvent('download');
    await item.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^PoKeyBoard - .*\.pokeyboard\.json$/);
  });

  test('imports a take JSON with preview and opens it', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    await page.getByLabel('Import take JSON file').setInputFiles({
      name: 'PoKeyBoard - Imported scale.pokeyboard.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(VALID_TAKE)),
    });
    const dialog = page.getByRole('dialog', { name: 'Import take' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Imported scale');
    await expect(dialog).toContainText('3');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    // Lands on Play with the imported take active.
    await expect(page.getByRole('heading', { name: 'Imported scale' })).toBeVisible();
  });

  test('rejects an invalid take JSON with a useful message', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    await page.getByLabel('Import take JSON file').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"schemaVersion": 1, "notes": "nope"}'),
    });
    await expect(
      page.getByRole('status').filter({ hasText: 'not a valid PoKeyBoard take' }),
    ).toBeVisible();
  });

  test('backs up all takes as a download', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Backup all takes' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^PoKeyBoard Backup - \d{4}-\d{2}-\d{2}\.json$/);
  });
});

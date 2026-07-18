import { expect, test } from '@playwright/test';
import { gotoAppReady, nav, recordShortTake } from './helpers';

test.describe('Sheet music export', () => {
  test('exports a recorded take to a valid one-page PDF', async ({ page }) => {
    await gotoAppReady(page);
    await expect(page.getByRole('button', { name: 'Share sheet', exact: true })).toBeDisabled();
    await recordShortTake(page);

    await page.getByRole('button', { name: 'Share sheet', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export sheet music' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/≈ 1 page/)).toBeVisible();
    await expect(dialog.locator('.sheet-preview__canvas')).toBeVisible();

    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    await expect(dialog.getByText(/PDF ready/)).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^PoKeyBoard - .*\.pdf$/);

    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(filePath!);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(new Uint8Array(bytes));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getCreator()).toBe('PoKeyBoard');
  });

  test('opens the dialog from a Takes action row', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    await page.getByRole('button', { name: /More actions for/ }).click();
    await page.getByRole('button', { name: 'Share sheet music' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export sheet music' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Generate PDF' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('exports the library Moonlight Sonata across multiple pages', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Open Moonlight Sonata (1st Movement)' }).click();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Share sheet', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export sheet music' });
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    await expect(dialog.getByText(/PDF ready/)).toBeVisible({ timeout: 60_000 });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(filePath!);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(new Uint8Array(bytes));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe('Moonlight Sonata (1st Movement)');
    // Kept as a test artifact for visual inspection of the engraving.
    await download.saveAs('test-results/moonlight-sheet.pdf');
  });
});

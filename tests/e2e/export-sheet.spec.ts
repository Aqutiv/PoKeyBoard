import { expect, test } from './fixtures';
import { gotoAppReady, nav, recordShortTake } from './helpers';

test.describe('Sheet music export', () => {
  test('exports a recorded take to a valid one-page PDF', async ({ page }) => {
    await gotoAppReady(page);
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled();
    await recordShortTake(page);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
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
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export sheet music' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Generate PDF' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('leaves the piano keyboard alone while the dialog is open', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    const range = page.locator('.piano__range');
    const before = await range.textContent();

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export sheet music' });
    await expect(dialog).toBeVisible();

    // The dialog owns the page keys; the piano behind it must not move.
    await page.keyboard.press('PageUp');
    await page.keyboard.press('ArrowRight');
    await expect(range).toHaveText(before!);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    // The shortcuts come back once the dialog is gone.
    await page.keyboard.press('ArrowRight');
    await expect(range).not.toHaveText(before!);
  });

  test('does not pedal the piano behind the dialog', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
    await expect(page.getByRole('dialog', { name: 'Export sheet music' })).toBeVisible();

    // Space belongs to the dialog's focused button, not to the hidden piano.
    // That activation is why this assertion gets a test of its own: it leaves
    // the dialog in whatever state the button dictates.
    await page.keyboard.down('Space');
    await expect(page.getByRole('button', { name: 'Sustain' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.keyboard.up('Space');
  });

  test('exports the library Moonlight Sonata across multiple pages', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Library' }).click();
    // Moonlight lives in the Classics folder; Originals is what opens by default.
    const folders = page.getByRole('group', { name: 'Library folder' });
    await folders.getByRole('button', { name: 'Classics' }).click();
    await page.getByRole('button', { name: 'Open Moonlight Sonata (1st Movement)' }).click();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
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

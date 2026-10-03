import type { Page } from '@playwright/test';
import { expect, routeSamplePack, test } from './fixtures';
import { gotoAppReady, nav } from './helpers';

const TAKE = {
  schemaVersion: 1,
  id: 'e2e-share-0000-0000-000000000001',
  title: 'Shared scale',
  createdAt: '2026-10-03T10:00:00.000Z',
  updatedAt: '2026-10-03T10:00:00.000Z',
  durationMs: 1400,
  samplePackVersion: 'salamander-grand-v4',
  tempo: { bpm: 96, timeSignature: { numerator: 3, denominator: 4 }, countInBars: 0 },
  instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18, reverbRoom: 'hall' },
  notes: [
    { id: 'u1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
    { id: 'u2', midi: 64, startMs: 500, durationMs: 400, velocity: 0.5 },
    { id: 'u3', midi: 67, startMs: 1000, durationMs: 400, velocity: 0.9 },
  ],
  pedalEvents: [
    { atMs: 0, down: true },
    { atMs: 1300, down: false },
  ],
  display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
};

/** A 600-note performance, whose link runs well past the 2,048 characters of a download link. */
function longTake() {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  let at = 0;
  const notes = Array.from({ length: 600 }, (_, index) => {
    at += Math.floor(random() * 300);
    return {
      id: `p${index}`,
      midi: 40 + Math.floor(random() * 48),
      startMs: at,
      durationMs: 80 + Math.floor(random() * 900),
      velocity: random(),
    };
  });
  return { ...TAKE, id: 'e2e-share-0000-0000-000000000002', title: 'Long evening', notes };
}

const hashOf = (page: Page) => page.evaluate(() => window.location.hash);

/** Import a take from a file on Takes; the inbox opens it on Play. */
async function importTake(page: Page, take: { title: string } = TAKE): Promise<void> {
  await nav(page).getByRole('button', { name: 'Takes' }).click();
  await page.getByLabel('Import take JSON file').setInputFiles({
    name: `PoKeyBoard - ${take.title}.pokeyboard.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(take)),
  });
  await page
    .getByRole('dialog', { name: 'Import take' })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  await expect(page.locator('.play-header__title')).toHaveText(take.title);
}

/** Share → Link… on Play, and the link the dialog shows. */
async function openLinkDialog(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Link…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share as a link' });
  const field = dialog.getByRole('textbox', { name: 'Link to share' });
  await expect(field).toHaveValue(/^http/);
  return { dialog, link: await field.inputValue() };
}

test.describe('share links', () => {
  test('carry a take to a fresh browser, through the import preview, once', async ({
    page,
    browser,
    samplePack,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoAppReady(page);
    await importTake(page);

    const { dialog, link } = await openLinkDialog(page);
    expect(link).toMatch(/\/#\/s\/1\.[A-Za-z0-9_-]+$/);
    expect(new URL(link).origin).toBe(new URL(page.url()).origin);
    await expect(dialog).toContainText('nothing is uploaded');
    await dialog.getByRole('button', { name: 'Copy' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Link copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

    // Another browser altogether: nothing stored, no take of that id.
    const context = await browser.newContext();
    try {
      const fresh = await context.newPage();
      await routeSamplePack(fresh, samplePack);
      await fresh.goto(link);

      const preview = fresh.getByRole('dialog', { name: 'Import take' });
      await expect(preview).toContainText('Shared scale');
      await expect(preview.locator('dt:text-is("Notes") + dd')).toHaveText('3');
      await expect(preview.locator('dt:text-is("Tempo") + dd')).toHaveText('96 BPM · 3/4');
      // Out of the address before anything is imported.
      expect(await hashOf(fresh)).toBe('#/play');

      await preview.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(preview).toHaveCount(0);
      await expect(fresh.locator('.play-header__title')).toHaveText('Shared scale');
      expect(await hashOf(fresh)).toBe('#/play');

      // A reload opens Play, not the link again.
      await fresh.reload();
      await fresh.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
      await expect(fresh.locator('.play-header__title')).toHaveText('Shared scale');
      await expect(fresh.getByRole('dialog', { name: 'Import take' })).toHaveCount(0);
      expect(await hashOf(fresh)).toBe('#/play');
    } finally {
      await context.close();
    }
  });

  test('pasted on Takes open without a download, offering Copy beside Replace', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await importTake(page, longTake());
    const { dialog, link } = await openLinkDialog(page);
    await dialog.getByRole('button', { name: 'Close' }).click();
    // Longer than the field held before share links, and than a download may be.
    expect(link.length).toBeGreaterThan(2_048);

    // A download of the link would be a fetch of the page it points at.
    const linkedPage = link.slice(0, link.indexOf('#'));
    const downloads: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'fetch' && request.url() === linkedPage) {
        downloads.push(request.url());
      }
    });
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('menuitem', { name: 'From a link (URL)' }).click();
    const urlDialog = page.getByRole('dialog', { name: 'Import from a link' });
    const field = urlDialog.getByLabel('File link');
    await field.focus();
    // Typed in, so the field's own length limit applies, as it does to a paste.
    await page.keyboard.insertText(link);
    await expect(field).toHaveValue(link);
    await urlDialog.getByRole('button', { name: 'Import', exact: true }).click();

    const preview = page.getByRole('dialog', { name: 'Import take' });
    await expect(preview).toContainText('Long evening');
    await expect(preview.locator('dt:text-is("Notes") + dd')).toHaveText('600');
    await expect(urlDialog).toHaveCount(0);
    // The same take is already here: a new copy unless Replace is chosen.
    await expect(preview.getByRole('radio', { name: 'Import as a new copy' })).toBeChecked();
    await expect(preview.getByRole('radio', { name: 'Replace the existing take' })).toBeVisible();
    expect(downloads).toEqual([]);
  });

  test('open a Library track by name', async ({ page }) => {
    await page.goto('/#/lib/a-beautiful-day');
    await expect(page.locator('.play-header__title')).toHaveText('A Beautiful Day');
    await expect(page.locator('.play-header__library')).toHaveText('Library');
    expect(await hashOf(page)).toBe('#/play');
  });

  test('give a Library track a link that only names it', async ({ page }) => {
    await page.goto('/#/lib/fur-elise');
    await expect(page.locator('.play-header__title')).toHaveText('Für Elise');

    const { dialog, link } = await openLinkDialog(page);
    expect(link).toMatch(/\/#\/lib\/fur-elise$/);
    await expect(dialog).toContainText('the link only names it');
  });

  test('say why a damaged link would not open', async ({ page }) => {
    await page.goto('/#/s/1.not-a-take');
    const alert = page.getByRole('alertdialog', { name: 'Import take' });
    await expect(alert).toContainText('This link is damaged or incomplete');
    expect(await hashOf(page)).toBe('#/play');

    await alert.getByRole('button', { name: 'Close' }).click();
    await expect(alert).toHaveCount(0);
  });
});

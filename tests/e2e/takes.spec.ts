import { expect, test } from './fixtures';
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

const SCORE_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<score-partwise version="3.1"><part-list>' +
  '<score-part id="P1"><part-name>P1</part-name></score-part></part-list>' +
  '<part id="P1"><measure number="1">' +
  '<attributes><divisions>1</divisions>' +
  '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>' +
  '<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>' +
  '</measure></part></score-partwise>';

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

  test('does not apply a native file-type filter to the MusicXML picker', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    // iOS Files greys out .mxl files when this input has an accept filter,
    // even when the extension and registered MusicXML MIME types are listed.
    await expect(page.getByLabel('Import MusicXML file')).not.toHaveAttribute('accept');
  });

  test('the Import menu opens each file picker', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    const trigger = page.getByRole('button', { name: 'Import', exact: true });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Import options' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Music score (MXL)',
      'Take file (JSON)',
      'From a link (URL)',
    ]);

    // The picker only opens if the item kept user activation through the close.
    const scoreChooser = page.waitForEvent('filechooser');
    await menu.getByRole('menuitem', { name: 'Music score (MXL)' }).click();
    expect(await (await scoreChooser).element().getAttribute('aria-label')).toBe(
      'Import MusicXML file',
    );
    await expect(menu).toHaveCount(0);

    await trigger.click();
    const takeChooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Take file (JSON)' }).click();
    expect(await (await takeChooser).element().getAttribute('aria-label')).toBe(
      'Import take JSON file',
    );
  });

  test('imports a score from a pasted link', async ({ page }) => {
    await gotoAppReady(page);
    // Same-origin, so CORS is out of the picture; the worker is blocked and in
    // any case routes only navigations, /piano/ and /scores/classics-v1/, so
    // this reaches Playwright's interception.
    await page.route('**/fixtures/linked.musicxml', (route) =>
      route.fulfill({ status: 200, contentType: 'application/xml', body: SCORE_XML }),
    );
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('menuitem', { name: 'From a link (URL)' }).click();

    const dialog = page.getByRole('dialog', { name: 'Import from a link' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('File link').fill('http://127.0.0.1:4173/fixtures/linked.musicxml');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();

    const preview = page.getByRole('dialog', { name: 'Import take' });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('linked'); // titled from the link's file name
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    // Lands on Play with the downloaded score active.
    await expect(page.getByRole('heading', { name: 'linked' })).toBeVisible();
  });

  test('a link that cannot be downloaded offers the file picker instead', async ({ page }) => {
    await gotoAppReady(page);
    await page.route('**/fixtures/blocked.mxl', (route) => route.abort('failed'));
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('menuitem', { name: 'From a link (URL)' }).click();

    const dialog = page.getByRole('dialog', { name: 'Import from a link' });
    await dialog.getByLabel('File link').fill('http://127.0.0.1:4173/fixtures/blocked.mxl');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(dialog.getByRole('alert')).toContainText('could not be downloaded');
    // The link stays put so the user can fix a typo instead of retyping.
    await expect(dialog.getByLabel('File link')).toHaveValue(
      'http://127.0.0.1:4173/fixtures/blocked.mxl',
    );

    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Choose a file instead' }).click();
    expect(await (await chooser).element().getAttribute('aria-label')).toBe('Import MusicXML file');
  });

  test('the blocked-link fallback picker still accepts a take JSON', async ({ page }) => {
    await gotoAppReady(page);
    await page.route('**/fixtures/blocked.pokeyboard.json', (route) => route.abort('failed'));
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('menuitem', { name: 'From a link (URL)' }).click();

    const dialog = page.getByRole('dialog', { name: 'Import from a link' });
    await dialog
      .getByLabel('File link')
      .fill('http://127.0.0.1:4173/fixtures/blocked.pokeyboard.json');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('could not be downloaded');
    await dialog.getByRole('button', { name: 'Choose a file instead' }).click();

    // The fallback opens the unfiltered score picker, so a take JSON picked
    // there must not be parsed as MusicXML just because of which input it was.
    await page.getByLabel('Import MusicXML file').setInputFiles({
      name: 'PoKeyBoard - Imported scale.pokeyboard.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(VALID_TAKE)),
    });
    await expect(page.getByRole('dialog', { name: 'Import take' })).toContainText('Imported scale');
  });

  test('rejects a link that is not an http(s) file link', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('menuitem', { name: 'From a link (URL)' }).click();

    const dialog = page.getByRole('dialog', { name: 'Import from a link' });
    // Enter submits the single-field form, so the mouse is never required.
    await dialog.getByLabel('File link').fill('javascript:alert(1)');
    await dialog.getByLabel('File link').press('Enter');

    await expect(dialog.getByRole('alert')).toContainText('not a valid http(s) link');
    await expect(dialog).toBeVisible();
  });

  test('imports a score dropped as a link from another browser window', async ({ page }) => {
    await gotoAppReady(page);
    await page.route('**/fixtures/dropped.musicxml', (route) =>
      route.fulfill({ status: 200, contentType: 'application/xml', body: SCORE_XML }),
    );
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    // Both pages render as `.page`, so wait or the drop lands on Play.
    await expect(page.getByRole('button', { name: 'Backup all takes' })).toBeVisible();

    // A dragged link carries no file — only the text flavours Chrome supplies.
    await page.locator('.page').evaluate((node) => {
      const data = new DataTransfer();
      data.setData('text/uri-list', 'http://127.0.0.1:4173/fixtures/dropped.musicxml');
      data.setData('text/plain', 'http://127.0.0.1:4173/fixtures/dropped.musicxml');
      node.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }));
    });

    const preview = page.getByRole('dialog', { name: 'Import take' });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('dropped');
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'dropped' })).toBeVisible();
  });

  test('ignores dropped text that is not a link', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    await expect(page.getByRole('button', { name: 'Backup all takes' })).toBeVisible();

    await page.locator('.page').evaluate((node) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'just some selected words');
      node.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }));
    });

    // Silence is correct here: no dialog, and no error blaming the user.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('Escape closes the Import menu and returns focus to the trigger', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Import options' })).toBeVisible();

    // Tab into an item, so Escape is about to unmount the focused element.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menuitem', { name: 'Music score (MXL)' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Import options' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
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

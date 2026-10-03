import { expect, test } from './fixtures';
import { gotoAppReady, nav } from './helpers';

const TAKE = {
  schemaVersion: 1,
  id: 'e2e-inbox-0000-0000-000000000001',
  title: 'Unsaved scale',
  createdAt: '2026-10-03T10:00:00.000Z',
  updatedAt: '2026-10-03T10:00:00.000Z',
  durationMs: 1400,
  samplePackVersion: 'salamander-grand-v1',
  tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 0 },
  instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
  notes: [
    { id: 'u1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
    { id: 'u2', midi: 64, startMs: 500, durationMs: 400, velocity: 0.7 },
    { id: 'u3', midi: 67, startMs: 1000, durationMs: 400, velocity: 0.7 },
  ],
  pedalEvents: [],
  display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
};

test.describe('the import inbox', () => {
  test('says why a take it could not store was not imported', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    await page.getByLabel('Import take JSON file').setInputFiles({
      name: 'PoKeyBoard - Unsaved scale.pokeyboard.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(TAKE)),
    });
    const preview = page.getByRole('dialog', { name: 'Import take' });
    await expect(preview).toContainText('Unsaved scale');

    // From here every IndexedDB write throws, as a broken or locked store would.
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = () => {
        throw new DOMException('Writes are off for this test', 'UnknownError');
      };
    });
    await preview.getByRole('button', { name: 'Import', exact: true }).click();

    // The inbox stands over any route, so the reason comes in its own alert
    // rather than on the page underneath.
    const alert = page.getByRole('alertdialog', { name: 'Import take' });
    await expect(alert).toContainText('Saving to this browser failed.');
    await expect(alert.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(alert).toHaveCount(0);

    // Nothing was imported, so nothing moved on to Play.
    await expect(page).toHaveURL(/#\/takes$/);
    await expect(page.getByText('Unsaved scale')).toHaveCount(0);
  });
});

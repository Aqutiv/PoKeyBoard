import { readFileSync, statSync } from 'node:fs';
import { expect, test } from './fixtures';
import { gotoAppReady, nav, persistedSetting, recordShortTake } from './helpers';

const AUDIO_MENU_ITEM = 'Audio (MP3, FLAC)';

test.describe('MP3 export', () => {
  // The suite's guarantee that the real 42-file core pack still decodes and
  // renders audible audio through the wasm encoder: the size and header
  // assertions below fail on a silent or empty render.
  test.use({ samplePack: 'real' });

  for (const piano of ['Salamander', 'Steinway', 'Wurlitzer'])
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
      await page.getByRole('menuitem', { name: AUDIO_MENU_ITEM }).click();
      const dialog = page.getByRole('dialog', { name: 'Export audio' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('radio', { name: /^MP3/ })).toBeChecked();
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
    await page.getByRole('menuitem', { name: AUDIO_MENU_ITEM }).click();
    const dialog = page.getByRole('dialog', { name: 'Export audio' });
    await dialog.getByRole('button', { name: 'Render audio' }).click();
    await expect(dialog.getByText(/Audio ready/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Second export of the identical take hits the cache.
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: AUDIO_MENU_ITEM }).click();
    await dialog.getByRole('button', { name: 'Render audio' }).click();
    await expect(dialog.getByText(/reused cached export/)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('FLAC export', () => {
  test('writes a lossless FLAC the browser decodes, and remembers the choices but not the metronome', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: AUDIO_MENU_ITEM }).click();
    const dialog = page.getByRole('dialog', { name: 'Export audio' });
    await dialog.getByRole('radio', { name: /^FLAC/ }).check();
    await dialog.getByRole('radio', { name: /^Studio — 24-bit/ }).check();
    await dialog.getByRole('radio', { name: /^As played/ }).check();
    await dialog.getByRole('checkbox', { name: 'Include metronome' }).check();
    await dialog.getByRole('button', { name: 'Render audio' }).click();
    await expect(dialog.getByText(/Audio ready/)).toBeVisible({ timeout: 30_000 });
    // FLAC is never cached, so there is nothing to delete.
    await expect(dialog.getByRole('button', { name: 'Delete cached export' })).toHaveCount(0);

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download FLAC' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^PoKeyBoard - .*\(Salamander\)\.flac$/);
    const bytes = readFileSync((await download.path())!);

    // STREAMINFO: 48 kHz, stereo, 24 bits, and how many samples it holds.
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('fLaC');
    const packed = bytes.readUInt32BE(18);
    expect(packed >>> 12).toBe(48_000);
    expect(((packed >>> 9) & 0b111) + 1).toBe(2);
    expect(((packed >>> 4) & 0b11111) + 1).toBe(24);
    const samples = (packed & 0xf) * 2 ** 32 + bytes.readUInt32BE(22);
    // Then the tags, the last metadata block, naming the take.
    expect(bytes[42]).toBe(0x84);
    expect(bytes.toString('utf8', 42, 400)).toContain('TITLE=');

    // Chromium's own FLAC decoder reads every sample back, in both channels,
    // audible and under the −1 dBTP ceiling.
    const decoded = await page.evaluate(async (base64) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const audio = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(data.buffer);
      let peak = 0;
      for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
        for (const sample of audio.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
      }
      return {
        length: audio.length,
        channels: audio.numberOfChannels,
        rate: audio.sampleRate,
        peak,
      };
    }, bytes.toString('base64'));
    expect(decoded).toMatchObject({ length: samples, channels: 2, rate: 48_000 });
    expect(decoded.peak).toBeGreaterThan(0.01);
    expect(decoded.peak).toBeLessThanOrEqual(0.9);

    // Back after a reload: FLAC, Studio and As played, but the metronome off.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => persistedSetting(page, 'audioExportLoudness')).toBe('asPlayed');
    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: AUDIO_MENU_ITEM }).click();
    await expect(dialog.getByRole('radio', { name: /^FLAC/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /^Studio — 24-bit/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /^As played/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Include metronome' })).not.toBeChecked();
  });
});

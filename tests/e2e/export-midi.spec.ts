import { expect, test } from './fixtures';
import { gotoAppReady, nav, recordShortTake } from './helpers';

/** Every note-on in a file: [channel, key]. Enough to see what was played. */
function noteOns(bytes: Buffer): number[][] {
  const out: number[][] = [];
  for (let i = 1; i + 2 < bytes.length; i += 1) {
    const status = bytes[i]!;
    // A note-on straight after a delta time, with a key and a velocity.
    if ((status & 0xf0) === 0x90 && bytes[i + 1]! < 0x80 && bytes[i + 2]! > 0) {
      out.push([status & 0x0f, bytes[i + 1]!]);
    }
  }
  return out;
}

test.describe('MIDI export', () => {
  test('hands over a recorded take as a MIDI file straight from the Share menu', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    // Headless Chromium has no share targets, so this is the download path.
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'MIDI (.mid)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^PoKeyBoard - .*\.mid$/);

    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(filePath!);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('MThd');
    // Format 1, three tracks: tempo, right hand, left hand.
    expect([bytes.readUInt16BE(8), bytes.readUInt16BE(10)]).toEqual([1, 3]);
    // The C4 and E4 the take recorded, both in the right hand.
    expect(noteOns(bytes)).toEqual([
      [0, 60],
      [0, 64],
    ]);
  });

  test('exports a take from its Takes row as well', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    await page.getByRole('button', { name: /More actions for/ }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'MIDI (.mid)' }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/\.mid$/);
  });
});

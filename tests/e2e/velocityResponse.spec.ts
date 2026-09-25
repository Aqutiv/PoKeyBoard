import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, setCountIn, transport } from './helpers';

/**
 * Every note-on in a file as [key, velocity] — the same scan export-midi.spec.ts
 * reads its keys with, keeping the velocity byte too.
 */
function noteOnVelocities(bytes: Buffer): number[][] {
  const out: number[][] = [];
  for (let i = 1; i + 2 < bytes.length; i += 1) {
    const status = bytes[i]!;
    if ((status & 0xf0) === 0x90 && bytes[i + 1]! < 0x80 && bytes[i + 2]! > 0) {
      out.push([bytes[i + 1]!, bytes[i + 2]!]);
    }
  }
  return out;
}

/** One settings row as persisted, read straight out of IndexedDB. */
async function storedSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (settingKey) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(new Error('could not open the database'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('settings').objectStore('settings').get(settingKey);
          request.onerror = () => reject(new Error('could not read the setting'));
          request.onsuccess = () => {
            db.close();
            resolve((request.result as { value?: unknown } | undefined)?.value);
          };
        };
      }),
    key,
  );
}

async function holdKey(page: Page, key: string, ms = 120): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test.describe('velocity response', () => {
  test('Shift accents a computer-keyboard note, through to the exported MIDI', async ({ page }) => {
    await gotoAppReady(page);
    await setCountIn(page, '0');
    await transport(page).getByRole('button', { name: 'Record, inactive' }).click();
    await expect(page.getByText('● Recording')).toBeVisible();
    await holdKey(page, 'KeyA'); // C4
    await page.keyboard.down('Shift');
    await holdKey(page, 'KeyA');
    await page.keyboard.up('Shift');
    await transport(page).getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByText('Saved locally')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'MIDI (.mid)' }).click();
    const filePath = await (await download).path();

    // The fixed velocity, 0.75 of 127, then the accent a fifth of full above it.
    expect(noteOnVelocities(readFileSync(filePath))).toEqual([
      [60, 95],
      [60, 121],
    ]);
  });

  test('keeps the touch sensitivity and the MIDI velocity curve across a reload', async ({
    page,
    context,
  }) => {
    // The MIDI curve is offered once MIDI is on, and turning it on asks for
    // access; granted up front, so no prompt is left hanging.
    await context.grantPermissions(['midi']);
    await page.goto('/#/settings');

    const sensitivity = page.getByRole('radiogroup', { name: 'Touch sensitivity' });
    await expect(sensitivity.getByRole('radio', { name: 'Normal' })).toBeChecked();
    await sensitivity.getByRole('radio', { name: 'Firm' }).check();

    await page.getByRole('checkbox', { name: 'Play with a MIDI keyboard' }).check();
    const curve = page.getByRole('radiogroup', { name: 'MIDI velocity curve' });
    await expect(curve.getByRole('radio', { name: 'Normal' })).toBeChecked();
    await curve.getByRole('radio', { name: 'Heavy' }).check();

    // Settings save on a debounce; reload only once the rows are down.
    await expect.poll(() => storedSetting(page, 'touchSensitivity')).toBe('firm');
    await expect.poll(() => storedSetting(page, 'midiVelocityCurve')).toBe('heavy');

    await page.reload();

    await expect(sensitivity.getByRole('radio', { name: 'Firm' })).toBeChecked();
    await expect(curve.getByRole('radio', { name: 'Heavy' })).toBeChecked();
  });
});

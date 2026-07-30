import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, nav } from './helpers';

function volumeSlider(page: Page) {
  return page.getByRole('slider', { name: 'Piano volume' });
}

function reverbSlider(page: Page) {
  return page.getByRole('slider', { name: 'Reverb' });
}

/**
 * The levels persisted on the *active* take — restoring also imports the
 * backup's own copy of it under a fresh id, so reading every row would not say
 * which one the app is playing. The export renderer reads the levels off the
 * take rather than off the live engine, and the export cache key hashes them,
 * so a restore that only moved the settings row would render a take at levels
 * nobody heard.
 */
async function activeTakeLevels(page: Page): Promise<[number, number] | null> {
  return page.evaluate(
    () =>
      new Promise<[number, number] | null>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(new Error('could not open the database'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['metadata', 'takes']);
          const idRequest = tx.objectStore('metadata').get('lastOpenTakeId');
          idRequest.onerror = () => reject(new Error('could not read the active take id'));
          idRequest.onsuccess = () => {
            const id = (idRequest.result as { value?: string } | undefined)?.value;
            if (!id) {
              db.close();
              resolve(null);
              return;
            }
            const takeRequest = tx.objectStore('takes').get(id);
            takeRequest.onerror = () => reject(new Error('could not read the take'));
            takeRequest.onsuccess = () => {
              const row = takeRequest.result as { takeJson: string } | undefined;
              db.close();
              if (!row) {
                resolve(null);
                return;
              }
              const { instrument } = JSON.parse(row.takeJson) as {
                instrument: { masterVolume: number; reverbMix: number };
              };
              resolve([instrument.masterVolume, instrument.reverbMix]);
            };
          };
        };
      }),
  );
}

test.describe('restoring a backup', () => {
  test('applies the stored levels to the sliders and the take', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Settings' }).click();

    // Levels worth restoring to, well clear of the defaults (0.85 / 0.18).
    await volumeSlider(page).fill('0.2');
    await reverbSlider(page).fill('0.1');
    await expect.poll(() => activeTakeLevels(page)).toEqual([0.2, 0.1]);

    await nav(page).getByRole('button', { name: 'Takes' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Backup all takes' }).click();
    const backup = await (await download).path();
    expect(backup).not.toBeNull();

    // Move both levels somewhere else, so the restore has real work to do.
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await volumeSlider(page).fill('0.9');
    await reverbSlider(page).fill('0.6');
    await expect.poll(() => activeTakeLevels(page)).toEqual([0.9, 0.6]);

    await nav(page).getByRole('button', { name: 'Takes' }).click();
    await page.getByLabel('Restore backup file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: await readFile(backup!),
    });
    await expect(page.getByText(/Backup restored:.*settings applied/)).toBeVisible();

    // Restore writes the settings store with a bare setState, bypassing the
    // setters — so nothing but the persistence subscription carries the levels
    // to the audio engine and back onto the take. The sliders read the take,
    // which makes a stale one visible here.
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await expect(volumeSlider(page)).toHaveValue('0.2');
    await expect(reverbSlider(page)).toHaveValue('0.1');
    await expect.poll(() => activeTakeLevels(page)).toEqual([0.2, 0.1]);
  });

  test('opening a take leaves both its levels adjustable', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Settings' }).click();

    // Give the first take levels of its own, then leave it for a new take set
    // somewhere else, so reopening the first one has to move them back.
    await volumeSlider(page).fill('0.3');
    await reverbSlider(page).fill('0.9');
    await expect.poll(() => activeTakeLevels(page)).toEqual([0.3, 0.9]);

    await nav(page).getByRole('button', { name: 'Takes' }).click();
    const item = page.locator('.take-item').first();
    await item.getByRole('button', { name: /More actions/ }).click();
    await item.getByRole('button', { name: 'Rename' }).click();
    await item.getByLabel('New title').fill('Quiet take');
    await item.getByLabel('New title').press('Enter');

    await page.getByRole('button', { name: 'New take' }).click();
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await volumeSlider(page).fill('0.85');
    await reverbSlider(page).fill('0.2');
    await expect.poll(() => activeTakeLevels(page)).toEqual([0.85, 0.2]);

    await nav(page).getByRole('button', { name: 'Takes' }).click();
    await page.getByRole('button', { name: 'Open Quiet take' }).click();
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await expect(volumeSlider(page)).toHaveValue('0.3');
    await expect(reverbSlider(page)).toHaveValue('0.9');

    // Moving one slider must not drag the other along with it — the settings
    // row is written together, so it has to agree with the reopened take.
    await volumeSlider(page).fill('0.5');
    await expect(reverbSlider(page)).toHaveValue('0.9');
    await expect.poll(() => activeTakeLevels(page)).toEqual([0.5, 0.9]);

    // And a level must be able to return to a value the settings row held
    // earlier, which is not a change unless the row tracked the take.
    await volumeSlider(page).fill('0.85');
    await volumeSlider(page).fill('0.3');
    await expect(reverbSlider(page)).toHaveValue('0.9');
    await expect.poll(() => activeTakeLevels(page)).toEqual([0.3, 0.9]);
  });
});

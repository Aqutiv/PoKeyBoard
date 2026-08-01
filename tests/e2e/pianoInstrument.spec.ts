import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pianoInstrument } from '../../src/audio/instruments';
import { gotoAppReady, nav } from './helpers';

// Read from the registry so a pack-version bump cannot leave these stale.
const SALAMANDER_PACK = pianoInstrument('salamander-grand').packVersion;
const HEADROOM_PACK = pianoInstrument('headroom-grand').packVersion;

const SALAMANDER = /^Salamander/;
const HEADROOM = /^Headroom/;

function pianoRadio(page: Page, name: RegExp) {
  return page.getByRole('radiogroup', { name: 'Piano' }).getByRole('radio', { name });
}

/** Every core sample of the selected pack is decoded. */
function readyKeyboard(page: Page) {
  return page.locator('section[data-piano-ready="true"]');
}

/**
 * Settings saves are debounced, so a reload can outrun them. Read the stored
 * row directly rather than sleeping — the point of the reload is to prove the
 * choice was persisted, not to race the autosave.
 */
async function storedPiano(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      new Promise<string | undefined>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(new Error('could not open the database'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('settings').objectStore('settings').get('pianoInstrument');
          request.onsuccess = () => {
            resolve((request.result as { value?: string } | undefined)?.value);
            db.close();
          };
          request.onerror = () => reject(new Error('could not read the setting'));
        };
      }),
  );
}

/**
 * The pack every stored take names. Playback always uses the *selected* piano,
 * so a take naming a different one would render an export nobody heard — and
 * the export cache keys off exactly this field.
 */
async function storedTakePacks(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(new Error('could not open the database'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('takes').objectStore('takes').getAll();
          request.onsuccess = () => {
            resolve(
              (request.result as Array<{ takeJson: string }>).map(
                (row) =>
                  (JSON.parse(row.takeJson) as { samplePackVersion: string }).samplePackVersion,
              ),
            );
            db.close();
          };
          request.onerror = () => reject(new Error('could not read the takes'));
        };
      }),
  );
}

test.describe('choosing a piano', () => {
  test('switches the live piano and remembers the choice', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await expect(pianoRadio(page, SALAMANDER)).toBeChecked();

    await pianoRadio(page, HEADROOM).check();
    await expect(pianoRadio(page, HEADROOM)).toBeChecked();

    // The switch tears readiness down and the new pack decodes through the real
    // loadManifest → loadCorePack → decodeAudioData path.
    await nav(page).getByRole('button', { name: 'Play' }).click();
    await readyKeyboard(page).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'C4 key' }).click();
    await expect(page.getByRole('button', { name: 'C4 key' })).toBeVisible();

    await expect.poll(() => storedPiano(page)).toBe('headroom-grand');
    await expect.poll(() => storedTakePacks(page)).toEqual([HEADROOM_PACK]);
    await page.reload();
    await readyKeyboard(page).waitFor({ timeout: 30_000 });
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await expect(pianoRadio(page, HEADROOM)).toBeChecked();
  });

  test('resetting settings returns to the default piano and re-stamps the take', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await pianoRadio(page, HEADROOM).check();
    await expect.poll(() => storedTakePacks(page)).toEqual([HEADROOM_PACK]);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Reset settings' }).click();

    await expect(pianoRadio(page, SALAMANDER)).toBeChecked();
    // Reset goes through the store, not the radio handler. The take has to
    // follow the engine anyway, or an export would render on a piano the user
    // never heard — and reuse a cache entry keyed to the other one.
    await expect.poll(() => storedTakePacks(page)).toEqual([SALAMANDER_PACK]);
    await nav(page).getByRole('button', { name: 'Play' }).click();
    await readyKeyboard(page).waitFor({ timeout: 30_000 });
  });

  test('names each piano once, with its own offline download', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Settings' }).click();

    const group = page.getByRole('radiogroup', { name: 'Piano' });

    // One card per piano: the download button names the piano and is sized from
    // that piano's own manifest.
    for (const name of ['Salamander', 'Headroom']) {
      await expect(group.getByRole('radio', { name: new RegExp(`^${name}`) })).toHaveCount(1);
      await expect(
        group.getByRole('button', { name: new RegExp(`^Download ${name} \\(\\d`) }),
      ).toHaveCount(1);
    }

    // The description belongs to the choice, so no second row repeats it.
    await expect(page.getByText('Yamaha C5 concert grand, bright and close')).toHaveCount(1);
    await expect(page.getByText('Yamaha C3 grand, warm and intimate')).toHaveCount(1);
  });
});

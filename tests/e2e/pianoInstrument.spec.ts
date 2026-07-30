import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, nav } from './helpers';

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
    await page.reload();
    await readyKeyboard(page).waitFor({ timeout: 30_000 });
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await expect(pianoRadio(page, HEADROOM)).toBeChecked();
  });

  test('offers each piano its own offline download', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Settings' }).click();

    // Two independent rows, each sized from its own manifest.
    const prompts = page.getByText(/Download the full piano \(/);
    await expect(prompts).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Download piano for offline use' })).toHaveCount(
      2,
    );
  });
});

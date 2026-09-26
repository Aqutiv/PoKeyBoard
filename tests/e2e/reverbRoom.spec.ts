import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, nav, recordShortTake } from './helpers';

function roomSelect(page: Page) {
  return page.getByRole('combobox', { name: 'Reverb room' });
}

/**
 * What is stored for the room: the settings row, and the copy on the active
 * take, which the export renders from and which reopening the take restores.
 */
async function storedRooms(page: Page): Promise<{ setting?: string; take?: string }> {
  return page.evaluate(
    () =>
      new Promise<{ setting?: string; take?: string }>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(new Error('could not open the database'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['settings', 'metadata', 'takes']);
          const found: { setting?: string; take?: string } = {};
          const setting = tx.objectStore('settings').get('reverbRoom');
          setting.onsuccess = () => {
            found.setting = (setting.result as { value?: string } | undefined)?.value;
          };
          const idRequest = tx.objectStore('metadata').get('lastOpenTakeId');
          idRequest.onsuccess = () => {
            const id = (idRequest.result as { value?: string } | undefined)?.value;
            if (!id) return;
            const takeRequest = tx.objectStore('takes').get(id);
            takeRequest.onsuccess = () => {
              const row = takeRequest.result as { takeJson: string } | undefined;
              if (!row) return;
              const { instrument } = JSON.parse(row.takeJson) as {
                instrument: { reverbRoom?: string };
              };
              found.take = instrument.reverbRoom;
            };
          };
          tx.oncomplete = () => {
            db.close();
            resolve(found);
          };
          tx.onerror = () => reject(new Error('could not read the stored rooms'));
        };
      }),
  );
}

test.describe('reverb room', () => {
  test('keeps the chosen room through a reload, and writes it into the take', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await expect(roomSelect(page)).toHaveValue('room');
    await roomSelect(page).selectOption('hall');
    await expect(roomSelect(page)).toHaveValue('hall');
    // Both copies are written on a debounce; a reload must not outrun them.
    await expect.poll(() => storedRooms(page)).toEqual({ setting: 'hall', take: 'hall' });

    // Reloaded where it was, on Settings: the select reads the restored take.
    await page.reload();
    await expect(roomSelect(page)).toHaveValue('hall', { timeout: 15_000 });

    await nav(page).getByRole('button', { name: 'Takes' }).click();
    const item = page.locator('.take-item').first();
    await item.getByRole('button', { name: /More actions/ }).click();
    const download = page.waitForEvent('download');
    await item.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const file = await (await download).path();
    const exported = JSON.parse(await readFile(file, 'utf8')) as {
      instrument: { reverbRoom?: string };
    };
    expect(exported.instrument.reverbRoom).toBe('hall');
  });
});

import { expect, test } from './fixtures';
import { gotoAppReady, nav, recordShortTake, transport } from './helpers';
import type { TakeRow } from '../../src/data/db';

test.use({ viewport: { width: 1440, height: 900 } });

for (const origin of ['Play', 'Settings']) {
  test(`piano switching from ${origin} pauses playback and locks transport across navigation`, async ({
    page,
  }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Open Where Starlight Lingers' }).click();
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/headroom-grand-v2/*.sample', async (route) => {
      await gate;
      await route.continue();
    });
    try {
      if (origin === 'Settings') {
        await nav(page).getByRole('button', { name: 'Settings' }).click();
        await page.getByRole('radio', { name: /^Headroom/ }).check();
        await nav(page).getByRole('button', { name: 'Play', exact: true }).click();
      } else {
        await page
          .getByRole('combobox', { name: 'Piano', exact: true })
          .selectOption('headroom-grand');
      }
      await expect(page.getByRole('combobox', { name: 'Piano', exact: true })).toBeDisabled();
      await expect(
        transport(page).getByRole('button', { name: 'Play', exact: true }),
      ).toBeDisabled();
      await expect(
        transport(page).getByRole('button', { name: 'Record, inactive' }),
      ).toBeDisabled();
      const position = await page.locator('.transport__time').innerText();
      await page.waitForTimeout(250);
      await expect(page.locator('.transport__time')).toHaveText(position);
      await nav(page).getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('radio', { name: /^Salamander/ })).toBeDisabled();
      const bar = page.getByRole('complementary', { name: 'Now playing' });
      await expect(bar.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
      release();
      await expect(bar.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
      await bar.getByRole('button', { name: 'Resume', exact: true }).click();
      await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await bar.getByRole('button', { name: 'Now playing: Where Starlight Lingers' }).click();
      await expect(page.locator('.transport__time')).not.toHaveText(position);
    } finally {
      release();
    }
  });
}

for (const width of [1440, 390]) {
  test(`Now playing remains reachable throughout a long Takes list at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoAppReady(page);
    await recordShortTake(page);
    // Seed a genuinely overflowing list in this test's isolated browser database.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('pokeyboard');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('takes', 'readwrite');
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
            const store = tx.objectStore('takes');
            const rows = store.getAll();
            rows.onsuccess = () => {
              const template = (rows.result as TakeRow[])[0]!;
              for (let i = 0; i < 40; i += 1) {
                const id = `scroll-test-${i}`;
                const title = `Scrolling take ${i}`;
                store.put({
                  ...template,
                  id,
                  title,
                  takeJson: JSON.stringify({ ...JSON.parse(template.takeJson), id, title }),
                });
              }
            };
          };
        }),
    );
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Open Where Starlight Lingers' }).click();
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    await nav(page).getByRole('button', { name: 'Takes', exact: true }).click();
    await expect(page.locator('.take-item')).toHaveCount(41);
    const bar = page.getByRole('complementary', { name: 'Now playing' });
    const before = await bar.boundingBox();
    await page.locator('.take-item').last().scrollIntoViewIfNeeded();
    expect(
      await page.locator('.app-shell__viewport').evaluate((el) => el.scrollTop),
    ).toBeGreaterThan(500);
    const after = await bar.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(after!.y + after!.height).toBeLessThanOrEqual(900);
    await bar.getByRole('button', { name: 'Pause', exact: true }).click();
    await bar.getByRole('button', { name: 'Resume', exact: true }).click();
    await bar.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(bar).toHaveCount(0);
  });
}

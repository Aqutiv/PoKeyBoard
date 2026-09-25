import { expect, test } from './fixtures';
import { gotoAppReady, nav, transport } from './helpers';

// A phone's key bed, about nine white keys from C3: Für Elise opens on the
// E above the treble staff, well off the top of it.
test.use({ viewport: { width: 390, height: 844 } });

async function openFurElise(page: import('@playwright/test').Page): Promise<void> {
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Classics', exact: true }).click();
  await page.getByRole('button', { name: 'Open Für Elise', exact: true }).click();
  await expect(page.locator('.play-header__title')).toHaveText('Für Elise');
}

test.describe('the keyboard during playback', () => {
  test('lights the take’s keys and follows them up the keyboard', async ({ page }) => {
    await gotoAppReady(page);
    await openFurElise(page);
    const range = page.locator('.piano__range');
    const before = await range.textContent();

    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    // The bed slides up to the melody, and the melody lights on it.
    await expect(range).not.toHaveText(before ?? '', { timeout: 5_000 });
    await expect(page.locator('.piano-key[data-playback]').first()).toBeVisible({
      timeout: 5_000,
    });

    await transport(page).getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('.piano-key[data-playback]')).toHaveCount(0);
  });

  test('stays put when told to, and marks the edge the music is past', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('checkbox', { name: 'Keyboard follows playback' }).uncheck();
    await openFurElise(page);
    const range = page.locator('.piano__range');
    const before = await range.textContent();

    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.piano__keys[data-offscreen-high]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(range).toHaveText(before ?? '');
  });
});

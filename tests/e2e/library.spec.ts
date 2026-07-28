import { expect, test, type Page } from '@playwright/test';

/** The folder switch (its option names would otherwise clash with track titles). */
function folders(page: Page) {
  return page.getByRole('group', { name: 'Library folder' });
}

function trackButtons(page: Page) {
  return page.getByRole('button', { name: /^Open / });
}

async function gotoLibrary(page: Page): Promise<void> {
  await page.goto('/#/library');
  await expect(folders(page)).toBeVisible();
}

test.describe('library folders', () => {
  test('opens on Originals and shelves the classics separately', async ({ page }) => {
    await gotoLibrary(page);
    await expect(folders(page).getByRole('button', { name: 'Originals' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(trackButtons(page)).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Open A Beautiful Day' })).toBeVisible();

    await folders(page).getByRole('button', { name: 'Classics' }).click();
    await expect(trackButtons(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Open Für Elise' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open A Beautiful Day' })).toHaveCount(0);
  });

  test('restores the folder last opened after a reload', async ({ page }) => {
    await gotoLibrary(page);
    await folders(page).getByRole('button', { name: 'Classics' }).click();
    // The settings writer debounces 500 ms; a reload inside that window would
    // race the write rather than test the restore.
    await page.waitForTimeout(900);

    await page.reload();
    await expect(folders(page).getByRole('button', { name: 'Classics' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(trackButtons(page)).toHaveCount(3);
  });

  test('opens a classic on Play as an unmodifiable library take', async ({ page }) => {
    await gotoLibrary(page);
    await folders(page).getByRole('button', { name: 'Classics' }).click();
    await page.getByRole('button', { name: 'Open Für Elise' }).click();

    await expect(page.locator('.play-header__title')).toHaveText('Für Elise');
    await expect(page.locator('.play-header__library')).toHaveText('Library');
  });
});

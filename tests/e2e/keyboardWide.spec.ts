import { expect, test } from '@playwright/test';
import { gotoAppReady } from './helpers';

test.describe('full piano on a 4K viewport', () => {
  test.use({ viewport: { width: 3840, height: 2160 } });

  test('shows all 88 keys and disables range shifting', async ({ page }) => {
    await gotoAppReady(page);
    await expect(page.getByRole('button', { name: 'A0 key' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'C8 key' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Shift keyboard range down one octave' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Shift keyboard range up one octave' }),
    ).toBeDisabled();
  });
});

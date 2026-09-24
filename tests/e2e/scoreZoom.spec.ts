import { expect, test } from './fixtures';
import { gotoAppReady, recordShortTake } from './helpers';

test.describe('score zoom', () => {
  test('zooms to its limits and keeps the zoom with the take', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });

    // A quarter a step, 100% to 400%: seven steps reach the top.
    for (let i = 0; i < 7; i += 1) await zoomIn.click();
    await expect(zoomIn).toBeDisabled();
    await expect(zoomOut).toBeEnabled();

    // Kept with the take, like the playhead: saved once the 800 ms autosave
    // has had its turn.
    await page.waitForTimeout(1_500);
    await expect(page.getByText('Saved locally')).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });
});

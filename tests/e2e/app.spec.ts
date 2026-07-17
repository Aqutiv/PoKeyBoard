import { expect, test } from '@playwright/test';
import { gotoAppReady, nav, transport } from './helpers';

test.describe('app shell and piano', () => {
  test('loads the shell with nav, transport, and keyboard', async ({ page }) => {
    await gotoAppReady(page);
    await expect(nav(page)).toBeVisible();
    await expect(transport(page).getByRole('button', { name: 'Record, inactive' })).toBeVisible();
    await expect(transport(page).getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(page.getByRole('img', { name: /Grand staff score/ })).toBeVisible();
    // A full default keyboard range is present.
    await expect(page.getByRole('button', { name: 'C3 key' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'B4 key' })).toBeVisible();
  });

  test('mouse press lights a key while held', async ({ page }) => {
    await gotoAppReady(page);
    const key = page.getByRole('button', { name: 'C4 key' });
    const box = await key.boundingBox();
    expect(box).not.toBeNull();
    // Press low on the key (below the black-key band).
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * 0.85);
    await page.mouse.down();
    await expect(key).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.up();
    await expect(key).toHaveAttribute('aria-pressed', 'false');
  });

  test('computer keyboard plays notes', async ({ page }) => {
    await gotoAppReady(page);
    const c4 = page.getByRole('button', { name: 'C4 key' });
    await page.keyboard.down('KeyA');
    await expect(c4).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.up('KeyA');
    await expect(c4).toHaveAttribute('aria-pressed', 'false');
  });

  test('sustain control latches', async ({ page }) => {
    await gotoAppReady(page);
    const sustain = page.getByRole('button', { name: 'Sustain' });
    await sustain.click();
    await expect(sustain).toHaveAttribute('aria-pressed', 'true');
    await sustain.click();
    await expect(sustain).toHaveAttribute('aria-pressed', 'false');
  });

  test('service worker activates and the shell loads offline', async ({ page, context }) => {
    await gotoAppReady(page);
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
      timeout: 15_000,
    });
    await context.setOffline(true);
    await page.reload();
    await expect(nav(page)).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });
});

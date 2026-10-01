import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, nav, persistedSetting } from './helpers';

/**
 * Hold C4 with the mouse at `depth` of its height — near the top plays soft,
 * near the front loud — and report how the key is lit while it is held.
 */
async function pressC4At(page: Page, depth: number) {
  const key = page.getByRole('button', { name: 'C4 key' });
  const box = await key.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * depth);
  await page.mouse.down();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  const lit = await key.evaluate((element) => ({
    shade: element.style.getPropertyValue('--live-shade'),
    background: getComputedStyle(element).backgroundImage,
  }));
  await page.mouse.up();
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  return lit;
}

async function playPageKeys(page: Page): Promise<void> {
  await nav(page).getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'C4 key' })).toBeVisible();
}

test.describe('velocity shading on keys', () => {
  test('lights a soft press paler than a hard one until switched off, and remembers it', async ({
    page,
  }) => {
    await gotoAppReady(page);

    // On by default: the touch position sets the velocity, and the shade follows it.
    const soft = await pressC4At(page, 0.1);
    const hard = await pressC4At(page, 0.95);
    expect(parseFloat(soft.shade)).toBeLessThan(parseFloat(hard.shade));
    expect(soft.background).toContain('gradient');
    expect(hard.background).toContain('gradient');
    expect(soft.background).not.toBe(hard.background);

    await nav(page).getByRole('button', { name: 'Settings' }).click();
    const toggle = page.getByRole('checkbox', {
      name: 'Velocity shading on keys and falling notes',
    });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    // Settings save on a debounce; the reload below waits for the row.
    await expect.poll(() => persistedSetting(page, 'velocityShading')).toBe(false);

    // Off: the same two presses light the key alike.
    await playPageKeys(page);
    const evenSoft = await pressC4At(page, 0.1);
    const evenHard = await pressC4At(page, 0.95);
    expect(evenSoft).toEqual(evenHard);
    expect(evenSoft.background).toContain('gradient');

    // And still after a reload.
    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    expect(await pressC4At(page, 0.1)).toEqual(evenHard);
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await expect(
      page.getByRole('checkbox', { name: 'Velocity shading on keys and falling notes' }),
    ).not.toBeChecked();
  });
});

import { expect, test } from './fixtures';
import { gotoAppReady, nav, transport } from './helpers';

/** The playhead readout, in seconds: "0:02.4 / 1:02.0" → 2.4. */
async function playheadSeconds(page: import('@playwright/test').Page): Promise<number> {
  const text = (await page.locator('.transport__time').textContent()) ?? '';
  const [minutes, seconds] = (text.split('/')[0] ?? '').trim().split(':');
  return Number(minutes) * 60 + Number(seconds);
}

test.describe('practice playback', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Classics', exact: true }).click();
    await page.getByRole('button', { name: 'Open Für Elise', exact: true }).click();
    await expect(page.locator('.play-header__title')).toHaveText('Für Elise');
  });

  test('plays at the speed chosen', async ({ page }) => {
    await page.getByRole('button', { name: 'Playback speed: 100%' }).click();
    await page.getByRole('menuitemradio', { name: '50%', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Playback speed: 50%' })).toBeVisible();

    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(2_000);
    await transport(page).getByRole('button', { name: 'Pause', exact: true }).click();
    // Two seconds at half speed is about one second of the take.
    const reached = await playheadSeconds(page);
    expect(reached).toBeGreaterThan(0.6);
    expect(reached).toBeLessThan(1.4);
  });

  test('repeats the passage marked A to B', async ({ page }) => {
    const loop = page.locator('.transport__loop');
    await expect(loop).toHaveAccessibleName('Loop a passage: mark where it starts');
    await loop.click(); // A at the top
    // B two seconds in: seek there, then mark it.
    await page.getByRole('slider', { name: 'Seek position' }).fill('2000');
    await expect(loop).toHaveAccessibleName('Loop from 0:00.0: mark where it ends');
    await loop.click();
    await expect(loop).toHaveAttribute('aria-pressed', 'true');
    await expect(loop).toHaveAccessibleName(/^Stop looping 0:00\.0–0:0[12]\.\d$/);

    // Past the end it starts from the top, and round again rather than on.
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    let furthest = 0;
    for (let i = 0; i < 12; i += 1) {
      await page.waitForTimeout(300);
      furthest = Math.max(furthest, await playheadSeconds(page));
    }
    expect(furthest).toBeLessThan(2.1);
    await expect(transport(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

    // A third tap lets it go.
    await loop.click();
    await expect(loop).toHaveAttribute('aria-pressed', 'false');
  });
});

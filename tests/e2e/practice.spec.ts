import { expect, test } from './fixtures';
import { gotoAppReady, nav, transport } from './helpers';

/** A time as the transport writes it, in seconds: "0:02.4" → 2.4. */
function readoutSeconds(readout: string): number {
  const [minutes, seconds] = readout.trim().split(':');
  return Number(minutes) * 60 + Number(seconds);
}

/** The playhead readout, in seconds: "0:02.4 / 1:02.0" → 2.4. */
async function playheadSeconds(page: import('@playwright/test').Page): Promise<number> {
  const text = (await page.locator('.transport__time').textContent()) ?? '';
  return readoutSeconds(text.split('/')[0] ?? '');
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
    // B lands on the beat nearest the seek, so take the end from the button.
    const end = readoutSeconds((await loop.getAttribute('aria-label'))?.split('–')[1] ?? '');

    // Past the end it starts from the top, and round again rather than on.
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    let last = await playheadSeconds(page);
    let furthest = last;
    let wentBack = false;
    for (let i = 0; i < 12; i += 1) {
      await page.waitForTimeout(300);
      const now = await playheadSeconds(page);
      furthest = Math.max(furthest, now);
      wentBack ||= now < last;
      last = now;
    }
    // 3.6 s of samples is more than a pass, so it must be seen going round.
    expect(wentBack).toBe(true);
    // And never on past B. The playhead can read B itself just before going
    // round, or a tenth more: the readout rounds to the nearest tenth where
    // the button's label cuts down to one. Counted in whole tenths, so adding
    // them up is exact.
    expect(Math.round(furthest * 10)).toBeLessThanOrEqual(Math.round(end * 10) + 1);
    await expect(transport(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

    // A third tap lets it go.
    await loop.click();
    await expect(loop).toHaveAttribute('aria-pressed', 'false');
  });
});

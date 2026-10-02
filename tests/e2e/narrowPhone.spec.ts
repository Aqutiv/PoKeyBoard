import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  gotoAppReady,
  openSettings,
  recordShortTake,
  settingsSections,
  transport,
} from './helpers';

/**
 * The app shell hides horizontal overflow, so a control row that outgrows its
 * width loses whatever sits at its right edge with nothing to scroll it back
 * into view. Every row therefore has to either fit or wrap.
 */
async function clippedControls(page: Page, target: string | Locator): Promise<string[]> {
  const locator = typeof target === 'string' ? page.locator(target) : target;
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return (
      [...element.children]
        .map((child) => ({ child, rect: child.getBoundingClientRect() }))
        // A collapsed control (the metronome's disclosure panel) has no box at
        // all, and an all-zero rect would read as being off to the left.
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .filter(({ rect }) => rect.right > box.right + 0.5 || rect.left < box.left - 0.5)
        .map(({ child }) => child.getAttribute('aria-label') ?? child.className)
    );
  });
}

/** How many lines the row's visible children actually occupy. */
async function rowCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => {
    const centers = [...element.children]
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      // align-items: center puts everything on a line at the same center.
      .map((rect) => Math.round(rect.top + rect.height / 2));
    return new Set(centers).size;
  });
}

const ROWS = ['.play-header', '.transport__buttons', '.metronome', '.piano__controls', '.app-nav'];

/** The header row stays one line, the view switch in it included. */
const MAX_HEADER_PX = 40;

test.describe('narrow portrait phone', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('wraps rather than clipping any control row', async ({ page }) => {
    await gotoAppReady(page);
    // Soft, so one clipped row does not hide the others.
    for (const selector of ROWS) {
      expect.soft(await clippedControls(page, selector), selector).toEqual([]);
    }
    const header = await page.locator('.play-header').boundingBox();
    expect(header?.height).toBeLessThanOrEqual(MAX_HEADER_PX);
  });

  test('keeps the two Library folder labels at full size', async ({ page }) => {
    // Two segments have room here, so the folders skip the type step-down
    // that Learn's levels and Settings' sections take.
    await gotoAppReady(page);
    await page.goto('/#/library');
    const folders = page.getByRole('group', { name: 'Library folder' });
    await expect(folders).toBeVisible();
    expect(await clippedControls(page, folders)).toEqual([]);
    const sizes = await folders
      .getByRole('button')
      .evaluateAll((options) => options.map((option) => getComputedStyle(option).fontSize));
    expect(sizes).toEqual(['14px', '14px']);
  });

  test('keeps the three Learn level labels inside their segments', async ({ page }) => {
    // Three segments share ~92px each here, and "Intermediate" needs ~88px at
    // the full 14px — hence the type step-down, with ellipsis behind it.
    await gotoAppReady(page);
    await page.goto('/#/learn');
    const levels = page.getByRole('group', { name: 'Learn level' });
    await expect(levels).toBeVisible();
    expect(await clippedControls(page, levels)).toEqual([]);
  });

  test('keeps the four Settings section labels inside their segments', async ({ page }) => {
    // Four segments share ~69px each here, ~57px of it for text — the same
    // type step-down as Learn's levels, with ellipsis behind it.
    await gotoAppReady(page);
    await openSettings(page);
    await expect(settingsSections(page)).toBeVisible();
    expect(await clippedControls(page, settingsSections(page))).toEqual([]);
    const truncated = await settingsSections(page)
      .getByRole('button')
      .evaluateAll((options) =>
        options
          .filter((option) => option.scrollWidth > option.clientWidth + 0.5)
          .map((option) => option.textContent ?? ''),
      );
    expect(truncated).toEqual([]);
  });

  test('wraps the Settings choices beneath their names rather than clipping them', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await openSettings(page, 'Playing');
    for (const name of ['Velocity', 'Touch sensitivity']) {
      const choice = page.getByRole('radiogroup', { name, exact: true });
      expect.soft(await clippedControls(page, choice), name).toEqual([]);
      expect
        .soft(await clippedControls(page, choice.locator('.choice-switch')), `${name} segments`)
        .toEqual([]);
    }
  });

  test('keeps every nav label inside its own tab', async ({ page }) => {
    // Six tabs leave ~52px each here, which is narrower than the longest label
    // in some locales — the labels ellipsis rather than push each other out.
    await gotoAppReady(page);
    const overflowing = await page
      .locator('.app-nav')
      .evaluate((navBar) =>
        [...navBar.children]
          .filter((item) => item.scrollWidth > item.clientWidth + 0.5)
          .map((item) => item.textContent ?? ''),
      );
    expect(overflowing).toEqual([]);
  });
});

test.describe('portrait phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the transport and keyboard controls to one row each', async ({ page }) => {
    await gotoAppReady(page);
    // The whole point of dropping the total duration and narrowing the shift
    // buttons: these rows cost the score a line each when they wrap.
    expect(await rowCount(page, '.transport__buttons')).toBe(1);
    expect(await rowCount(page, '.piano__controls')).toBe(1);
    expect(await rowCount(page, '.metronome')).toBe(1);
    const header = await page.locator('.play-header').boundingBox();
    expect(header?.height).toBeLessThanOrEqual(MAX_HEADER_PX);
  });

  test('does not clip the transport row once Undo joins it', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    await expect(
      transport(page).getByRole('button', { name: 'Undo last recording pass' }),
    ).toBeVisible();
    expect(await clippedControls(page, '.transport__buttons')).toEqual([]);
  });
});

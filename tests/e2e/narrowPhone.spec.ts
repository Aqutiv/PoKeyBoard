import { expect, test, type Page } from '@playwright/test';
import { gotoAppReady, recordShortTake, transport } from './helpers';

/**
 * The app shell hides horizontal overflow, so a control row that outgrows its
 * width loses whatever sits at its right edge with nothing to scroll it back
 * into view. Every row therefore has to either fit or wrap.
 */
async function clippedControls(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((element) => {
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

const ROWS = ['.transport__buttons', '.metronome', '.piano__controls', '.app-nav'];

test.describe('narrow portrait phone', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('wraps rather than clipping any control row', async ({ page }) => {
    await gotoAppReady(page);
    // Soft, so one clipped row does not hide the others.
    for (const selector of ROWS) {
      expect.soft(await clippedControls(page, selector), selector).toEqual([]);
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

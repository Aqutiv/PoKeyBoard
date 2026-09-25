import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, recordShortTake, transportTime } from './helpers';

/**
 * Real touches, through Chromium's own input pipeline: each call lists every
 * finger still down, and the browser turns the difference into pointer events.
 */
async function touchScreen(page: Page) {
  const client = await page.context().newCDPSession(page);
  const box = await page.locator('.score__canvas').boundingBox();
  if (!box) throw new Error('score not laid out');
  const y = box.y + box.height / 2;
  const middle = box.x + box.width / 2;
  return {
    middle,
    touch: (type: 'touchStart' | 'touchMove' | 'touchEnd', xs: readonly number[]) =>
      client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: xs.map((x, id) => ({ x, y, id })),
      }),
  };
}

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

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    test('zooms with two fingers, and the first finger’s scrub never counts', async ({ page }) => {
      await gotoAppReady(page);
      await recordShortTake(page);
      const before = await transportTime(page).textContent();
      const { middle, touch } = await touchScreen(page);

      // One finger scrubs: dragged right and let go, back to the take's start.
      // (The readout follows once the scrub ends.)
      await touch('touchStart', [middle]);
      await touch('touchMove', [middle + 60]);
      await touch('touchEnd', []);
      await expect(transportTime(page)).not.toHaveText(before ?? '');
      const scrubbedTo = await transportTime(page).textContent();

      // A finger dragging the other way, as if to scrub on, then a second: the
      // pinch undoes that scrub, and the zoom follows the fingers apart, well
      // past the top of the range.
      await touch('touchStart', [middle]);
      await touch('touchMove', [middle - 60]);
      await touch('touchStart', [middle - 60, middle - 20]);
      for (let step = 1; step <= 8; step += 1) {
        await touch('touchMove', [middle - 60 - step * 40, middle - 20 + step * 40]);
      }
      await touch('touchEnd', []);

      await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
      await expect(transportTime(page)).toHaveText(scrubbedTo ?? '');
    });

    test('zooms back out with two fingers closing', async ({ page }) => {
      await gotoAppReady(page);
      await recordShortTake(page);
      const { middle, touch } = await touchScreen(page);
      await touch('touchStart', [middle - 300, middle + 300]);
      for (let step = 1; step <= 7; step += 1) {
        await touch('touchMove', [middle - 300 + step * 40, middle + 300 - step * 40]);
      }
      await touch('touchEnd', []);
      await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    });
  });

  test('follows Safari’s own trackpad pinch, and keeps the page from zooming', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    // Safari sends a trackpad pinch as gesture events carrying a scale.
    const prevented = await page.locator('.score__canvas').evaluate((canvas) => {
      const { left, width } = canvas.getBoundingClientRect();
      const fire = (type: string, scale: number) => {
        const event = Object.assign(new Event(type, { cancelable: true }), {
          scale,
          clientX: left + width / 2,
        });
        canvas.dispatchEvent(event);
        return event.defaultPrevented;
      };
      return [
        fire('gesturestart', 1),
        fire('gesturechange', 1.5),
        fire('gesturechange', 6),
        fire('gestureend', 6),
      ];
    });
    expect(prevented).toEqual([true, true, true, true]);
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });
});

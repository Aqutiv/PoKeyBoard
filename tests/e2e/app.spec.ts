import { expect, test } from './fixtures';
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

  test('suppresses the native touch gesture on the piano key bed', async ({ page }) => {
    await gotoAppReady(page);
    const defaultPrevented = await page.locator('.piano__keys').evaluate((element) => {
      const event = new Event('touchstart', { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(defaultPrevented).toBe(true);
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

  test('range shifts by a single white key or by a whole octave', async ({ page }) => {
    await gotoAppReady(page);
    const range = page.locator('.piano__range');
    const upKey = page.getByRole('button', { name: 'Shift keyboard range up one key' });
    const downKey = page.getByRole('button', { name: 'Shift keyboard range down one key' });
    const upOctave = page.getByRole('button', { name: 'Shift keyboard range up one octave' });

    // The high end depends on how many keys the viewport fits, so assert the
    // anchor the buttons actually move.
    await expect(range).toHaveText(/^C3\s/);
    // Single steps walk white keys, stepping over C#3 and D#3.
    await upKey.click();
    await expect(range).toHaveText(/^D3\s/);
    // The bed moved past C#3 rather than onto it, and D#3 came along.
    await expect(page.getByRole('button', { name: 'C#3 key' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'D#3 key' })).toBeVisible();
    await upKey.click();
    await expect(range).toHaveText(/^E3\s/);

    await upOctave.click();
    await expect(range).toHaveText(/^E4\s/);
    await downKey.click();
    await expect(range).toHaveText(/^D4\s/);
  });
});

// The offline-shell test lives in serviceWorker.spec.ts: it needs the real
// worker, and a real install cannot be timed reliably from inside the parallel
// pool.

test.describe('compact landscape play view', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('switches between notation and keyboard and remembers the selection on rotation', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });

    const viewSwitch = page.getByRole('group', { name: 'View' });
    const score = page.getByRole('img', { name: /Grand staff score/ });
    const keyboard = page.getByRole('button', { name: 'C4 key' });
    const metronome = page.getByRole('group', { name: 'Metronome' });

    await expect(viewSwitch).toBeVisible();
    await expect(viewSwitch.getByRole('button', { name: 'Notation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(score).toBeVisible();
    await expect(keyboard).toBeHidden();
    await expect(metronome).toBeHidden();

    await viewSwitch.getByRole('button', { name: 'Keyboard' }).click();
    await expect(score).toBeHidden();
    await expect(keyboard).toBeVisible();
    await expect(metronome).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(viewSwitch).toBeHidden();
    await expect(score).toBeVisible();
    await expect(keyboard).toBeVisible();
    await expect(metronome).toBeVisible();

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(viewSwitch).toBeVisible();
    await expect(score).toBeHidden();
    await expect(keyboard).toBeVisible();
    await expect(metronome).toBeVisible();

    await viewSwitch.getByRole('button', { name: 'Notation' }).click();
    await expect(score).toBeVisible();
    await expect(keyboard).toBeHidden();
    await expect(metronome).toBeHidden();
  });
});

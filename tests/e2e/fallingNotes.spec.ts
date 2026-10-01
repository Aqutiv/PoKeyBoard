import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, persistedSetting, setCountIn, transport, transportTime } from './helpers';

function viewSwitch(page: Page) {
  return page.getByRole('group', { name: 'View' });
}

async function showFallingNotes(page: Page): Promise<void> {
  await viewSwitch(page).getByRole('button', { name: 'Falling notes' }).click();
  await expect(page.getByRole('img', { name: /^Falling notes/ })).toBeVisible();
}

/** Record C4 and then C♯4, a white key and a black, and go back to the start. */
async function recordWhiteAndBlack(page: Page): Promise<void> {
  await setCountIn(page, '0');
  await transport(page).getByRole('button', { name: 'Record, inactive' }).click();
  await expect(page.getByText('● Recording')).toBeVisible();
  for (const key of ['KeyA', 'KeyW']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(250);
    await page.keyboard.up(key);
  }
  await transport(page).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('● Recording')).toHaveCount(0);
  await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
}

interface Run {
  left: number;
  right: number;
}

/**
 * Every stretch along a row of the canvas where a bar is drawn, in CSS pixels
 * from its left edge: pixels clearly apart from the dark stage, which the
 * faint octave guides are not. Read row by row, because a black key's bar
 * overlaps its white neighbour's columns at another height.
 */
async function barRuns(page: Page): Promise<Run[]> {
  return page.locator('.waterfall__canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const { width, height } = canvas;
    const scale = width / canvas.getBoundingClientRect().width;
    const data = ctx.getImageData(0, 0, width, height).data;
    const [r0, g0, b0] = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
    const runs: Array<{ left: number; right: number }> = [];
    for (let y = 0; y < height; y += 2) {
      let start = -1;
      for (let x = 0; x <= width; x += 1) {
        const i = (y * width + x) * 4;
        const inked =
          x < width &&
          Math.abs((data[i] ?? 0) - r0) +
            Math.abs((data[i + 1] ?? 0) - g0) +
            Math.abs((data[i + 2] ?? 0) - b0) >
            90;
        if (inked && start < 0) start = x;
        if (!inked && start >= 0) {
          if (x - start >= 3) runs.push({ left: start / scale, right: x / scale });
          start = -1;
        }
      }
    }
    return runs;
  });
}

/** Each key's span across the canvas, in CSS pixels from the canvas's left edge. */
async function keySpan(page: Page, note: string): Promise<Run> {
  const canvas = await page.locator('.waterfall__canvas').boundingBox();
  const key = await page.getByRole('button', { name: `${note} key` }).boundingBox();
  if (!canvas || !key) throw new Error(`no box for ${note}`);
  return { left: key.x - canvas.x, right: key.x + key.width - canvas.x };
}

async function expectBarsOverKeys(page: Page, notes: string[]): Promise<void> {
  const keys = await Promise.all(notes.map((note) => keySpan(page, note)));
  await expect
    .poll(async () => {
      const runs = await barRuns(page);
      return keys.every((key) => {
        const centre = (key.left + key.right) / 2;
        const width = key.right - key.left;
        return runs.some((run) => {
          const runWidth = run.right - run.left;
          return (
            Math.abs((run.left + run.right) / 2 - centre) <= 2 &&
            runWidth >= 0.8 * width &&
            runWidth <= width + 1
          );
        });
      });
    })
    .toBe(true);
}

test.describe('falling notes', () => {
  test('switches from the score and remembers the choice', async ({ page }) => {
    await gotoAppReady(page);
    await expect(viewSwitch(page).getByRole('button', { name: 'Notation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await showFallingNotes(page);
    await expect(page.getByRole('img', { name: /Grand staff score/ })).toHaveCount(0);
    // Settings save on a debounce; the reload below waits for the row.
    await expect.poll(() => persistedSetting(page, 'playView')).toBe('waterfall');

    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    await expect(viewSwitch(page).getByRole('button', { name: 'Falling notes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('img', { name: /^Falling notes/ })).toBeVisible();
  });

  test('stands on the keys and stands each note over its key as the keys move', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await recordWhiteAndBlack(page);
    await showFallingNotes(page);

    // Exactly as wide as the key bed, and standing straight on it.
    const canvas = await page.locator('.waterfall__canvas').boundingBox();
    const keys = await page.locator('.piano__keys').boundingBox();
    expect(canvas && keys).toBeTruthy();
    expect(Math.abs(canvas!.x - keys!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(canvas!.width - keys!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(canvas!.y + canvas!.height - keys!.y)).toBeLessThanOrEqual(1);

    await expectBarsOverKeys(page, ['C4', 'C#4']);

    // The key bed moves a key along; the notes go with it.
    const range = page.locator('.piano__range');
    await expect(range).toHaveText(/^C3\s/);
    await page.keyboard.press('ArrowRight');
    await expect(range).toHaveText(/^D3\s/);
    await expectBarsOverKeys(page, ['C4', 'C#4']);
  });

  test('falls faster or slower, and remembers how fast', async ({ page }) => {
    await gotoAppReady(page);
    await showFallingNotes(page);
    const faster = () =>
      page.getByRole('group', { name: 'Fall speed' }).getByRole('button', { name: 'Fall faster' });
    // From three seconds down to one: four steps, and then no further.
    for (let step = 0; step < 4; step += 1) await faster().click();
    await expect(faster()).toBeDisabled();
    await expect.poll(() => persistedSetting(page, 'waterfallSeconds')).toBe(1);

    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    await expect(faster()).toBeDisabled();
  });

  test('scrubs when the notes are dragged, down bringing the music on', async ({ page }) => {
    await gotoAppReady(page);
    await recordWhiteAndBlack(page);
    await showFallingNotes(page);
    await expect(transportTime(page)).toHaveText(/^0:00\.0 /);

    const box = await page.locator('.waterfall__canvas').boundingBox();
    if (!box) throw new Error('no falling notes');
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(x, box.y + 10 + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(transportTime(page)).not.toHaveText(/^0:00\.0 /);
  });
});

test.describe('falling notes on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keep the keys right under them, with the range shifter and metronome below', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await showFallingNotes(page);
    const falling = await page.locator('.waterfall').boundingBox();
    const keys = await page.locator('.piano__keys').boundingBox();
    const controls = await page.locator('.piano__controls').boundingBox();
    const metronome = await page.getByRole('group', { name: 'Metronome' }).boundingBox();
    expect(falling && keys && controls && metronome).toBeTruthy();
    expect(Math.abs(falling!.y + falling!.height - keys!.y)).toBeLessThanOrEqual(1);
    expect(controls!.y).toBeGreaterThanOrEqual(keys!.y + keys!.height - 1);
    expect(metronome!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height - 1);
  });
});

test.describe('falling notes in short landscape', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('show over the keys together, or give way to the keys alone', async ({ page }) => {
    await page.goto('/');
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    const falling = page.locator('.waterfall');
    const keyC4 = page.getByRole('button', { name: 'C4 key' });

    await showFallingNotes(page);
    await expect(keyC4).toBeVisible();
    const box = await falling.boundingBox();
    const keys = await page.locator('.piano__keys').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
    expect(Math.abs(box!.y + box!.height - keys!.y)).toBeLessThanOrEqual(1);

    await viewSwitch(page).getByRole('button', { name: 'Keyboard' }).click();
    await expect(falling).toBeHidden();
    await expect(keyC4).toBeVisible();

    // The view comes back as it was chosen, here and after turning upright.
    await viewSwitch(page).getByRole('button', { name: 'Falling notes' }).click();
    await expect(falling).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(falling).toBeVisible();
    await expect(viewSwitch(page).getByRole('button', { name: 'Keyboard' })).toHaveCount(0);
  });
});

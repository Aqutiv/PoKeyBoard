import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, importTake, transport, transportTime } from './helpers';

/** C4, E4 and G4 a few hundred milliseconds apart: three steps for the right hand. */
const TRIAD = {
  schemaVersion: 1,
  id: 'e2e-practice-0000-0000-000000000001',
  title: 'Practice triad',
  createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z',
  durationMs: 1100,
  samplePackVersion: 'salamander-grand-v4',
  tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 0 },
  instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
  notes: [
    { id: 't1', midi: 60, startMs: 0, durationMs: 300, velocity: 0.7 },
    { id: 't2', midi: 64, startMs: 400, durationMs: 300, velocity: 0.7 },
    { id: 't3', midi: 67, startMs: 800, durationMs: 300, velocity: 0.7 },
  ],
  pedalEvents: [],
  display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
};

/**
 * Six bars of 2/4 at 240 bpm, half a second each: C4 in bar 1, E4 and G4 in
 * bars 5 and 6, so a run through it is told in two sections.
 */
const SIX_BARS = {
  ...TRIAD,
  id: 'e2e-practice-0000-0000-000000000002',
  title: 'Practice in sections',
  durationMs: 3000,
  tempo: { bpm: 240, timeSignature: { numerator: 2, denominator: 4 }, countInBars: 0 },
  notes: [
    { id: 's1', midi: 60, startMs: 0, durationMs: 200, velocity: 0.7 },
    { id: 's2', midi: 64, startMs: 2000, durationMs: 200, velocity: 0.7 },
    { id: 's3', midi: 67, startMs: 2500, durationMs: 500, velocity: 0.7 },
  ],
};

const card = (page: Page) => page.getByRole('group', { name: 'Practice results' });

/** The sentence a screen reader hears, in the status kept beside the card. */
const announcement = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Practice results:' });

/** Wait for playback to hold at `key`, lit as the key asked for. */
async function holdAt(page: Page, key: string): Promise<void> {
  await expect(page.getByRole('button', { name: `${key} key` })).toHaveAttribute(
    'data-target',
    'true',
    { timeout: 10_000 },
  );
}

/**
 * Practise the triad's right hand from the top: C4 right first time, E4 after
 * a wrong F4, and G4 let through with Play.
 */
async function practiseTriad(page: Page): Promise<void> {
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  await holdAt(page, 'C4');
  await page.keyboard.press('KeyA'); // C4
  await holdAt(page, 'E4');
  await page.keyboard.press('KeyF'); // F4, not asked for
  await page.keyboard.press('KeyD'); // E4
  await holdAt(page, 'G4');
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(card(page)).toBeVisible({ timeout: 10_000 });
}

test.describe('practice results', () => {
  test('say how a run went once it ends, and go when dismissed', async ({ page }) => {
    await gotoAppReady(page);
    await importTake(page, TRIAD);
    await page.getByRole('button', { name: 'Practice right', exact: true }).click();
    await practiseTriad(page);

    const results = card(page);
    await expect(results).toContainText('1 of 3 right first time');
    await expect(results).toContainText('1 wrong key');
    await expect(results).toContainText('1 let through');
    await expect(announcement(page)).toHaveText(
      /^Practice results: 1 of 3 right first time \(33%\), 1 wrong key, 1 let through\b/,
    );

    // Not a dialog: nothing stands the keys down while it is up.
    await expect(page.locator('[aria-modal]')).toHaveCount(0);
    await page.keyboard.down('KeyA');
    await expect(page.getByRole('button', { name: 'C4 key' })).toHaveClass(/\bis-active\b/);
    await page.keyboard.up('KeyA');

    await results.getByRole('button', { name: 'Dismiss the results' }).click();
    await expect(results).toHaveCount(0);
    await expect(announcement(page)).toHaveCount(0);
  });

  test('go when the next run starts', async ({ page }) => {
    await gotoAppReady(page);
    await importTake(page, TRIAD);
    await page.getByRole('button', { name: 'Practice right', exact: true }).click();
    await practiseTriad(page);

    // Going back to the top is not a run yet; playing is.
    await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
    await expect(card(page)).toBeVisible();
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(card(page)).toHaveCount(0);
    await holdAt(page, 'C4');
  });

  test('loop the bars of a section tapped, from their start', async ({ page }) => {
    await gotoAppReady(page);
    await importTake(page, SIX_BARS);
    await page.getByRole('button', { name: 'Practice right', exact: true }).click();
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    await holdAt(page, 'C4');
    await page.keyboard.press('KeyA'); // C4
    await holdAt(page, 'E4');
    await page.keyboard.press('KeyD'); // E4
    await holdAt(page, 'G4');
    await page.keyboard.press('KeyG'); // G4

    const results = card(page);
    await expect(results).toBeVisible({ timeout: 10_000 });
    await expect(results.getByRole('button', { name: /^Bars 1–4: 1 of 1/ })).toBeVisible();
    await results.getByRole('button', { name: /^Bars 5–6: 2 of 2/ }).click();

    const loop = page.locator('.transport__loop');
    await expect(loop).toHaveAttribute('aria-pressed', 'true');
    await expect(loop).toHaveAccessibleName('Stop looping 0:02.0–0:03.0');
    await expect(transportTime(page)).toContainText('0:02.0');
  });

  test.describe('on a narrow phone', () => {
    test.use({ viewport: { width: 320, height: 568 } });

    test('stay compact, with nothing cut off', async ({ page }) => {
      await gotoAppReady(page);
      await importTake(page, TRIAD);
      await transport(page).getByRole('button', { name: 'Modes' }).click();
      await page.getByRole('menuitemradio', { name: 'Training — right hand' }).click();
      await practiseTriad(page);

      const results = card(page);
      await expect(results.locator('p')).toHaveText(
        '1 of 3 right first time · 1 wrong · 1 let through',
      );
      // Read off what is drawn, so it holds in any font: the facts fit on one
      // line in the fonts phones use, but a wider one may wrap them. Nothing
      // may be cut off, though, nor the card grow past three rows.
      const layout = await results.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const cut = [...element.querySelectorAll('*')]
          .map((child) => ({ child, rect: child.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.height > 0)
          .filter(
            ({ rect }) =>
              rect.left < box.left - 0.5 ||
              rect.right > box.right + 0.5 ||
              rect.top < box.top - 0.5 ||
              rect.bottom > box.bottom + 0.5,
          )
          .map(({ child }) => child.getAttribute('aria-label') ?? child.className);
        const facts = element.querySelector('p') as HTMLElement;
        // The card's rows: each line of the facts, and the cells and the
        // close button beside them, merged where they share a line's height.
        const text = document.createRange();
        text.selectNodeContents(facts);
        const spans = [
          ...text.getClientRects(),
          ...[...element.children]
            .filter((child) => child !== facts)
            .map((child) => child.getBoundingClientRect()),
        ]
          .filter((rect) => rect.height > 0)
          .map((rect) => [rect.top, rect.bottom] as const)
          .sort((a, b) => a[0] - b[0]);
        let rows = 0;
        let rowBottom = -Infinity;
        for (const [top, bottom] of spans) {
          if (top >= rowBottom - 1) {
            rows += 1;
            rowBottom = bottom;
          } else {
            rowBottom = Math.max(rowBottom, bottom);
          }
        }
        return {
          cut,
          factsOverflow: facts.scrollWidth > facts.clientWidth,
          headlineLines: (facts.querySelector('strong') as HTMLElement).getClientRects().length,
          rows,
          right: box.right,
        };
      });
      expect(layout.cut).toEqual([]);
      expect(layout.factsOverflow).toBe(false);
      expect(layout.right).toBeLessThanOrEqual(320);
      // The headline is never broken across lines, whatever else wraps.
      expect(layout.headlineLines).toBe(1);
      expect(layout.rows).toBeLessThanOrEqual(3);
    });
  });
});

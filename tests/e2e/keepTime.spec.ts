import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  gotoAppReady,
  importTake,
  persistedSetting,
  recordShortTake,
  transport,
  transportTime,
} from './helpers';

/**
 * Count the piano's voices as they start: the buffer sources playing one of
 * its samples, known by the URL each was decoded from, as dailyPlayback's
 * tagging does. An audio unlock's silent buffer and the metronome's
 * oscillators are not counted.
 */
function countPianoVoices(): void {
  const urlOf = new WeakMap<object, string>();
  const readBytes = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = async function (this: Response) {
    const bytes = await readBytes.call(this);
    urlOf.set(bytes, this.url);
    return bytes;
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = async function (
    this: BaseAudioContext,
    bytes: ArrayBuffer,
  ) {
    // Read before decoding, which detaches the bytes.
    const url = urlOf.get(bytes);
    const buffer = await decode.call(this, bytes);
    if (url) urlOf.set(buffer, url);
    return buffer;
  };
  const voices = { started: 0 };
  Object.assign(window, { __pianoVoices: voices });
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (
    this: AudioBufferSourceNode,
    ...args: Parameters<AudioBufferSourceNode['start']>
  ) {
    const url = this.buffer ? urlOf.get(this.buffer) : undefined;
    if (url && url.includes('/piano/')) voices.started += 1;
    return start.apply(this, args);
  };
}

function pianoVoices(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __pianoVoices: { started: number } }).__pianoVoices.started,
  );
}

function resetPianoVoices(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __pianoVoices: { started: number } }).__pianoVoices.started = 0;
  });
}

/** The desktop's practice style buttons, beside the hands. */
function practiceStyle(page: Page) {
  return page.getByRole('group', { name: 'Practice style' });
}

/** Practise a hand in Keep time, from the desktop's practice buttons. */
async function chooseKeepTime(
  page: Page,
  hand: 'Practice left' | 'Practice right' | 'Practice both',
): Promise<void> {
  await page.getByRole('button', { name: hand, exact: true }).click();
  await practiceStyle(page).getByRole('button', { name: 'Keep time', exact: true }).click();
}

function countInStatus(page: Page) {
  return page.getByRole('status').filter({ hasText: 'Count-in' });
}

/**
 * Play from the start, and wait for the take to play to its end; `meanwhile`
 * looks on while it plays.
 */
async function playThrough(page: Page, meanwhile?: () => Promise<void>): Promise<void> {
  await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(transport(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await meanwhile?.();
  await expect(transport(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** How many lines the row's visible children occupy, as narrowPhone.spec measures it. */
function rowCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => {
    const centers = [...element.children]
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => Math.round(rect.top + rect.height / 2));
    return new Set(centers).size;
  });
}

test.describe('Keep time', () => {
  test('is offered beside a hand, and remembered with it', async ({ page }) => {
    await gotoAppReady(page);
    await expect(practiceStyle(page)).toHaveCount(0);
    await chooseKeepTime(page, 'Practice right');
    await expect(
      page.getByText('Playback keeps time: play your part along with it.'),
    ).toBeVisible();
    await expect.poll(() => persistedSetting(page, 'playbackMode')).toBe('playalong-right');
    await expect.poll(() => persistedSetting(page, 'practiceStyle')).toBe('playAlong');

    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Practice right', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      practiceStyle(page).getByRole('button', { name: 'Keep time', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Listen has no style; a hand chosen from it takes the one last chosen.
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await expect(practiceStyle(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Practice left', exact: true }).click();
    await expect(
      practiceStyle(page).getByRole('button', { name: 'Keep time', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => persistedSetting(page, 'playbackMode')).toBe('playalong-left');
  });

  test('counts the player in, then plays the take', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page, 350);
    await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
    // The take is all right hand, so practising the left leaves it all to hear.
    await chooseKeepTime(page, 'Practice left');
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();

    await expect(countInStatus(page)).toBeVisible();
    await expect(page.getByText('Playback keeps time: play your part along with it.')).toHaveCount(
      0,
    );
    // The playhead waits at the start while the bar is counted in.
    await expect(transportTime(page)).toHaveText(/^0:00\.0/);
    await expect(countInStatus(page)).toHaveCount(0, { timeout: 10_000 });
    // Off from the start, and on to the take's end.
    await expect(transportTime(page)).not.toHaveText(/^0:00\.0/);
    await expect(transport(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('leaves the practised hand silent, for the player to play', async ({ page }) => {
    await page.addInitScript(countPianoVoices);
    await gotoAppReady(page);
    await recordShortTake(page);
    // Both notes are right hand: practising it leaves the take nothing to sound.
    await chooseKeepTime(page, 'Practice right');
    await resetPianoVoices(page);
    await playThrough(page, async () => {
      // So the metronome keeps the beat while the run lasts, as its switch says…
      await expect(page.getByRole('button', { name: /^Metronome on/ })).toBeVisible();
    });
    expect(await pianoVoices(page)).toBe(0);
    // …and goes off again with the run.
    await expect(page.getByRole('button', { name: 'Metronome off' })).toBeVisible();

    // Practising the other hand, the take plays its notes.
    await page.getByRole('button', { name: 'Practice left', exact: true }).click();
    await resetPianoVoices(page);
    await playThrough(page);
    expect(await pianoVoices(page)).toBeGreaterThan(0);
  });

  test('pauses when the practice style changes during a run', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page, 350);
    await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
    await chooseKeepTime(page, 'Practice left');
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(countInStatus(page)).toBeVisible();

    await practiceStyle(page).getByRole('button', { name: 'Wait for me', exact: true }).click();
    await expect(transport(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(countInStatus(page)).toHaveCount(0);
    await expect(transportTime(page)).toHaveText(/^0:00\.0/);
    await expect.poll(() => persistedSetting(page, 'playbackMode')).toBe('training-left');
  });
});

test.describe('Keep time on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is in the Modes menu once a hand is chosen, the transport still one row', async ({
    page,
  }) => {
    await gotoAppReady(page);
    const modes = transport(page).getByRole('button', { name: 'Modes' });
    await modes.click();
    await expect(page.getByRole('menuitemradio', { name: 'Keep time' })).toHaveCount(0);
    await page.getByRole('menuitemradio', { name: 'Training — right hand' }).click();
    await modes.click();
    // In sight as the menu opens, not scrolled out of its panel.
    await expect(page.getByRole('menuitemradio', { name: 'Keep time' })).toBeInViewport({
      ratio: 1,
    });
    await page.getByRole('menuitemradio', { name: 'Keep time' }).click();
    await expect.poll(() => persistedSetting(page, 'playbackMode')).toBe('playalong-right');

    await modes.click();
    await expect(page.getByRole('menuitemradio', { name: 'Keep time' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(
      page.getByRole('menuitemradio', { name: 'Training — right hand' }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    expect(await rowCount(page, '.transport__buttons')).toBe(1);
  });
});

/**
 * Eight right-hand notes half a second apart at 120 bpm, two bars of them,
 * over a C3 held through both in the left hand, which sounds while the
 * player plays the right hand along with it.
 */
const EIGHT_NOTES = {
  schemaVersion: 1,
  id: 'e2e-keep-time-0000-0000-000000000001',
  title: 'Keep time in eights',
  createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z',
  durationMs: 4000,
  samplePackVersion: 'salamander-grand-v4',
  tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 1 },
  instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
  notes: [
    { id: 'l1', midi: 48, startMs: 0, durationMs: 4000, velocity: 0.5 },
    ...[60, 62, 64, 65, 67, 65, 64, 62].map((midi, index) => ({
      id: `r${index + 1}`,
      midi,
      startMs: index * 500,
      durationMs: 300,
      velocity: 0.7,
    })),
  ],
  pedalEvents: [],
  display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
};

/** The right hand of EIGHT_NOTES on the computer keyboard, as [key code, take ms]. */
const RIGHT_HAND: readonly (readonly [string, number])[] = [
  ['KeyA', 0], // C4
  ['KeyS', 500], // D4
  ['KeyD', 1000], // E4
  ['KeyF', 1500], // F4
  ['KeyG', 2000], // G4
  ['KeyF', 2500],
  ['KeyD', 3000],
  ['KeyS', 3500],
];

const resultsCard = (page: Page) => page.getByRole('group', { name: 'Practice results' });

/**
 * The moment on the page's clock a press lands on the run's start, which the
 * card's status publishes while a Keep-time run lasts.
 */
async function keepTimeOrigin(page: Page): Promise<number> {
  const status = page.locator('[data-keep-time-origin-ms]');
  await status.waitFor({ state: 'attached', timeout: 10_000 });
  return Number(await status.getAttribute('data-keep-time-origin-ms'));
}

/**
 * Play [key code, take ms] presses along with a Keep-time run from the take's
 * start at its own speed, `lateMs` behind the beat: from inside the page, each
 * at the run's origin plus its moment, so nothing is raced. Learn's chapter
 * seven plays its melody in time the same way.
 */
async function playAlong(
  page: Page,
  presses: readonly (readonly [string, number])[],
  lateMs = 0,
): Promise<void> {
  const originMs = await keepTimeOrigin(page);
  await page.evaluate(
    async ({ originMs, presses, lateMs }) => {
      for (const [code, ms] of presses) {
        const at = originMs + ms + lateMs;
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, at - performance.now())));
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      }
    },
    { originMs, presses, lateMs },
  );
}

/** Practise EIGHT_NOTES's right hand in Keep time from the desktop's buttons, and play. */
async function keepTimeWithEight(page: Page): Promise<void> {
  await gotoAppReady(page);
  await importTake(page, EIGHT_NOTES);
  await chooseKeepTime(page, 'Practice right');
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
}

// The card's on-time counts are never asserted: the headless clock is too
// loose to hold a press within 60 ms of its note every time.
test.describe('Keep time results', () => {
  test('say every note was missed when nothing was played', async ({ page }) => {
    await keepTimeWithEight(page);
    const results = resultsCard(page);
    await expect(results).toBeVisible({ timeout: 15_000 });
    await expect(results).toContainText('0 of 8 on time');
    await expect(results).toContainText('0 hit');
    await expect(results).toContainText('8 missed');
  });

  test('hear the notes played along in time with the music', async ({ page }) => {
    await keepTimeWithEight(page);
    await playAlong(page, RIGHT_HAND);
    const results = resultsCard(page);
    await expect(results).toBeVisible({ timeout: 15_000 });
    await expect(results.locator('p')).toContainText(/\b[78] hit\b/);
    await expect(results).not.toContainText('wrong note');
  });

  test('count keys no note near them asks for as wrong notes', async ({ page }) => {
    await keepTimeWithEight(page);
    // C5, which the take never asks for, twice.
    await playAlong(page, [
      ['KeyK', 1000],
      ['KeyK', 2500],
    ]);
    const results = resultsCard(page);
    await expect(results).toBeVisible({ timeout: 15_000 });
    await expect(results).toContainText('2 wrong notes');
    await expect(results).toContainText('0 hit');
  });
});

test.describe('Keep time results on a narrow phone', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('stay compact, with nothing cut off', async ({ page }) => {
    await gotoAppReady(page);
    await importTake(page, EIGHT_NOTES);
    const modes = transport(page).getByRole('button', { name: 'Modes' });
    await modes.click();
    await page.getByRole('menuitemradio', { name: 'Training — right hand' }).click();
    await modes.click();
    await page.getByRole('menuitemradio', { name: 'Keep time' }).click();
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    // Every note well behind the beat: the player drags, and, late by the
    // same each time, the line may add that it could be the sound's delay.
    await playAlong(page, RIGHT_HAND, 130);

    const results = resultsCard(page);
    await expect(results).toBeVisible({ timeout: 15_000 });
    // `\s`: the space before each dot is a no-break one, holding it to the fact before.
    await expect(results.locator('p')).toHaveText(/ of 8 on time\s·\s\d hit\s·\sYou drag\b/);
    // Read off what is drawn, as the card's own narrow-phone check does, so it
    // holds in any font: nothing cut off, the headline whole, and no more than
    // three rows, the facts' lines and the cells' row with the close button.
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
      // The card's rows: each line of the facts, and the cells and the close
      // button beside them, merged where they share a line's height.
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
    expect(layout.headlineLines).toBe(1);
    expect(layout.rows).toBeLessThanOrEqual(3);
  });
});

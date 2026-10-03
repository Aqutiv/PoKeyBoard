import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  gotoAppReady,
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

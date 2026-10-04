import type { Page } from '@playwright/test';
import { ODE_TO_JOY_FIRST_STEPS } from '../../src/features/library/tracks/odeToJoyFirstSteps';
import { contentHash } from '../../src/features/practice/contentHash';
import { expect, test } from './fixtures';
import { gotoAppReady, nav, transport } from './helpers';

/** Eight bars for the right hand alone, authored in the repo: nothing to fetch. */
const TITLE = 'Ode to Joy (first steps)';
const TAKE_ID = 'library:ode-to-joy-first-steps';

/** The computer key, and the key, for each note the tune asks for (computerKeyboard.ts, from C4). */
const KEYS: Record<string, { code: string; midi: number }> = {
  C4: { code: 'KeyA', midi: 60 },
  D4: { code: 'KeyS', midi: 62 },
  E4: { code: 'KeyD', midi: 64 },
  F4: { code: 'KeyF', midi: 65 },
  G4: { code: 'KeyG', midi: 67 },
};

/**
 * The tune's notes, as the app builds them from its events (`buildLibraryTake`)
 * and practice weighs them (`takeContent`): one tempo throughout, so a beat is
 * a fixed number of milliseconds, every note the right hand's, and none hidden.
 */
const TUNE = ODE_TO_JOY_FIRST_STEPS.events.map(([beat, note, beats]) => ({
  startMs: Math.round((beat * 60_000) / ODE_TO_JOY_FIRST_STEPS.bpm),
  midi: KEYS[note as string]?.midi ?? Number.NaN,
  durationMs: Math.round((beats * 60_000) / ODE_TO_JOY_FIRST_STEPS.bpm),
  hand: 'right' as const,
  hidden: false,
}));

/** The notes the right hand plays: both phrases, fourteen each. */
const NOTES = TUNE.length;

/**
 * What a result kept for the tune says of it: its count and length, as the
 * catalog has them, and its notes.
 */
const FINGERPRINT = `${NOTES}:${Math.max(...TUNE.map((note) => note.startMs + note.durationMs))}`;
const CONTENT = contentHash(TUNE);

const card = (page: Page) => page.getByRole('group', { name: 'Practice results' });

/** The track's row in the Library, by the very name the other specs find it by. */
const row = (page: Page) => page.getByRole('button', { name: `Open ${TITLE}`, exact: true });

/** Open the tune on Play, practising the right hand, waiting for it, at 150%. */
async function openOdeToPractise(page: Page): Promise<void> {
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Classics', exact: true }).click();
  await row(page).click();
  await expect(page.locator('.play-header__title')).toHaveText(TITLE);
  await page.getByRole('button', { name: 'Practice right', exact: true }).click();
  await page.getByRole('button', { name: 'Playback speed: 100%' }).click();
  await page.getByRole('menuitemradio', { name: '150%', exact: true }).click();
}

/**
 * Play the right hand through from the top, each key as playback holds for
 * it: every note right first time, but for a wrong key first at `wrongAt`.
 */
async function playEveryNote(page: Page, wrongAt = -1): Promise<void> {
  const held = page.locator('.piano-key[data-target="true"]');
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  for (let played = 0; played < NOTES; played += 1) {
    await expect(held).toHaveCount(1, { timeout: 10_000 });
    const note = ((await held.getAttribute('aria-label')) ?? '').replace(/ key$/, '');
    const key = KEYS[note];
    if (!key) throw new Error(`The tune asked for ${note}, which no key here plays`);
    if (played === wrongAt) await page.keyboard.press('KeyH'); // A4, asked for nowhere
    await page.keyboard.press(key.code);
    // Let go before the next hold, which may ask for the same key again.
    await expect(held).toHaveCount(0);
  }
  await expect(card(page)).toBeVisible({ timeout: 10_000 });
}

/**
 * Keep an earlier result as the tune's best, and last, waiting for the right
 * hand: written straight into its metadata row (practiceResultsRepository),
 * as a run on another day would have left it, on these very notes, so that
 * opening the tune keeps it.
 */
async function keepEarlierBest(page: Page, best: { accuracy: number; speed: number }) {
  const score = {
    at: '2026-10-01T10:00:00.000Z',
    notes: NOTES,
    fingerprint: FINGERPRINT,
    content: CONTENT,
    ...best,
  };
  await page.evaluate(
    ({ takeId, score: kept }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const write = database.transaction('metadata', 'readwrite');
          write.objectStore('metadata').put({
            key: 'practiceResults',
            value: { v: 1, tracks: { [takeId]: { 'wait:right': { best: kept, last: kept } } } },
          });
          write.oncomplete = () => {
            database.close();
            resolve();
          };
          write.onerror = () => reject(write.error);
        };
      }),
    { takeId: TAKE_ID, score },
  );
}

test.describe('best results', () => {
  // About twenty seconds of music at 150% in each, on top of the usual.
  test.slow();

  test('keep a first run through a Library track as its best, shown in the Library across a reload', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await openOdeToPractise(page);
    await playEveryNote(page);
    await expect(card(page)).toContainText(`${NOTES} of ${NOTES} right first time`);

    await nav(page).getByRole('button', { name: 'Library' }).click();
    await expect(row(page)).toContainText('Right hand · 100%');
    await expect(row(page)).toHaveAccessibleDescription(
      'Best in right hand, waiting for you: 100%',
    );

    // Kept by now, and still the card's run: the best there is, with nothing
    // to measure it against, and no best beaten.
    await nav(page).getByRole('button', { name: 'Play' }).click();
    await expect(card(page)).toContainText(`${NOTES} of ${NOTES} right first time`);
    await expect(card(page)).not.toContainText('Best');
    await expect(card(page).getByText('New best')).toHaveCount(0);

    // Kept on the device.
    await page.reload();
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await expect(row(page)).toContainText('Right hand · 100%', { timeout: 30_000 });
  });

  test('mark a run that beats an earlier best', async ({ page }) => {
    await gotoAppReady(page);
    await keepEarlierBest(page, { accuracy: 26 / 28, speed: 1.5 });
    await openOdeToPractise(page);
    await playEveryNote(page);

    const results = card(page);
    await expect(results.getByText('New best')).toBeVisible();
    await expect(results).not.toContainText('Best');
  });

  test('measure a run against a better best', async ({ page }) => {
    await gotoAppReady(page);
    await keepEarlierBest(page, { accuracy: 1, speed: 1.5 });
    await openOdeToPractise(page);
    await playEveryNote(page, 3);

    const results = card(page);
    await expect(results).toContainText(`${NOTES - 1} of ${NOTES} right first time`);
    await expect(results).toContainText('Best 100% (at 150%)');
    await expect(results.getByText('New best')).toHaveCount(0);
  });
});

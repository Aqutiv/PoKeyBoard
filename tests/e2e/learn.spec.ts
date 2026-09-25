import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { nav } from './helpers';

function levels(page: Page) {
  return page.getByRole('group', { name: 'Learn level' });
}

function chapterButtons(page: Page) {
  return page.getByRole('button', { name: /^Open |— coming soon$/ });
}

/**
 * The app shell only mounts once `persistenceService.init()` settles, so every
 * visit has to wait for the nav before asserting anything on the page itself.
 */
async function gotoBooted(page: Page, hash: string): Promise<void> {
  await page.goto(hash);
  await expect(nav(page).getByRole('button', { name: 'Learn' })).toBeVisible({ timeout: 30_000 });
}

async function gotoLearn(page: Page): Promise<void> {
  await gotoBooted(page, '/#/learn');
  await expect(levels(page)).toBeVisible({ timeout: 30_000 });
}

/** Open a chapter and wait for the core samples, or input emits nothing. */
async function openChapter(page: Page, title: string): Promise<void> {
  await gotoLearn(page);
  await page.getByRole('button', { name: `Open ${title}` }).click();
  await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
  // And for the chapter module itself: the keyboard is live while it is still
  // in flight, and the load handler parks the anchor on the opening step when
  // it lands — so a range shifted before that would be silently snapped back.
  await page.locator('.learn-card__heading').waitFor({ timeout: 30_000 });
}

async function openChapterOne(page: Page): Promise<void> {
  await openChapter(page, 'Meet the Keyboard');
}

/** The white keys of one octave from middle C, in alphabet order. */
const WALK_UP = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];

const progressLine = (page: Page) => page.locator('.learn-exercise__progress');
const nextButton = (page: Page) => page.getByRole('button', { name: 'Next' });

/**
 * A drill holds a correct answer on screen before asking the next one, so the
 * note just played gets a beat to light up on the stave. Sitting out that hold
 * is the behaviour under test, not a workaround for a race — and it is also
 * what makes "still 0 of 5" mean anything, since the readout ticks the instant
 * a round is credited.
 */
const DRILL_HOLD_MS = 500;
const settleDrillHold = (page: Page) => page.waitForTimeout(DRILL_HOLD_MS + 150);

/**
 * A persisted setting, read straight out of IndexedDB. Settings writes are
 * debounced, so a reload-based test waits for the write itself rather than for
 * a guessed interval to elapse.
 */
function persistedSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (settingKey) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains('settings')) {
            database.close();
            resolve(undefined);
            return;
          }
          const request = database.transaction('settings').objectStore('settings').get(settingKey);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            resolve((request.result as { value?: unknown } | undefined)?.value);
            database.close();
          };
        };
      }),
    key,
  );
}

/**
 * Press and release a computer-keyboard note.
 *
 * `KeyA` is the C at or below the lesson's anchor — C4 for chapters 1-4, C3
 * for the bass chapter. The two rows are chromatic from there, so `KeyK` is
 * always the C an octave up.
 */
async function playKey(page: Page, code: string): Promise<void> {
  await page.keyboard.down(code);
  await page.keyboard.up(code);
}

test.describe('learn outline', () => {
  test('sits between Play and Library in the nav', async ({ page }) => {
    await gotoBooted(page, '/');
    const labels = await nav(page).getByRole('button').allInnerTexts();
    expect(labels).toEqual(['Play', 'Learn', 'Library', 'Takes', 'Settings', 'About']);

    await nav(page).getByRole('button', { name: 'Learn' }).click();
    await expect(page).toHaveURL(/#\/learn$/);
    await expect(levels(page)).toBeVisible();
  });

  test('lists three levels of ten chapters', async ({ page }) => {
    await gotoLearn(page);
    await expect(levels(page).getByRole('button')).toHaveText([
      'Beginner',
      'Intermediate',
      'Advanced',
    ]);
    await expect(levels(page).getByRole('button', { name: 'Beginner' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    for (const level of ['Beginner', 'Intermediate', 'Advanced']) {
      await levels(page).getByRole('button', { name: level }).click();
      await expect(chapterButtons(page), level).toHaveCount(level === 'Beginner' ? 9 : 0);
      await page.getByText('Upcoming lessons', { exact: true }).click();
      await expect(chapterButtons(page), level).toHaveCount(10);
      await page.getByText('Upcoming lessons', { exact: true }).click();
    }
  });

  test('groups each level into three named parts', async ({ page }) => {
    await gotoLearn(page);
    // Playing is split across the two lists: its first chapter has shipped
    // and the rest are still upcoming, so each list heads its own run of it.
    await expect(page.locator('.learn-part__heading')).toHaveText([
      'The instrument',
      'Reading music',
      'Playing',
      'Playing',
    ]);

    await levels(page).getByRole('button', { name: 'Advanced' }).click();
    await expect(page.locator('.learn-part__heading')).toHaveText([
      'Richer harmony',
      'Independence and control',
      'Making it your own',
    ]);
  });

  test('remembers the level across a reload', async ({ page }) => {
    await gotoLearn(page);
    await levels(page).getByRole('button', { name: 'Advanced' }).click();
    await expect(page.locator('.learn-part__heading').first()).toHaveText('Richer harmony');
    await expect
      .poll(() => persistedSetting(page, 'learnLevel'), { timeout: 10_000 })
      .toBe('advanced');

    await page.reload();
    await expect(levels(page).getByRole('button', { name: 'Advanced' })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 30_000 },
    );
  });

  test('unlocks only the authored chapters', async ({ page }) => {
    await gotoLearn(page);
    for (const title of [
      'Meet the Keyboard',
      'The Musical Alphabet',
      'Half Steps, Whole Steps & the Black Keys',
      'Reading the Treble Staff',
      'The Bass Staff & the Grand Staff',
      'Rhythm & the Beat',
      'Your First Melody',
      'The C Major Scale',
      'Triads: Major and Minor',
    ]) {
      await expect(page.getByRole('button', { name: `Open ${title}` })).toBeEnabled();
    }
    await expect(page.getByText('9 lessons available')).toBeVisible();
    await page.getByText('Upcoming lessons', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Chords, Pedal & Hands Together — coming soon' }),
    ).toBeDisabled();
    await expect(page.getByText('Coming soon')).toHaveCount(1);
  });
});

test.describe('chapter runner', () => {
  test('mounts exactly one keyboard', async ({ page }) => {
    // The regression guard for the duplicate-keyboard hazard: two mounted
    // keyboards would double every computer keypress into two voices.
    await openChapterOne(page);
    await expect(page.locator('.piano__keys')).toHaveCount(1);
  });

  test('gates Next until the exercise is played', async ({ page }) => {
    await openChapterOne(page);
    await expect(page.getByRole('heading', { name: 'Press a key' })).toBeVisible();
    await expect(page.getByText('Step 1 of 11')).toBeVisible();
    await expect(progressLine(page)).toHaveText('0 of 3');
    await expect(nextButton(page)).toBeDisabled();

    await playKey(page, 'KeyA'); // C4
    await expect(progressLine(page)).toHaveText('1 of 3');
    await playKey(page, 'KeyS'); // D4
    await expect(progressLine(page)).toHaveText('2 of 3');
    await playKey(page, 'KeyD'); // E4
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });

  test('does not credit the same key twice', async ({ page }) => {
    await openChapterOne(page);
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyA');
    await expect(progressLine(page)).toHaveText('1 of 3');
    await expect(nextButton(page)).toBeDisabled();
  });

  test('Listen demonstrates without completing the exercise', async ({ page }) => {
    // `scheduleNote` deliberately emits no input events; the whole exercise
    // design rests on a demo never being mistaken for the user playing.
    await openChapterOne(page);
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyS');
    await playKey(page, 'KeyD');
    await nextButton(page).click();

    await expect(
      page.getByRole('heading', { name: 'Low on the left, high on the right' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Listen' }).click();
    await nextButton(page).click();

    await expect(page.getByRole('heading', { name: 'Travel across' })).toBeVisible();
    await expect(progressLine(page)).toHaveText('0 of 2');
    await expect(nextButton(page)).toBeDisabled();
  });

  test('accepts a rising leap of at least an octave', async ({ page }) => {
    await openChapterOne(page);
    for (const code of ['KeyA', 'KeyS', 'KeyD']) await playKey(page, code);
    await nextButton(page).click();
    await nextButton(page).click();

    await expect(page.getByRole('heading', { name: 'Travel across' })).toBeVisible();
    await playKey(page, 'KeyA'); // C4
    await expect(progressLine(page)).toHaveText('1 of 2');
    await playKey(page, 'KeyS'); // D4 — nowhere near far enough
    await expect(progressLine(page)).toHaveText('1 of 2');
    await playKey(page, 'KeyK'); // C5
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });

  test('accepts a black-key group of two held together', async ({ page }) => {
    await openChapterOne(page);
    for (const code of ['KeyA', 'KeyS', 'KeyD']) await playKey(page, code);
    await nextButton(page).click();
    await nextButton(page).click();
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyK');
    await nextButton(page).click();
    await nextButton(page).click();

    await expect(page.getByRole('heading', { name: 'Find a group of two' })).toBeVisible();
    await page.keyboard.down('KeyW'); // C#4
    await page.keyboard.down('KeyE'); // D#4
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyE');
    // Satisfaction is sticky: releasing must not walk the readout backwards.
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });

  test('resumes where it was left after a reload', async ({ page }) => {
    await openChapterOne(page);
    for (const code of ['KeyA', 'KeyS', 'KeyD']) await playKey(page, code);
    await nextButton(page).click();
    await expect(page.getByText('Step 2 of 11')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Resume at step 2')).toBeVisible();
    await page.getByRole('button', { name: 'Open Meet the Keyboard' }).click();
    await expect(page.getByText('Step 2 of 11')).toBeVisible();
  });

  test('closes back to the outline without touching the Play keyboard range', async ({ page }) => {
    await gotoBooted(page, '/#/play');
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    const before = await page.locator('.piano__range').innerText();

    await openChapterOne(page);
    await page.getByRole('button', { name: 'Shift keyboard range up one octave' }).click();
    await page.getByRole('button', { name: 'Close chapter' }).click();
    await expect(levels(page)).toBeVisible();

    await nav(page).getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.piano__range')).toHaveText(before);
  });

  test('stays in the chapter across a visit to another tab', async ({ page }) => {
    await openChapterOne(page);
    for (const code of ['KeyA', 'KeyS', 'KeyD']) await playKey(page, code);
    await nextButton(page).click();
    await expect(page.getByText('Step 2 of 11')).toBeVisible();

    await nav(page).getByRole('button', { name: 'Library' }).click();
    await expect(page.getByRole('group', { name: 'Library folder' })).toBeVisible();
    await nav(page).getByRole('button', { name: 'Learn' }).click();

    // Back in the lesson, at the step it was left on — not the outline, and
    // not restarted from step one.
    await expect(page.getByText('Step 2 of 11')).toBeVisible();
    await expect(levels(page)).toHaveCount(0);
  });

  test('returns to the outline once the chapter is closed', async ({ page }) => {
    await openChapterOne(page);
    await page.getByRole('button', { name: 'Close chapter' }).click();
    await expect(levels(page)).toBeVisible();

    await nav(page).getByRole('button', { name: 'Library' }).click();
    await expect(page.getByRole('group', { name: 'Library folder' })).toBeVisible();
    await nav(page).getByRole('button', { name: 'Learn' }).click();
    await expect(levels(page)).toBeVisible();
  });

  test('starts a fresh visit at the outline, not mid-lesson', async ({ page }) => {
    // Which step you reached is progress and persists; being *inside* a chapter
    // belongs to the sitting, so a reload should not drop you into a lesson.
    await openChapterOne(page);
    await expect(page.getByText('Step 1 of 11')).toBeVisible();
    await page.reload();
    await expect(levels(page)).toBeVisible({ timeout: 30_000 });
  });

  test('arrow keys move the lesson keyboard, not the Play one', async ({ page }) => {
    // Main gained an arrow-key range shortcut after this feature was written;
    // it routes through the same setter the runner overrides, so it should
    // move the lesson's local anchor and leave Play's setting alone.
    await gotoBooted(page, '/#/play');
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    const playRange = await page.locator('.piano__range').innerText();

    await openChapterOne(page);
    const lessonRange = await page.locator('.piano__range').innerText();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.piano__range')).not.toHaveText(lessonRange);

    await page.getByRole('button', { name: 'Close chapter' }).click();
    await nav(page).getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.piano__range')).toHaveText(playRange);
  });
});

test.describe('chapter two', () => {
  async function openChapterTwo(page: Page): Promise<void> {
    await openChapter(page, 'The Musical Alphabet');
  }

  /** Step past the opening theory card onto the first exercise. */
  async function gotoWalkUp(page: Page): Promise<void> {
    await openChapterTwo(page);
    await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'Walk up from C' })).toBeVisible();
  }

  test('counts the scale walked up in order', async ({ page }) => {
    await gotoWalkUp(page);
    await expect(progressLine(page)).toHaveText('0 of 8');
    for (const [index, code] of WALK_UP.entries()) {
      await playKey(page, code);
      const done = index + 1;
      await expect(progressLine(page)).toHaveText(done === 8 ? 'Nicely done.' : `${done} of 8`);
    }
    await expect(nextButton(page)).toBeEnabled();
  });

  test('a wrong note drops the run back', async ({ page }) => {
    await gotoWalkUp(page);
    await playKey(page, 'KeyA'); // C
    await playKey(page, 'KeyS'); // D
    await expect(progressLine(page)).toHaveText('2 of 8');
    await playKey(page, 'KeyF'); // F, where E was due
    await expect(progressLine(page)).toHaveText('0 of 8');
    await expect(nextButton(page)).toBeDisabled();
  });

  test('the quiz gates Next until five keys are named', async ({ page }) => {
    await gotoWalkUp(page);
    for (const code of WALK_UP) await playKey(page, code);
    await nextButton(page).click(); // to "Where each letter hides"
    await nextButton(page).click(); // to the quiz

    await expect(page.getByRole('heading', { name: 'Which key is this?' })).toBeVisible();
    await expect(nextButton(page)).toBeDisabled();
    await expect(page.locator('.learn-quiz__status')).toHaveText('0 of 5');

    // Questions are drawn deterministically, so the answers are knowable: the
    // pool is walked with a stride of 3 to keep round n off button n.
    for (const [index, letter] of ['C', 'F', 'B', 'E', 'A'].entries()) {
      await page.getByRole('button', { name: `Answer ${letter}` }).click();
      const done = index + 1;
      await expect(page.locator('.learn-quiz__status')).toHaveText(
        done === 5 ? 'Nicely done.' : `${done} of 5`,
      );
    }
    await expect(nextButton(page)).toBeEnabled();
  });

  test('a wrong answer names the key and asks again', async ({ page }) => {
    await gotoWalkUp(page);
    for (const code of WALK_UP) await playKey(page, code);
    await nextButton(page).click();
    await nextButton(page).click();

    await page.getByRole('button', { name: 'Answer D' }).click(); // first answer is C
    await expect(page.locator('.learn-quiz__status')).toHaveText('That one is C.');
    await page.getByRole('button', { name: 'Answer C' }).click();
    await expect(page.locator('.learn-quiz__status')).toHaveText('1 of 5');
  });

  test('the quiz leaves the piano playable', async ({ page }) => {
    // The regression guard for an accidental aria-modal: the computer-keyboard
    // layer ignores every keystroke while one exists anywhere on the page.
    await gotoWalkUp(page);
    for (const code of WALK_UP) await playKey(page, code);
    await nextButton(page).click();
    await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'Which key is this?' })).toBeVisible();

    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await page.keyboard.down('KeyA');
    await expect(page.getByRole('button', { name: 'C4 key' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.up('KeyA');
  });

  test('the descending walk rejects a note played upwards', async ({ page }) => {
    await gotoWalkUp(page);
    for (const code of WALK_UP) await playKey(page, code);
    await nextButton(page).click(); // where each letter hides
    await nextButton(page).click(); // quiz
    for (const letter of ['C', 'F', 'B', 'E', 'A']) {
      await page.getByRole('button', { name: `Answer ${letter}` }).click();
    }
    await nextButton(page).click(); // find D, F, A
    for (const code of ['KeyS', 'KeyF', 'KeyH']) await playKey(page, code);
    await nextButton(page).click(); // walking back down (theory)
    await nextButton(page).click(); // walk down

    await expect(page.getByRole('heading', { name: 'Walk down from C' })).toBeVisible();
    await playKey(page, 'KeyK'); // the upper C
    await expect(progressLine(page)).toHaveText('1 of 8');
    await playKey(page, 'KeyJ'); // B below it — correct
    await expect(progressLine(page)).toHaveText('2 of 8');
  });
});

test.describe('chapter three', () => {
  /** Open chapter 3 and step onto the first exercise. */
  async function gotoHalfStep(page: Page): Promise<void> {
    await openChapter(page, 'Half Steps, Whole Steps & the Black Keys');
    await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'Play a half step' })).toBeVisible();
  }

  /** Walk from the half-step exercise to a later step by index. */
  async function advanceTo(page: Page, heading: string, clicks: number): Promise<void> {
    for (let i = 0; i < clicks; i += 1) await nextButton(page).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  test('accepts any two touching keys as a half step', async ({ page }) => {
    await gotoHalfStep(page);
    await expect(progressLine(page)).toHaveText('0 of 2');

    await playKey(page, 'KeyA'); // C4
    await expect(progressLine(page)).toHaveText('1 of 2');
    await playKey(page, 'KeyS'); // D4 — a whole step, not a half
    await expect(progressLine(page)).toHaveText('1 of 2');
    await playKey(page, 'KeyW'); // C#4 — now C4/C#4 touch
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });

  test('accepts a skipped key as a whole step', async ({ page }) => {
    await gotoHalfStep(page);
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyW');
    await advanceTo(page, 'Two halves make a whole', 1);
    await advanceTo(page, 'Play a whole step', 1);

    await playKey(page, 'KeyA'); // C4
    await playKey(page, 'KeyW'); // C#4 — touching, so still only half of it
    await expect(progressLine(page)).toHaveText('1 of 2');
    await playKey(page, 'KeyS'); // D4 — C4 to D4 skips C#4
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });

  test('plays both touching white-key pairs without a range shift', async ({ page }) => {
    await gotoHalfStep(page);
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyW');
    await advanceTo(page, 'Two halves make a whole', 1);
    await advanceTo(page, 'Play a whole step', 1);
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyS');
    await advanceTo(page, 'Where the white keys touch', 1);
    await advanceTo(page, 'Play both of them', 1);

    // The step anchors at E4 so all four notes are on screen even at 7 keys.
    await expect(page.locator('.piano__range')).toContainText('E4');
    for (const [index, code] of ['KeyD', 'KeyF', 'KeyJ', 'KeyK'].entries()) {
      await playKey(page, code); // E4, F4, B4, C5
      const done = index + 1;
      await expect(progressLine(page)).toHaveText(done === 4 ? 'Nicely done.' : `${done} of 4`);
    }
  });

  test('names the black keys with sharps, then drills them with flats', async ({ page }) => {
    await gotoHalfStep(page);
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyW');
    await advanceTo(page, 'Two halves make a whole', 1);
    await advanceTo(page, 'Play a whole step', 1);
    await playKey(page, 'KeyA');
    await playKey(page, 'KeyS');
    await advanceTo(page, 'Where the white keys touch', 1);
    await advanceTo(page, 'Play both of them', 1);
    for (const code of ['KeyD', 'KeyF', 'KeyJ', 'KeyK']) await playKey(page, code);
    await advanceTo(page, 'Sharps', 1);
    await advanceTo(page, 'Name the black key', 1);

    // Sharp spelling, and the deterministic stride over five entries.
    await expect(page.getByRole('button', { name: 'Answer C♯' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Answer D♭' })).toHaveCount(0);
    for (const letter of ['C♯', 'G♯', 'D♯', 'A♯', 'F♯']) {
      await page.getByRole('button', { name: `Answer ${letter}` }).click();
    }
    await expect(page.locator('.learn-quiz__status')).toHaveText('Nicely done.');

    await advanceTo(page, 'The same keys, named from above', 1);
    await advanceTo(page, 'Find the key I name', 1);

    // The drill asks in flats — the same five keys under their other name.
    await expect(page.locator('.learn-exercise__prompt')).toHaveText('Play D♭.');
    await expect(progressLine(page)).toHaveText('0 of 5');
    await expect(nextButton(page)).toBeDisabled();

    await playKey(page, 'KeyS'); // D4 — named, but not the key named
    await settleDrillHold(page);
    await expect(progressLine(page)).toHaveText('0 of 5');

    await playKey(page, 'KeyW'); // C#4 is D♭
    // The readout confirms on the press; the question itself only changes once
    // the hold is up.
    await expect(progressLine(page)).toHaveText('1 of 5');
    await expect(page.locator('.learn-exercise__prompt')).toHaveText('Play A♭.');

    for (const code of ['KeyY', 'KeyE', 'KeyU', 'KeyT']) {
      await playKey(page, code);
      await settleDrillHold(page);
    }
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });
});

test.describe('chapter four', () => {
  /** Open chapter 4 and step to a heading by clicking Next `clicks` times. */
  async function gotoStep(page: Page, heading: string, clicks: number): Promise<void> {
    await openChapter(page, 'Reading the Treble Staff');
    for (let i = 0; i < clicks; i += 1) await nextButton(page).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  test('draws a treble staff with no bass staff and no bar furniture', async ({ page }) => {
    await openChapter(page, 'Reading the Treble Staff');
    await expect(page.getByRole('heading', { name: 'Five lines and four spaces' })).toBeVisible();

    // The snippet collapses to one staff, so it is far shorter than the grand
    // staff's 192px — that height is the visible proof the bass staff is gone.
    const height = await page
      .locator('.learn-staff__canvas')
      .evaluate((el) => (el as HTMLCanvasElement).clientHeight);
    expect(height).toBeLessThan(192);
    expect(height).toBeGreaterThan(0);
  });

  test('reads middle C off the stave', async ({ page }) => {
    await gotoStep(page, 'Play what you see', 3);
    await expect(progressLine(page)).toHaveText('0 of 1');
    await expect(nextButton(page)).toBeDisabled();
    await playKey(page, 'KeyS'); // D4 — not what is written
    await expect(progressLine(page)).toHaveText('0 of 1');
    await playKey(page, 'KeyA'); // C4
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });

  test('the reading quiz gates Next until five notes are named', async ({ page }) => {
    await gotoStep(page, 'Play what you see', 3);
    await playKey(page, 'KeyA');
    await nextButton(page).click(); // C D E F G
    await nextButton(page).click(); // finger numbers
    await nextButton(page).click(); // the quiz

    await expect(page.getByRole('heading', { name: 'Which note is this?' })).toBeVisible();
    // The question is a picture, so the panel shows a stave rather than keys.
    await expect(page.locator('.learn-quiz .learn-staff__canvas')).toHaveCount(1);
    await expect(page.locator('.learn-quiz .learn-diagram')).toHaveCount(0);
    await expect(nextButton(page)).toBeDisabled();

    // Deterministic round order over the five-finger pool, stride 3.
    for (const [index, letter] of ['C', 'F', 'D', 'G', 'E'].entries()) {
      await page.getByRole('button', { name: `Answer ${letter}` }).click();
      const done = index + 1;
      await expect(page.locator('.learn-quiz__status')).toHaveText(
        done === 5 ? 'Nicely done.' : `${done} of 5`,
      );
    }
    await expect(nextButton(page)).toBeEnabled();
  });

  test('the reading drill advances only on the note shown', async ({ page }) => {
    await gotoStep(page, 'Play what you see', 3);
    await playKey(page, 'KeyA');
    for (let i = 0; i < 3; i += 1) await nextButton(page).click();
    for (const letter of ['C', 'F', 'D', 'G', 'E']) {
      await page.getByRole('button', { name: `Answer ${letter}` }).click();
    }
    await nextButton(page).click();

    await expect(page.getByRole('heading', { name: 'Play the note shown' })).toBeVisible();
    // A stave, and no note name anywhere — the picture is the whole question.
    await expect(page.locator('.learn-exercise .learn-staff__canvas')).toHaveCount(1);
    await expect(page.locator('.learn-exercise__prompt')).toHaveText('Play the note shown.');
    await expect(progressLine(page)).toHaveText('0 of 5');

    await playKey(page, 'KeyS'); // D4 — first round asks for C
    // C5 is a C too, but it is not the C that is written, and a reading round
    // is about which line the note sits on.
    await playKey(page, 'KeyK');
    await settleDrillHold(page);
    await expect(progressLine(page)).toHaveText('0 of 5');

    // Same stride-3 order: C F D G E.
    for (const [index, code] of ['KeyA', 'KeyF', 'KeyS', 'KeyG', 'KeyD'].entries()) {
      await playKey(page, code);
      const done = index + 1;
      await expect(progressLine(page)).toHaveText(done === 5 ? 'Nicely done.' : `${done} of 5`);
      await settleDrillHold(page);
    }
    await expect(nextButton(page)).toBeEnabled();
  });

  test('plays the five-note run up and back down', async ({ page }) => {
    await gotoStep(page, 'Play what you see', 3);
    await playKey(page, 'KeyA');
    for (let i = 0; i < 3; i += 1) await nextButton(page).click();
    for (const letter of ['C', 'F', 'D', 'G', 'E']) {
      await page.getByRole('button', { name: `Answer ${letter}` }).click();
    }
    await nextButton(page).click();
    for (const code of ['KeyA', 'KeyF', 'KeyS', 'KeyG', 'KeyD']) await playKey(page, code);
    await nextButton(page).click();

    await expect(page.getByRole('heading', { name: 'Play the whole run' })).toBeVisible();
    for (const code of ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG']) await playKey(page, code);
    await expect(progressLine(page)).toHaveText('Nicely done.');

    await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'And back down' })).toBeVisible();
    for (const code of ['KeyG', 'KeyF', 'KeyD', 'KeyS', 'KeyA']) await playKey(page, code);
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });
});

test.describe('chapter five', () => {
  const CHAPTER = 'The Bass Staff & the Grand Staff';

  /** The reading pool's stride-3 order, shared by the quiz and the drill. */
  const READING_LETTERS = ['C', 'F', 'D', 'G', 'E'];
  /** The same five, as keys. With the base at C3 these are C3 F3 D3 G3 E3. */
  const READING_CODES = ['KeyA', 'KeyF', 'KeyS', 'KeyG', 'KeyD'];

  /**
   * Each helper walks an already-open chapter one gate further and leaves the
   * runner on the step it names. Next is disabled until a step is satisfied,
   * so there is no way past an exercise except to play it.
   *
   * They never re-open the chapter: `session.ts` holds the open chapter in
   * module state, so going back to the outline mid-lesson lands straight back
   * in the runner rather than on the level toggle.
   */
  async function toPlayBassF(page: Page): Promise<void> {
    await nextButton(page).click(); // the bass clef
    await nextButton(page).click(); // play the F it points at
    await expect(page.getByRole('heading', { name: 'Play what you see' })).toBeVisible();
  }

  async function toQuiz(page: Page): Promise<void> {
    await toPlayBassF(page);
    await playKey(page, 'KeyF'); // F3
    // Middle C from above, the five notes, the fingering, then the quiz.
    for (let i = 0; i < 4; i += 1) await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'Which note is this?' })).toBeVisible();
  }

  async function toDrill(page: Page): Promise<void> {
    await toQuiz(page);
    for (const letter of READING_LETTERS) {
      await page.getByRole('button', { name: `Answer ${letter}` }).click();
    }
    await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'Play the note shown' })).toBeVisible();
  }

  async function toRun(page: Page): Promise<void> {
    await toDrill(page);
    for (const code of READING_CODES) {
      await playKey(page, code);
      await settleDrillHold(page);
    }
    await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'Play the whole run' })).toBeVisible();
  }

  async function toGrandStaff(page: Page): Promise<void> {
    await toRun(page);
    for (const code of ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG']) await playKey(page, code);
    await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'The two staves together' })).toBeVisible();
  }

  const canvasHeight = (page: Page) =>
    page
      .locator('.learn-staff__canvas')
      .first()
      .evaluate((el) => (el as HTMLCanvasElement).clientHeight);

  test('takes the computer keyboard down to the register it is teaching', async ({ page }) => {
    // The bass chapter is the first to park below middle C. Without the base
    // octave following the anchor, `KeyA` would sound C4 here — a note that is
    // itself on screen, so `needsRangeShift` would stay quiet and the lesson
    // would simply look broken.
    await openChapter(page, CHAPTER);
    await toPlayBassF(page);
    await expect(page.locator('.piano__range')).toContainText('C3');
    await expect(progressLine(page)).toHaveText('0 of 1');
    await expect(nextButton(page)).toBeDisabled();

    await playKey(page, 'KeyA'); // C3 — a bass note, but not the written one
    await expect(progressLine(page)).toHaveText('0 of 1');
    await playKey(page, 'KeyF'); // F3, the note the clef's two dots point at
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });

  test('draws one staff for the bass lesson and two for the grand staff', async ({ page }) => {
    // The visible proof that `staves` reached both `computeScoreGeometry` and
    // the draw view: only the geometry decides the canvas height, so a grand
    // snippet that is no taller means the two disagreed.
    await openChapter(page, CHAPTER);
    await expect(page.getByRole('heading', { name: 'There is a second stave' })).toBeVisible();
    const single = await canvasHeight(page);
    expect(single).toBeGreaterThan(0);
    expect(single).toBeLessThan(192);

    await toGrandStaff(page);
    expect(await canvasHeight(page)).toBeGreaterThan(single);
  });

  test('asks the reading quiz on a stave rather than a keyboard', async ({ page }) => {
    await openChapter(page, CHAPTER);
    await toQuiz(page);
    await expect(page.locator('.learn-quiz .learn-staff__canvas')).toHaveCount(1);
    await expect(page.locator('.learn-quiz .learn-diagram')).toHaveCount(0);
    await expect(nextButton(page)).toBeDisabled();

    for (const [index, letter] of READING_LETTERS.entries()) {
      await page.getByRole('button', { name: `Answer ${letter}` }).click();
      const done = index + 1;
      await expect(page.locator('.learn-quiz__status')).toHaveText(
        done === 5 ? 'Nicely done.' : `${done} of 5`,
      );
    }
    await expect(nextButton(page)).toBeEnabled();
  });

  test('grades a bass reading round on the exact note drawn', async ({ page }) => {
    await openChapter(page, CHAPTER);
    await toDrill(page);
    await expect(page.locator('.learn-exercise .learn-staff__canvas')).toHaveCount(1);
    await expect(progressLine(page)).toHaveText('0 of 5');

    // A C, but the octave above the one written: same letter, different line,
    // and the drawn head would still be dark.
    await playKey(page, 'KeyK');
    await settleDrillHold(page);
    await expect(progressLine(page)).toHaveText('0 of 5');

    for (const [index, code] of READING_CODES.entries()) {
      await playKey(page, code); // C3, F3, D3, G3, E3
      const done = index + 1;
      await expect(progressLine(page)).toHaveText(done === 5 ? 'Nicely done.' : `${done} of 5`);
      await settleDrillHold(page);
    }
    await expect(nextButton(page)).toBeEnabled();
  });

  test('plays one note in each hand at once', async ({ page }) => {
    await openChapter(page, CHAPTER);
    await toGrandStaff(page);
    await nextButton(page).click();
    await expect(page.getByRole('heading', { name: 'One note in each hand' })).toBeVisible();

    // Anchored at F3 so both notes fit the seven white keys a 320px phone
    // shows; the base still snaps down to the C below, which is why the left
    // hand's F3 is KeyF and middle C is KeyK.
    await expect(page.locator('.piano__range')).toContainText('F3');
    await expect(progressLine(page)).toHaveText('0 of 2');

    await page.keyboard.down('KeyF'); // F3, left hand
    await expect(progressLine(page)).toHaveText('1 of 2');
    await page.keyboard.down('KeyK'); // middle C, right hand — held together
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await page.keyboard.up('KeyK');
    await page.keyboard.up('KeyF');
    // Satisfied stays satisfied once the hands come off.
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });
});

test.describe('chapter six', () => {
  const CHAPTER = 'Rhythm & the Beat';
  /** The chapter is written, and clicked, at 60bpm in 4/4. */
  const BEAT_MS = 1000;
  const BAR_MS = BEAT_MS * 4;

  /**
   * Wall-clock ms of the click's first beat.
   *
   * Published by the runner for the same reason as `data-piano-ready`: a
   * timing-gated exercise is otherwise raced rather than driven.
   */
  async function clickOrigin(page: Page): Promise<number> {
    const section = page.locator('section[data-click-origin-ms]');
    await section.waitFor({ timeout: 30_000 });
    const value = await section.getAttribute('data-click-origin-ms');
    return Number(value);
  }

  /**
   * Play `beats` of one bar, in time, from inside the page.
   *
   * The whole take runs in a single `evaluate` so no CDP round trip sits in
   * the timing loop, and `computerKeyboard` never checks `isTrusted`, so a
   * dispatched keydown drives the real input path. Aims a bar ahead rather
   * than at the first one — the matcher accepts the pattern at any bar, so
   * there is nothing to race.
   */
  async function playInTime(
    page: Page,
    beats: readonly number[],
    options: { offsetBeats?: number } = {},
  ): Promise<void> {
    const originMs = await clickOrigin(page);
    await page.evaluate(
      async ({ originMs, beats, barMs, beatMs, offsetBeats }) => {
        const press = (): void => {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true }));
        };
        const bar = Math.ceil((performance.now() - originMs) / barMs) + 1;
        for (const beat of beats) {
          const at = originMs + bar * barMs + (beat + offsetBeats) * beatMs;
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, at - performance.now())));
          press();
        }
      },
      {
        originMs,
        beats: [...beats],
        barMs: BAR_MS,
        beatMs: BEAT_MS,
        offsetBeats: options.offsetBeats ?? 0,
      },
    );
  }

  /** Open the chapter and click Next `clicks` times, checking where we landed. */
  async function gotoStep(page: Page, heading: string, clicks: number): Promise<void> {
    for (let i = 0; i < clicks; i += 1) await nextButton(page).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  test('starts the click on the opening card, before anything is asked', async ({ page }) => {
    await openChapter(page, CHAPTER);
    await expect(page.getByRole('heading', { name: 'Listen for the pulse' })).toBeVisible();
    // The pulse has to be heard before it is graded, so the very first card
    // runs the click — a step earlier than any rhythm spec would bring it.
    expect(await clickOrigin(page)).toBeGreaterThan(0);
    // Nothing to play yet: a theory card is never gated.
    await expect(nextButton(page)).toBeEnabled();
  });

  test('credits a pulse tapped in time with the click', async ({ page }) => {
    await openChapter(page, CHAPTER);
    await gotoStep(page, 'Play along with it', 1);
    await expect(progressLine(page)).toHaveText('0 of 4');
    await expect(nextButton(page)).toBeDisabled();

    await playInTime(page, [0, 1, 2, 3]);
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });

  test('cannot be passed by mashing', async ({ page }) => {
    // The integration-level guard for the hole that would make the chapter's
    // headline validation passable by a robot.
    await openChapter(page, CHAPTER);
    await gotoStep(page, 'Play along with it', 1);
    await expect(progressLine(page)).toHaveText('0 of 4');

    await page.evaluate(async () => {
      for (let i = 0; i < 40; i += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    await expect(progressLine(page)).not.toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeDisabled();
  });

  test('rejects a rhythm played off the beat', async ({ page }) => {
    await openChapter(page, CHAPTER);
    await gotoStep(page, 'Play along with it', 1);
    // Half a beat late is twice the tolerance: in time with nothing.
    await playInTime(page, [0, 1, 2, 3], { offsetBeats: 0.5 });
    await expect(progressLine(page)).not.toHaveText('Nicely done.');
  });

  test('draws a time signature and no measure number', async ({ page }) => {
    await openChapter(page, CHAPTER);
    await gotoStep(page, 'Play along with it', 1);
    await playInTime(page, [0, 1, 2, 3]);
    await gotoStep(page, 'Beats come in bars', 1);
    // The lesson chrome exists for this: a stave that shows the bar it is
    // teaching about, without the page furniture that would come with 'full'.
    await expect(page.locator('.learn-staff__canvas')).toHaveCount(1);
  });

  test('plays a written rhythm on one pitch, rest and all', async ({ page }) => {
    await openChapter(page, CHAPTER);
    await gotoStep(page, 'Play along with it', 1);
    await playInTime(page, [0, 1, 2, 3]);
    await gotoStep(page, 'Play four quarter notes', 5);
    await playInTime(page, [0, 1, 2, 3]);
    await expect(progressLine(page)).toHaveText('Nicely done.');

    await gotoStep(page, 'Play it, rest and all', 2);
    await expect(progressLine(page)).toHaveText('0 of 3');
    // Playing *through* the rest is the failure the step is about, and the
    // hole at beat one is what ordered matching catches.
    await playInTime(page, [0, 1, 2, 3]);
    await expect(progressLine(page)).toHaveText('0 of 3');
    await playInTime(page, [0, 2, 3]);
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });
});

/**
 * Open a chapter at `step` (0-based) by seeding the saved progress, so a test
 * about a late exercise does not first have to pass every step before it.
 */
async function openChapterAt(
  page: Page,
  title: string,
  chapterId: string,
  step: number,
): Promise<void> {
  await gotoLearn(page);
  await page.evaluate(
    ({ id, seeded }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const request = database
            .transaction('metadata', 'readwrite')
            .objectStore('metadata')
            .put({
              key: 'learnProgress',
              value: { v: 1, chapters: { [id]: { step: seeded, done: false } } },
            });
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            database.close();
            resolve();
          };
        };
      }),
    { id: chapterId, seeded: step },
  );
  await page.reload();
  await openChapter(page, title);
}

/** Wall-clock ms of the lesson click's first beat; see chapter six. */
async function lessonClickOrigin(page: Page): Promise<number> {
  const section = page.locator('section[data-click-origin-ms]');
  await section.waitFor({ timeout: 30_000 });
  return Number(await section.getAttribute('data-click-origin-ms'));
}

/**
 * Play [key code, beat] presses in time with the lesson click, from inside the
 * page and a bar or two ahead so nothing is raced — chapter six's approach,
 * with a key per note. Every lesson is clicked at 60bpm in 4/4.
 */
async function playKeysInTime(
  page: Page,
  presses: readonly (readonly [string, number])[],
): Promise<void> {
  const originMs = await lessonClickOrigin(page);
  await page.evaluate(
    async ({ originMs, presses, barMs, beatMs }) => {
      const bar = Math.ceil((performance.now() - originMs) / barMs) + 1;
      for (const [code, beat] of presses) {
        const at = originMs + bar * barMs + beat * beatMs;
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, at - performance.now())));
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      }
    },
    { originMs, presses: presses.map(([code, beat]) => [code, beat]), barMs: 4000, beatMs: 1000 },
  );
}

test.describe('chapter seven', () => {
  const CHAPTER = 'Your First Melody';

  /** The computer-keyboard key for each note of the C position, from C4. */
  const KEY = { C: 'KeyA', D: 'KeyS', E: 'KeyD', F: 'KeyF', G: 'KeyG' } as const;
  type Note = keyof typeof KEY;

  /** The first phrase — the question — as [note, beat]. */
  const QUESTION: readonly (readonly [Note, number])[] = [
    ['E', 0],
    ['E', 1],
    ['F', 2],
    ['G', 3],
    ['G', 4],
    ['F', 5],
    ['E', 6],
    ['D', 7],
    ['C', 8],
    ['C', 9],
    ['D', 10],
    ['E', 11],
    ['E', 12],
    ['D', 14],
  ];
  /** The second phrase differs only in its last bar. */
  const ANSWER: readonly (readonly [Note, number])[] = [
    ...QUESTION.slice(0, 12),
    ['D', 12],
    ['C', 14],
  ];
  const WHOLE = [...QUESTION, ...ANSWER.map(([note, beat]) => [note, beat + 16] as const)];

  const openAt = (page: Page, step: number) => openChapterAt(page, CHAPTER, 'firstMelody', step);

  /** Play a line of notes in time, a key per note. */
  const playInTime = (page: Page, line: readonly (readonly [Note, number])[]) =>
    playKeysInTime(
      page,
      line.map(([note, beat]) => [KEY[note], beat] as const),
    );

  test('finds the first phrase note by note, and a wrong note starts it over', async ({ page }) => {
    await openAt(page, 3);
    await expect(page.getByRole('heading', { name: 'Find the notes first' })).toBeVisible();
    await expect(progressLine(page)).toHaveText('0 of 14');

    for (const note of ['E', 'E', 'F'] as const) await playKey(page, KEY[note]);
    await expect(progressLine(page)).toHaveText('3 of 14');
    // A is nowhere in the tune: back to the start of the phrase.
    await playKey(page, 'KeyH');
    await expect(progressLine(page)).toHaveText('0 of 14');

    for (const [note] of QUESTION) await playKey(page, KEY[note]);
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });

  test('plays the first phrase in time with the click', async ({ page }) => {
    test.setTimeout(90_000);
    await openAt(page, 4);
    await expect(page.getByRole('heading', { name: 'Now in time' })).toBeVisible();
    await expect(nextButton(page)).toBeDisabled();
    await playInTime(page, QUESTION);
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });

  test('cannot be passed by mashing on the beats', async ({ page }) => {
    test.setTimeout(90_000);
    await openAt(page, 4);
    const mash: [Note, number][] = [];
    for (let beat = 0; beat < 16; beat += 1) {
      for (const note of ['C', 'E', 'G'] as const) mash.push([note, beat]);
    }
    await playInTime(page, mash);
    await expect(progressLine(page)).not.toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeDisabled();
  });

  test('breaks the whole melody onto several lines on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openAt(page, 8);
    await expect(page.getByRole('heading', { name: 'Play the whole melody' })).toBeVisible();
    expect(await page.locator('.learn-staff__canvas').count()).toBeGreaterThan(1);
  });

  test('plays all eight bars in time', async ({ page }) => {
    test.setTimeout(120_000);
    await openAt(page, 8);
    await expect(page.getByRole('heading', { name: 'Play the whole melody' })).toBeVisible();
    await playInTime(page, WHOLE);
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });

  test('hands the melody off to Play, in right-hand Training', async ({ page }) => {
    await openAt(page, 9);
    await expect(page.getByRole('heading', { name: 'That is chapter seven' })).toBeVisible();
    await page.getByRole('button', { name: 'Practise Ode to Joy (first steps) on Play' }).click();
    await expect(page.getByText('Ode to Joy (first steps)').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => persistedSetting(page, 'playbackMode')).toBe('training-right');

    await nav(page).getByRole('button', { name: 'Learn' }).click();
    await expect(
      page.getByRole('button', { name: `Open ${CHAPTER}` }).getByText('Completed'),
    ).toBeVisible();
  });
});

test.describe('chapter eight', () => {
  const CHAPTER = 'The C Major Scale';
  const openAt = (page: Page, step: number) => openChapterAt(page, CHAPTER, 'cMajorScale', step);

  /** C4 up to C5 on the computer keyboard, from the lesson's C4 base. */
  const UP = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];

  test('shows the whole octave on the narrowest phone', async ({ page }) => {
    // Eight white keys, where a 320px phone would otherwise show seven: a
    // scale cannot stop halfway for a shift.
    await page.setViewportSize({ width: 320, height: 568 });
    await openAt(page, 6);
    await expect(page.getByRole('heading', { name: 'Play it up' })).toBeVisible();
    await expect(page.locator('.piano__range')).toHaveText('C4 – C5');
  });

  test('asks for scale degrees by number, and takes them in any octave', async ({ page }) => {
    await openAt(page, 4);
    await expect(page.getByRole('heading', { name: 'Find the degree' })).toBeVisible();
    await expect(page.getByText('Play degree 1.')).toBeVisible();
    // The C an octave up is still degree 1.
    await playKey(page, 'KeyK');
    await expect(progressLine(page)).toHaveText('1 of 5');
    await settleDrillHold(page);
    await expect(page.getByText('Play degree 4.')).toBeVisible();
    await playKey(page, 'KeyF');
    await expect(progressLine(page)).toHaveText('2 of 5');
  });

  test('plays the scale up, and a note the wrong way starts it over', async ({ page }) => {
    await openAt(page, 6);
    await expect(progressLine(page)).toHaveText('0 of 8');
    for (const code of UP.slice(0, 3)) await playKey(page, code);
    await expect(progressLine(page)).toHaveText('3 of 8');
    // Back down to D: the line is going up, so it starts again.
    await playKey(page, 'KeyS');
    await expect(progressLine(page)).toHaveText('0 of 8');
    for (const code of UP) await playKey(page, code);
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });

  test('plays the scale up and back down in time', async ({ page }) => {
    test.setTimeout(90_000);
    await openAt(page, 9);
    await expect(page.getByRole('heading', { name: 'Up and down, in time' })).toBeVisible();
    const down = [...UP].reverse().slice(1);
    await playKeysInTime(
      page,
      [...UP, ...down].map((code, beat) => [code, beat] as const),
    );
    await expect(progressLine(page)).toHaveText('Nicely done.');
  });
});

test.describe('chapter nine', () => {
  const CHAPTER = 'Triads: Major and Minor';
  const openAt = (page: Page, step: number) => openChapterAt(page, CHAPTER, 'triads', step);

  /** Hold these computer-keyboard keys down together, then let them all go. */
  async function strike(page: Page, codes: readonly string[]): Promise<void> {
    for (const code of codes) await page.keyboard.down(code);
    for (const code of codes) await page.keyboard.up(code);
  }

  test('asks major or minor by ear, and corrects a wrong answer', async ({ page }) => {
    await openAt(page, 5);
    await expect(page.getByRole('heading', { name: 'Happy or sad?' })).toBeVisible();
    // Heard, never seen: no stave and no diagram for this question.
    await expect(page.locator('.learn-quiz .learn-staff__canvas')).toHaveCount(0);
    const hear = page.getByRole('button', { name: 'Hear it' });
    await expect(hear).toBeEnabled();
    await hear.click();
    // Held while the chord sounds, so presses cannot stack copies of it.
    await expect(hear).toBeDisabled();

    await page.getByRole('button', { name: 'Answer Minor' }).click();
    await expect(page.getByText('That one was major.')).toBeVisible();
    await expect(nextButton(page)).toBeDisabled();

    // The stride asks C, E minor, D minor, G, A minor, F.
    for (const quality of ['Major', 'Minor', 'Minor', 'Major', 'Minor', 'Major']) {
      await page.getByRole('button', { name: `Answer ${quality}` }).click();
    }
    await expect(page.locator('.learn-quiz__status')).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });

  test('drills named triads, and refuses one with an extra key down', async ({ page }) => {
    await openAt(page, 7);
    await expect(page.getByText('Play C major.')).toBeVisible();
    await strike(page, ['KeyA', 'KeyD', 'KeyG']);
    await expect(progressLine(page)).toHaveText('1 of 6');
    await settleDrillHold(page);

    await expect(page.getByText('Play E minor.')).toBeVisible();
    // E–G–B with an A under it is not E minor.
    await strike(page, ['KeyH', 'KeyD', 'KeyG', 'KeyJ']);
    await expect(progressLine(page)).toHaveText('1 of 6');
    // Past the onset window, the chord alone is the chord.
    await page.waitForTimeout(500);
    await strike(page, ['KeyD', 'KeyG', 'KeyJ']);
    await expect(progressLine(page)).toHaveText('2 of 6');
  });

  test('takes a chord rolled with one mouse pointer', async ({ page }) => {
    await openAt(page, 7);
    await expect(page.getByText('Play C major.')).toBeVisible();
    const centres: { x: number; y: number }[] = [];
    for (const name of ['C4 key', 'E4 key', 'G4 key']) {
      const box = await page.locator(`.piano__keys [aria-label="${name}"]`).boundingBox();
      if (!box) throw new Error(`no ${name} on screen`);
      centres.push({ x: box.x + box.width / 2, y: box.y + box.height * 0.8 });
    }
    // Three quick clicks: a mouse cannot hold three keys, so a roll inside the
    // onset window is how it plays a chord.
    for (const { x, y } of centres) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.up();
    }
    await expect(progressLine(page)).toHaveText('1 of 6');
  });

  test('turns C major minor by moving one note', async ({ page }) => {
    await openAt(page, 9);
    await expect(page.getByRole('heading', { name: 'Make it minor' })).toBeVisible();
    await expect(progressLine(page)).toHaveText('0 of 2');
    for (const code of ['KeyA', 'KeyD', 'KeyG']) await page.keyboard.down(code);
    await expect(progressLine(page)).toHaveText('1 of 2');
    // The E comes up, the E flat goes down; C and G stay held.
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyE');
    await expect(progressLine(page)).toHaveText('Nicely done.');
    for (const code of ['KeyA', 'KeyE', 'KeyG']) await page.keyboard.up(code);
  });
});

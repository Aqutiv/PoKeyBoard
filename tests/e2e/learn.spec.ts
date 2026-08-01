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
}

async function openChapterOne(page: Page): Promise<void> {
  await openChapter(page, 'Meet the Keyboard');
}

/** The white keys of one octave from middle C, in alphabet order. */
const WALK_UP = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];

const progressLine = (page: Page) => page.locator('.learn-exercise__progress');
const nextButton = (page: Page) => page.getByRole('button', { name: 'Next' });

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

/** Press and release a computer-keyboard note (KeyA is C4). */
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
      await expect(chapterButtons(page), level).toHaveCount(10);
    }
  });

  test('groups each level into three named parts', async ({ page }) => {
    await gotoLearn(page);
    await expect(page.locator('.learn-part__heading')).toHaveText([
      'The instrument',
      'Reading music',
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
    ]) {
      await expect(page.getByRole('button', { name: `Open ${title}` })).toBeEnabled();
    }
    await expect(
      page.getByRole('button', { name: 'Reading the Treble Staff — coming soon' }),
    ).toBeDisabled();
    await expect(page.getByText('Coming soon')).toHaveCount(7);
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
    await expect(progressLine(page)).toHaveText('0 of 5');

    await playKey(page, 'KeyW'); // C#4 is D♭
    await expect(progressLine(page)).toHaveText('1 of 5');
    await expect(page.locator('.learn-exercise__prompt')).toHaveText('Play A♭.');

    for (const code of ['KeyY', 'KeyE', 'KeyU', 'KeyT']) await playKey(page, code);
    await expect(progressLine(page)).toHaveText('Nicely done.');
    await expect(nextButton(page)).toBeEnabled();
  });
});

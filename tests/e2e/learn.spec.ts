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

/** Open chapter 1 and wait for the core samples, or input emits nothing. */
async function openChapterOne(page: Page): Promise<void> {
  await gotoLearn(page);
  await page.getByRole('button', { name: 'Open Meet the Keyboard' }).click();
  await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
}

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

  test('lists ten beginner and nine advanced chapters', async ({ page }) => {
    await gotoLearn(page);
    await expect(levels(page).getByRole('button', { name: 'Beginner' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chapterButtons(page)).toHaveCount(10);

    await levels(page).getByRole('button', { name: 'Advanced' }).click();
    await expect(chapterButtons(page)).toHaveCount(9);
  });

  test('remembers the level across a reload', async ({ page }) => {
    await gotoLearn(page);
    await levels(page).getByRole('button', { name: 'Advanced' }).click();
    await expect(chapterButtons(page)).toHaveCount(9);
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

  test('unlocks only the first chapter', async ({ page }) => {
    await gotoLearn(page);
    await expect(page.getByRole('button', { name: 'Open Meet the Keyboard' })).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'The Musical Alphabet — coming soon' }),
    ).toBeDisabled();
    await expect(page.getByText('Coming soon')).toHaveCount(9);
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
});

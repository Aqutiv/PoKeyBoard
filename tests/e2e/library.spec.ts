import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { nav } from './helpers';

/** The folder switch (its option names would otherwise clash with track titles). */
function folders(page: Page) {
  return page.getByRole('group', { name: 'Library folder' });
}

function trackButtons(page: Page) {
  return page.getByRole('button', { name: /^Open / });
}

async function gotoLibrary(page: Page): Promise<void> {
  await page.goto('/#/library');
  await expect(folders(page)).toBeVisible();
}

async function openClassics(page: Page): Promise<void> {
  await gotoLibrary(page);
  await folders(page).getByRole('button', { name: 'Classics' }).click();
}

/**
 * A persisted setting, read straight out of IndexedDB (db.ts: database
 * `pokeyboard`, store `settings`, keyed by name). Settings writes are debounced,
 * so a reload-based test waits for the write itself rather than for a guessed
 * interval to elapse.
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

test.describe('library folders', () => {
  test('opens on Originals and shelves the classics separately', async ({ page }) => {
    await gotoLibrary(page);
    await expect(folders(page).getByRole('button', { name: 'Originals' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(trackButtons(page)).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Open A Beautiful Day' })).toBeVisible();

    await folders(page).getByRole('button', { name: 'Classics' }).click();
    // Three authored transcriptions plus the vendored pack.
    expect(await trackButtons(page).count()).toBeGreaterThan(50);
    await expect(page.getByRole('button', { name: 'Open Für Elise', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open A Beautiful Day' })).toHaveCount(0);
  });

  test('restores the folder last opened after a reload', async ({ page }) => {
    await openClassics(page);
    // The settings writer debounces 500 ms; a reload inside that window would
    // race the write rather than test the restore.
    await expect.poll(() => persistedSetting(page, 'libraryFolder')).toBe('classics');

    await page.reload();
    await expect(folders(page).getByRole('button', { name: 'Classics' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Open Für Elise', exact: true })).toBeVisible();
  });

  test('comes back to where the list was left, but starts at the top after a reload', async ({
    page,
  }) => {
    await openClassics(page);
    const groups = page.locator('.library-groups');
    // Scrolled by reaching for a track well down the list, not by setting an
    // offset: the track that gets opened has to be one the click does not scroll
    // back to the top to reach.
    const track = page.getByRole('button', { name: 'Open Canon in D', exact: true });
    await track.scrollIntoViewIfNeeded();
    const offset = await groups.evaluate((el) => el.scrollTop);
    expect(offset).toBeGreaterThan(0);

    await track.click();
    await expect(page.locator('.play-header__title')).toHaveText('Canon in D');
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await expect(folders(page)).toBeVisible();
    await expect.poll(() => groups.evaluate((el) => el.scrollTop)).toBe(offset);

    // Deliberately session-only: the place is held in memory, not persisted.
    await page.reload();
    await expect(folders(page)).toBeVisible();
    await expect.poll(() => groups.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('opens an authored classic on Play as an unmodifiable library take', async ({ page }) => {
    await openClassics(page);
    await page.getByRole('button', { name: 'Open Für Elise', exact: true }).click();

    await expect(page.locator('.play-header__title')).toHaveText('Für Elise');
    await expect(page.locator('.play-header__library')).toHaveText('Library');
  });
});

test.describe('vendored classics', () => {
  test('lists the pack without fetching any score', async ({ page }) => {
    const scoreRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/scores/')) scoreRequests.push(request.url());
    });

    await openClassics(page);
    // The list renders from the generated manifest; 1.2 MB of scores must not
    // be pulled just to show titles.
    expect(scoreRequests).toEqual([]);
    // Vendored entries carry no description, so only the authored three do.
    expect(await page.locator('.library-item__description').count()).toBe(3);
  });

  test('files the pack under composer headings, authored tracks on top', async ({ page }) => {
    await gotoLibrary(page);
    // The smaller Originals folder needs no grouping.
    await expect(page.locator('.library-group__heading')).toHaveCount(0);

    await folders(page).getByRole('button', { name: 'Classics' }).click();
    const headings = page.locator('.library-group__heading');
    expect(await headings.count()).toBeGreaterThan(10);
    await expect(headings.first()).toContainText('Johann Sebastian Bach');
    await expect(headings.first()).toContainText('tracks');

    // The three authored tracks sit above the first heading.
    const firstHeadingTop = (await headings.first().boundingBox())?.y ?? 0;
    const authoredTop =
      (await page.getByRole('button', { name: 'Open Für Elise', exact: true }).boundingBox())?.y ??
      Number.MAX_SAFE_INTEGER;
    expect(authoredTop).toBeLessThan(firstHeadingTop);
  });

  test('filters by title or composer, without fetching anything', async ({ page }) => {
    const scoreRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/scores/')) scoreRequests.push(request.url());
    });

    await gotoLibrary(page);
    // The smaller Originals folder needs no filter.
    await expect(page.getByRole('searchbox', { name: 'Filter classics' })).toHaveCount(0);

    await folders(page).getByRole('button', { name: 'Classics' }).click();
    const filter = page.getByRole('searchbox', { name: 'Filter classics' });
    await expect(filter).toBeVisible();
    const unfiltered = await trackButtons(page).count();

    await filter.fill('nocturne');
    expect(await trackButtons(page).count()).toBeLessThan(unfiltered);
    await expect(page.getByRole('button', { name: /Open Nocturne/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Canon in D', exact: true })).toHaveCount(0);

    // Accents are optional: "fur elise" reaches "Für Elise".
    await filter.fill('fur elise');
    await expect(page.getByRole('button', { name: 'Open Für Elise', exact: true })).toBeVisible();

    // Both tokens count, in either order.
    await filter.fill('chopin waltz');
    const headings = page.locator('.library-group__heading');
    await expect(headings).toHaveCount(1);
    await expect(headings.first()).toContainText('Frédéric Chopin');

    await filter.fill('zzzz nothing here');
    await expect(trackButtons(page)).toHaveCount(0);
    await expect(page.locator('.library-empty')).toContainText('Nothing matches');

    // The clear button restores the full list.
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(filter).toHaveValue('');
    expect(await trackButtons(page).count()).toBe(unfiltered);

    // None of that touched the network.
    expect(scoreRequests).toEqual([]);
  });

  test('fetches and parses a score on open', async ({ page }) => {
    const scoreRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/scores/')) scoreRequests.push(request.url());
    });

    await openClassics(page);
    await page.getByRole('button', { name: 'Open La campanella' }).click();

    await expect(page.locator('.play-header__title')).toHaveText('La campanella');
    await expect(page.locator('.play-header__library')).toHaveText('Library');
    // Exactly one score fetched: the one that was opened.
    expect(scoreRequests).toHaveLength(1);
    expect(scoreRequests[0]).toContain('.mxl');
    // A real take came out of it, so the transport knows its length.
    await expect(page.locator('.transport__time')).not.toHaveText(/\/ 0:00\.0/);
  });
});

// With the service worker active a score is fetched *by* the worker, which
// page.route cannot intercept — blocking it puts the request back on the page
// so a slow or failing download can be simulated at all. Stated explicitly
// rather than left to the suite default, which real-pack runs flip.
test.describe('vendored classics on a bad network', () => {
  test.use({ serviceWorkers: 'block' });

  test('says so when a score cannot be fetched', async ({ page }) => {
    await openClassics(page);
    await page.route('**/scores/**', (route) => route.abort());
    await page.getByRole('button', { name: 'Open Gnossienne No. 1' }).click();

    await expect(page.getByRole('status')).toHaveText(/could not be opened/);
    // Still on the Library, not stranded on an empty Play screen.
    await expect(folders(page)).toBeVisible();
  });

  test('a score that lands after you leave does not drag you to Play', async ({ page }) => {
    await openClassics(page);
    await page.route('**/scores/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await page.getByRole('button', { name: 'Open La campanella' }).click();
    // Walk away mid-download; the later choice is the one that should stand.
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    await expect(page).toHaveURL(/#\/takes/);

    // Long enough for the download to have finished and activated the score.
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(/#\/takes/);
    await expect(page.locator('.play-header__title')).toHaveCount(0);
  });
});

import { expect, type Locator, type Page } from '@playwright/test';

/** The transport control group (avoids clashing with nav button names). */
export function transport(page: Page): Locator {
  return page.getByRole('group', { name: 'Transport' });
}

/** Bottom navigation (its "Play"/"Takes" names clash with other buttons). */
export function nav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' });
}

/** The Settings section switch (Sound, Playing, Display, App). */
export function settingsSections(page: Page): Locator {
  return page.getByRole('group', { name: 'Settings section' });
}

export type SettingsSectionName = 'Sound' | 'Playing' | 'Display' | 'App';

/**
 * Open Settings from the nav. It opens on the section last shown — Sound on a
 * fresh visit — so a test that needs another one names it.
 */
export async function openSettings(page: Page, section?: SettingsSectionName): Promise<void> {
  await nav(page).getByRole('button', { name: 'Settings' }).click();
  if (section) await chooseSettingsSection(page, section);
}

/** Switch to a section of the Settings page already open. */
export async function chooseSettingsSection(
  page: Page,
  section: SettingsSectionName,
): Promise<void> {
  // Exact: "App" alone would also match "Apply update and reload".
  await settingsSections(page).getByRole('button', { name: section, exact: true }).click();
}

/** Fresh app visit: navigate and wait for the piano core pack to decode. */
export async function gotoAppReady(page: Page): Promise<void> {
  await page.goto('/');
  // Deterministic readiness signal: every core sample is decoded.
  await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'C4 key' })).toBeVisible();
}

/**
 * Open `take` (a take's JSON, as TAKE_FORMAT.md writes it) the way a user
 * imports a file: picked on Takes, then confirmed in the import preview,
 * which lands on Play with it open.
 */
export async function importTake(page: Page, take: { title: string }): Promise<void> {
  await nav(page).getByRole('button', { name: 'Takes' }).click();
  await page.getByLabel('Import take JSON file').setInputFiles({
    name: `PoKeyBoard - ${take.title}.pokeyboard.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(take)),
  });
  await page
    .getByRole('dialog', { name: 'Import take' })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: take.title })).toBeVisible();
}

/** Set the count-in selector (recording tests want zero). */
export async function setCountIn(page: Page, value: '0' | '1' | '2'): Promise<void> {
  const select = page.getByLabel('Count-in length');
  // Portrait phones fold count-in away behind the metronome's "⋯" button.
  if (!(await select.isVisible())) {
    await page.getByRole('button', { name: 'More metronome settings' }).click();
  }
  await select.selectOption(value);
}

/**
 * Record a short two-note pass with the computer keyboard. `noteMs` is how long
 * each key is held — the only unavoidable real time in the suite, since a take
 * has to have a duration. The default is the shortest hold that still reads as
 * a staccato note; tests that need to watch playback advance mid-flight pass
 * something longer.
 */
export async function recordShortTake(page: Page, noteMs = 120): Promise<void> {
  await setCountIn(page, '0');
  await transport(page).getByRole('button', { name: 'Record, inactive' }).click();
  await expect(page.getByText('● Recording')).toBeVisible();
  await page.keyboard.down('KeyA'); // C4
  await page.waitForTimeout(noteMs);
  await page.keyboard.up('KeyA');
  await page.keyboard.down('KeyD'); // E4
  await page.waitForTimeout(noteMs);
  await page.keyboard.up('KeyD');
  await transport(page).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('● Recording')).toHaveCount(0);
  // Autosave confirmation so reload-based tests are safe.
  await expect(page.getByText('Saved locally')).toBeVisible({ timeout: 10_000 });
}

/** The transport time display, e.g. "0:00.0 / 0:01.2". */
export function transportTime(page: Page) {
  return page.locator('.transport__time');
}

export async function totalDurationText(page: Page): Promise<string> {
  const text = (await transportTime(page).textContent()) ?? '';
  return text.split('/')[1]?.trim() ?? '';
}

/**
 * A persisted setting, read straight out of IndexedDB (db.ts: database
 * `pokeyboard`, store `settings`, keyed by name). Settings writes are debounced,
 * so a reload-based test waits for the write itself rather than for a guessed
 * interval to elapse.
 */
export function persistedSetting(page: Page, key: string): Promise<unknown> {
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

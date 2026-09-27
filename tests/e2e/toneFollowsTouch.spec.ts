import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, nav } from './helpers';

/**
 * Tone follows touch, through the built app: a grand's note plays through its
 * tone filter while the setting is on, and without one once it is switched off
 * — at once, and after a reload, when the stored setting is what the engine
 * starts with.
 *
 * The suite's stub pack holds the medium layer, and a computer-keyboard note
 * (velocity 0.75) plays that layer partway up its ramp: filtered, tone on.
 */

/** What the page has made since it loaded: tone filters, and notes sounded from a recording. */
interface ToneProbe {
  lowpasses: BiquadFilterNode[];
  voices: number;
}

/** One settings row as persisted, read straight out of IndexedDB. */
async function storedSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (settingKey) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('pokeyboard');
        open.onerror = () => reject(new Error('could not open the database'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('settings').objectStore('settings').get(settingKey);
          request.onerror = () => reject(new Error('could not read the setting'));
          request.onsuccess = () => {
            db.close();
            resolve((request.result as { value?: unknown } | undefined)?.value);
          };
        };
      }),
    key,
  );
}

async function heard(page: Page): Promise<{ toneFilters: number; voices: number }> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __toneProbe: ToneProbe }).__toneProbe;
    return {
      // A voice's tone filter is a lowpass at TONE_FILTER_Q_DB, −3.1.
      toneFilters: probe.lowpasses.filter(
        (filter) => filter.type === 'lowpass' && Math.abs(filter.Q.value + 3.1) < 1e-3,
      ).length,
      voices: probe.voices,
    };
  });
}

async function holdKey(page: Page, key: string, ms = 120): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

function readyKeyboard(page: Page) {
  return page.locator('section[data-piano-ready="true"]');
}

test.describe('tone follows touch', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const probe: ToneProbe = { lowpasses: [], voices: 0 };
      Object.assign(window, { __toneProbe: probe });
      const createBiquadFilter = BaseAudioContext.prototype.createBiquadFilter;
      BaseAudioContext.prototype.createBiquadFilter = function (this: BaseAudioContext) {
        const filter = createBiquadFilter.call(this);
        probe.lowpasses.push(filter);
        return filter;
      };
      // Every sample voice starts a source on a decoded recording; the
      // one-frame buffer that unlocks iOS audio is not one.
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (
        this: AudioBufferSourceNode,
        ...args: Parameters<AudioBufferSourceNode['start']>
      ) {
        if (this.buffer && this.buffer.duration > 1) probe.voices += 1;
        return start.apply(this, args);
      };
    });
  });

  test('filters a grand’s notes by touch until switched off, and remembers it', async ({
    page,
  }) => {
    await gotoAppReady(page);

    // On by default: C4 plays through its tone filter.
    await holdKey(page, 'KeyA');
    await expect.poll(async () => (await heard(page)).toneFilters).toBeGreaterThan(0);

    await nav(page).getByRole('button', { name: 'Settings' }).click();
    const toggle = page.getByRole('checkbox', { name: 'Tone follows touch' });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    // Settings save on a debounce; the reload below waits for the row.
    await expect.poll(() => storedSetting(page, 'toneFollowsTouch')).toBe(false);

    // Off: the next note sounds, and opens no filter.
    await nav(page).getByRole('button', { name: 'Play' }).click();
    await readyKeyboard(page).waitFor();
    const before = await heard(page);
    await holdKey(page, 'KeyA');
    await expect.poll(async () => (await heard(page)).voices).toBeGreaterThan(before.voices);
    expect((await heard(page)).toneFilters).toBe(before.toneFilters);

    // After a reload the engine starts out with the tone off.
    await page.reload();
    await readyKeyboard(page).waitFor({ timeout: 30_000 });
    await holdKey(page, 'KeyA');
    await expect.poll(async () => (await heard(page)).voices).toBeGreaterThan(0);
    expect((await heard(page)).toneFilters).toBe(0);
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('checkbox', { name: 'Tone follows touch' })).not.toBeChecked();
  });
});

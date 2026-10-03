import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, nav, transport } from './helpers';

/**
 * An idle app leaves the audio thread and the CPU alone: the scheduler's pulse
 * runs only while something plays, and with the page away the audio device
 * sleeps once the last sound has died, waking as the page comes back.
 *
 * The page's AudioContext and the pulses its worklet posts are counted by a
 * script installed before the app loads.
 */

declare global {
  interface Window {
    __contexts: AudioContext[];
    __pulses: number;
  }
}

async function countAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__contexts = [];
    window.__pulses = 0;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.__contexts.push(this);
      }
    };
    const NativeWorklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        this.port.addEventListener('message', () => {
          window.__pulses += 1;
        });
      }
    };
  });
}

const pulses = (page: Page) => page.evaluate(() => window.__pulses);
const contextState = (page: Page) => page.evaluate(() => window.__contexts[0]?.state);

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    Object.defineProperty(document, 'hidden', { configurable: true, value: value === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test.describe('the audio at rest', () => {
  test('the scheduler pulses only while a take plays', async ({ page }) => {
    await countAudio(page);
    await gotoAppReady(page);
    const idleFrom = await pulses(page);
    await page.waitForTimeout(500);
    expect(await pulses(page)).toBe(idleFrom);

    await nav(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Open A Beautiful Day' }).click();
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    const playingFrom = await pulses(page);
    await expect.poll(() => pulses(page)).toBeGreaterThan(playingFrom + 5);
  });

  test('sleeps while the page is away, and plays at once when it is back', async ({ page }) => {
    await countAudio(page);
    await gotoAppReady(page);
    await page.getByRole('button', { name: 'C4 key' }).click();
    await expect.poll(() => contextState(page)).toBe('running');

    await setVisibility(page, 'hidden');
    // Asleep once the release and the room's tail (Room: 3 s) have passed.
    await expect.poll(() => contextState(page), { timeout: 10_000 }).toBe('suspended');

    await setVisibility(page, 'visible');
    await expect.poll(() => contextState(page)).toBe('running');
    await page.keyboard.down('KeyA');
    await expect(page.getByRole('button', { name: 'C4 key' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.up('KeyA');
  });

  test('stays awake through a short look away', async ({ page }) => {
    await countAudio(page);
    await gotoAppReady(page);
    await page.getByRole('button', { name: 'C4 key' }).click();
    await expect.poll(() => contextState(page)).toBe('running');

    await setVisibility(page, 'hidden');
    await page.waitForTimeout(300);
    await setVisibility(page, 'visible');
    await page.waitForTimeout(3_500);
    expect(await contextState(page)).toBe('running');
  });
});

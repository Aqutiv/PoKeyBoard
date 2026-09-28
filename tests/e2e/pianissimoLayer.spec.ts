import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { SamplePackManifest } from '../../src/audio/audioTypes';
import { pianoInstrument } from '../../src/audio/instruments';
import { gotoAppReady, nav } from './helpers';

// Read from the registry so a pack-version bump cannot leave these stale.
const SALAMANDER_PACK = pianoInstrument('salamander-grand').packVersion;
const MANIFEST = JSON.parse(
  readFileSync(path.resolve('public', 'piano', SALAMANDER_PACK, 'manifest.json'), 'utf8'),
) as SamplePackManifest;
const PIANISSIMO = MANIFEST.velocityLayers.find((layer) => layer.label === 'pianissimo')!.index;

/**
 * Every file the pack keeps in its own directory is a pianissimo recording:
 * the other layers it lists by where the generation before published them
 * (`../salamander-grand-v3/…`). So a route on the directory holds exactly
 * the pianissimo layer.
 */
const OWN_FILES = MANIFEST.files.filter((entry) => !entry.file.startsWith('../'));

/** The pianissimo recordings of the core's keys, which the piano fetches once it plays. */
const CORE_PIANISSIMO = MANIFEST.files
  .filter((entry) => entry.layer === PIANISSIMO && entry.pack === 'core')
  .map((entry) => entry.file);

/**
 * Holds every request for the pack's own files until `release`, recording
 * which were asked for.
 */
async function holdPianissimo(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const asked = new Set<string>();
  await page.route(`**/${SALAMANDER_PACK}/*.sample`, async (route) => {
    asked.add(path.posix.basename(new URL(route.request().url()).pathname));
    await gate;
    await route.continue();
  });
  return { asked, release };
}

test.describe('the pianissimo layer', () => {
  // The real pack, and its own recordings; the routes need the service
  // worker out of the way.
  test.use({ samplePack: 'real', serviceWorkers: 'block' });

  test('is all the pack keeps in its own directory', () => {
    expect(OWN_FILES.length).toBeGreaterThan(0);
    expect(OWN_FILES.every((entry) => entry.layer === PIANISSIMO)).toBe(true);
    expect(CORE_PIANISSIMO.length).toBeGreaterThan(0);
  });

  test('follows the piano once it plays, never holding it up or taking its readiness away', async ({
    page,
  }) => {
    // Every value the readiness flag takes, from the first paint on.
    await page.addInitScript(() => {
      const seen: string[] = [];
      Object.assign(window, { __readiness: seen });
      const note = () => {
        const value =
          document.querySelector('section[data-piano-ready]')?.getAttribute('data-piano-ready') ??
          'absent';
        if (seen.at(-1) !== value) seen.push(value);
      };
      new MutationObserver(note).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-piano-ready'],
      });
    });
    const readiness = () =>
      page.evaluate(() => (window as unknown as { __readiness: string[] }).__readiness);
    const pianissimo = await holdPianissimo(page);

    // Ready, with every pianissimo recording held back...
    await gotoAppReady(page);
    // ...which it asks for now that it plays. (Only as many as the browser has
    // connections for reach the route while they are held; the rest queue.)
    await expect.poll(() => pianissimo.asked.size).toBeGreaterThan(0);
    await expect(page.locator('section[data-piano-ready="true"]')).toBeVisible();

    const finished = new Set<string>();
    page.on('requestfinished', (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes(`/${SALAMANDER_PACK}/`)) {
        finished.add(path.posix.basename(url.pathname));
      }
    });
    pianissimo.release();
    // The core's keys, every one.
    await expect
      .poll(() => CORE_PIANISSIMO.filter((file) => finished.has(file)).length, {
        timeout: 15_000,
      })
      .toBe(CORE_PIANISSIMO.length);
    // Once ready, the piano stayed ready while they loaded.
    const seen = await readiness();
    expect(seen).toContain('true');
    expect(seen.slice(seen.indexOf('true'))).not.toContain('false');
    await expect(page.locator('section[data-piano-ready="true"]')).toBeVisible();
  });

  test('is waited for by an export whose soft notes ask for it', async ({ page }) => {
    const pianissimo = await holdPianissimo(page);
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    // Three soft notes, under the pianissimo layer's 0.30, on core keys.
    const take = {
      schemaVersion: 1,
      id: 'e2e-pianissimo-0000-000000000001',
      title: 'Pianissimo',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
      durationMs: 1400,
      samplePackVersion: SALAMANDER_PACK,
      tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 0 },
      instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
      notes: [
        { id: 'a', midi: 60, startMs: 0, durationMs: 400, velocity: 0.2 },
        { id: 'b', midi: 64, startMs: 500, durationMs: 400, velocity: 0.2 },
        { id: 'c', midi: 67, startMs: 1000, durationMs: 400, velocity: 0.2 },
      ],
      pedalEvents: [],
      display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
    };
    await page.getByLabel('Import take JSON file').setInputFiles({
      name: 'pianissimo.pokeyboard.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(take)),
    });
    await page
      .getByRole('dialog', { name: 'Import take' })
      .getByRole('button', { name: 'Import', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: take.title })).toBeVisible();

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Audio (MP3, FLAC)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export audio' });
    await dialog.getByRole('button', { name: 'Render audio' }).click();
    // A take this short renders in well under a second once it starts; held,
    // it waits for the recordings its notes ask for rather than rendering the
    // soft ones that stand in for them live.
    await expect(dialog.getByText('Rendering piano…')).toBeVisible();
    await page.waitForTimeout(3_000);
    await expect(dialog.getByText(/Audio ready/)).toBeHidden();

    pianissimo.release();
    await expect(dialog.getByText(/Audio ready/)).toBeVisible({ timeout: 30_000 });
  });

  test('is saved for offline use with the recordings the pack re-uses, each once', async ({
    page,
  }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Settings' }).click();
    const card = page
      .locator('.piano-card')
      .filter({ has: page.locator('strong', { hasText: /^Salamander$/ }) });
    await card.getByRole('button', { name: /^Download / }).click();
    await expect(card.getByRole('button', { name: /^Delete / })).toBeVisible({ timeout: 60_000 });

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys())
        for (const key of await (await caches.open(name)).keys()) urls.push(key.url);
      return urls;
    });
    const files = cached
      .filter((url) => url.endsWith('.sample'))
      .map((url) => new URL(url).pathname.replace(/^.*\/piano\//, ''));
    // Each at the URL its own pack published it at — never through `..`.
    const expected = MANIFEST.files.map((entry) =>
      entry.file.startsWith('../') ? entry.file.slice(3) : `${SALAMANDER_PACK}/${entry.file}`,
    );
    expect(files.filter((file) => file.startsWith('salamander-grand-')).sort()).toEqual(
      expected.sort(),
    );
    expect(cached.some((url) => url.includes('/../'))).toBe(false);
  });
});

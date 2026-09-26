import { expect, test } from './fixtures';
import { gotoAppReady, nav, recordShortTake, transport } from './helpers';
import type { TakeRow } from '../../src/data/db';
import type { SamplePackManifest } from '../../src/audio/audioTypes';

test.use({ viewport: { width: 1440, height: 900 } });

test('an optional range sample failure leaves the decoded core available for playback and recording', async ({
  page,
}) => {
  await page.route('**/salamander-grand-v3/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as SamplePackManifest;
    manifest.files = manifest.files.filter((file) => file.pack === 'core');
    manifest.files.push({
      file: 'unavailable-extra.sample',
      midi: 108,
      layer: 1,
      pack: 'full',
      bytes: 1,
    });
    await route.fulfill({ json: manifest });
  });
  await page.route('**/unavailable-extra.sample', (route) =>
    route.fulfill({ status: 503, body: '' }),
  );
  await gotoAppReady(page);
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Open Where Starlight Lingers' }).click();
  // The full keyboard requests the optional high root after the core is decoded.
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expect(page.getByRole('alert')).toContainText('could not be loaded', { timeout: 15_000 });
  const play = transport(page).getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled();
  await expect(transport(page).getByRole('button', { name: 'Record, inactive' })).toBeEnabled();
  await play.click();
  await expect(transport(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await nav(page).getByRole('button', { name: 'Settings' }).click();
  const bar = page.getByRole('complementary', { name: 'Now playing' });
  await bar.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await bar.getByRole('button', { name: 'Resume', exact: true }).click();
  await bar.getByRole('button', { name: 'Stop', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Count-in length')).toBeVisible();
  await recordShortTake(page);
});

/**
 * Tags every sample voice with the pack its recording came from: the bytes by
 * the URL they were fetched from, the decoded buffer by those bytes, and each
 * voice started by its buffer. The one-frame buffer that unlocks iOS audio was
 * never fetched, so it is not counted.
 */
function tagVoicesByPack(): void {
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
  const packs: string[] = [];
  Object.assign(window, { __voicePacks: packs });
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (
    this: AudioBufferSourceNode,
    ...args: Parameters<AudioBufferSourceNode['start']>
  ) {
    const url = this.buffer ? urlOf.get(this.buffer) : undefined;
    const pack = url ? /\/piano\/([^/]+)\//.exec(url)?.[1] : undefined;
    if (pack) packs.push(pack);
    return start.apply(this, args);
  };
}

test.describe('switching piano during playback', () => {
  // The switch is held open by routing the new pack's samples, which only works
  // with the service worker out of the way — under POKEYBOARD_E2E_REAL_PACK too.
  test.use({ serviceWorkers: 'block' });

  for (const origin of ['Play', 'Settings']) {
    test(`piano switching from ${origin} keeps playback running, and the new piano takes over`, async ({
      page,
    }) => {
      await page.addInitScript(tagVoicesByPack);
      const voicePacks = () =>
        page.evaluate(() => [...(window as unknown as { __voicePacks: string[] }).__voicePacks]);
      await gotoAppReady(page);
      await nav(page).getByRole('button', { name: 'Library' }).click();
      await page.getByRole('button', { name: 'Open Where Starlight Lingers' }).click();
      await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/headroom-grand-v2/*.sample', async (route) => {
        await gate;
        await route.continue();
      });
      try {
        if (origin === 'Settings') {
          await nav(page).getByRole('button', { name: 'Settings' }).click();
          await page.getByRole('radio', { name: /^Headroom/ }).check();
          await expect(page.getByText('Loading the new piano…')).toBeVisible();
          // Nothing is locked while it loads: the music plays on, and another
          // piano can still be chosen.
          await expect(page.getByRole('radio', { name: /^Salamander/ })).toBeEnabled();
          const bar = page.getByRole('complementary', { name: 'Now playing' });
          await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
          await bar.getByRole('button', { name: 'Now playing: Where Starlight Lingers' }).click();
        } else {
          await page
            .getByRole('combobox', { name: 'Piano', exact: true })
            .selectOption('headroom-grand');
        }
        const picker = page.getByRole('combobox', { name: 'Piano', exact: true });
        await expect(picker).toBeEnabled();
        await expect(picker).toHaveValue('headroom-grand');
        await expect(page.getByText('Loading the new piano…')).toBeVisible();
        await expect(
          transport(page).getByRole('button', { name: 'Pause', exact: true }),
        ).toBeVisible();
        // A pass is played on one piano from its first note, so recording waits.
        await expect(
          transport(page).getByRole('button', { name: 'Record, inactive' }),
        ).toBeDisabled();
        // The music goes on, on the piano it was playing.
        const position = await page.locator('.transport__time').innerText();
        await expect(page.locator('.transport__time')).not.toHaveText(position);
        const heard = await voicePacks();
        expect(heard).toContain('salamander-grand-v3');
        expect(heard).not.toContain('headroom-grand-v2');

        release();
        // The real pack decodes some seventy files here: its core and the take's keys.
        await expect(page.getByText('Loading the new piano…')).toBeHidden({ timeout: 30_000 });
        await expect(
          transport(page).getByRole('button', { name: 'Record, inactive' }),
        ).toBeEnabled();
        // Every note from the take-over on is the new piano's.
        await expect
          .poll(async () => (await voicePacks()).slice(heard.length))
          .toContain('headroom-grand-v2');
        await expect(
          transport(page).getByRole('button', { name: 'Pause', exact: true }),
        ).toBeVisible();
      } finally {
        release();
      }
    });
  }
});

for (const width of [1440, 390]) {
  test(`Now playing remains reachable throughout a long Takes list at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoAppReady(page);
    await recordShortTake(page);
    // Seed a genuinely overflowing list in this test's isolated browser database.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('pokeyboard');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('takes', 'readwrite');
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
            const store = tx.objectStore('takes');
            const rows = store.getAll();
            rows.onsuccess = () => {
              const template = (rows.result as TakeRow[])[0]!;
              for (let i = 0; i < 40; i += 1) {
                const id = `scroll-test-${i}`;
                const title = `Scrolling take ${i}`;
                store.put({
                  ...template,
                  id,
                  title,
                  takeJson: JSON.stringify({ ...JSON.parse(template.takeJson), id, title }),
                });
              }
            };
          };
        }),
    );
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Open Where Starlight Lingers' }).click();
    await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
    await nav(page).getByRole('button', { name: 'Takes', exact: true }).click();
    await expect(page.locator('.take-item')).toHaveCount(41);
    const bar = page.getByRole('complementary', { name: 'Now playing' });
    const before = await bar.boundingBox();
    await page.locator('.take-item').last().scrollIntoViewIfNeeded();
    expect(
      await page.locator('.app-shell__viewport').evaluate((el) => el.scrollTop),
    ).toBeGreaterThan(500);
    const after = await bar.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(after!.y + after!.height).toBeLessThanOrEqual(900);
    await bar.getByRole('button', { name: 'Pause', exact: true }).click();
    await bar.getByRole('button', { name: 'Resume', exact: true }).click();
    await bar.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(bar).toHaveCount(0);
  });
}

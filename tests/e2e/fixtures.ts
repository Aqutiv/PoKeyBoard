import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test as base } from '@playwright/test';
import type { SamplePackFileEntry, SamplePackManifest } from '../../src/audio/audioTypes';

/** Mirrors SAMPLE_PACK_PATH in src/audio/AudioEngine.ts. */
const PACK_DIR = 'piano/salamander-grand-v2';

/** MAX_ROOT_DISTANCE_SEMITONES in src/audio/SampleBank.ts. */
const MAX_ROOT_DISTANCE = 9;

/** The medium layer: getSample falls back to it from any velocity. */
const STUB_LAYER = 1;

/** The 88-key range the app can display (FULL_RANGE_LOW/HIGH). */
const LOWEST_KEY = 21;
const HIGHEST_KEY = 108;

const realManifest = JSON.parse(
  readFileSync(path.resolve('public', PACK_DIR, 'manifest.json'), 'utf8'),
) as SamplePackManifest;

/**
 * A manifest holding one velocity layer, thinned to the fewest roots that
 * still cover all 88 keys, every entry marked `core`.
 *
 * The app runs its real loadManifest → loadCorePack → decodeAudioData path
 * over real Salamander samples; there are just six of them instead of the
 * forty-two of the real core pack, so `data-piano-ready` (which waits on every
 * core file) lands in a fraction of the time. Every key still sounds, because
 * getSample resolves a note to the nearest loaded root within
 * MAX_ROOT_DISTANCE and pitch-shifts it.
 */
function buildStubManifest(): SamplePackManifest {
  const roots = realManifest.files
    .filter((entry) => entry.layer === STUB_LAYER)
    .sort((a, b) => a.midi - b.midi);

  // Keep a root whenever the last keeper's reach has run out, so consecutive
  // keepers sit at most 2 × MAX_ROOT_DISTANCE apart and leave no gap.
  const files: SamplePackFileEntry[] = [];
  for (const entry of roots) {
    const previous = files.at(-1);
    if (!previous || entry.midi - previous.midi >= 2 * MAX_ROOT_DISTANCE) {
      files.push({ ...entry, pack: 'core' });
    }
  }
  // That walk can leave a tail above the last keeper's reach uncovered.
  const highest = roots.at(-1);
  if (highest && highest.midi - (files.at(-1)?.midi ?? 0) > MAX_ROOT_DISTANCE) {
    files.push({ ...highest, pack: 'core' });
  }

  for (let midi = LOWEST_KEY; midi <= HIGHEST_KEY; midi += 1) {
    const covered = files.some((entry) => Math.abs(entry.midi - midi) <= MAX_ROOT_DISTANCE);
    if (!covered) {
      throw new Error(
        `Stub sample manifest leaves midi ${midi} unplayable. The real pack's ` +
          `layer-${STUB_LAYER} roots no longer span the keyboard at this stride.`,
      );
    }
  }

  const bytes = files.reduce((total, entry) => total + entry.bytes, 0);
  return { ...realManifest, files, coreBytes: bytes, totalBytes: bytes };
}

const STUB_MANIFEST = buildStubManifest();

/**
 * Set POKEYBOARD_E2E_REAL_PACK=1 to run the whole suite against the real
 * 42-file core pack — the pre-release fidelity check, and the way to measure
 * what the stub is actually buying.
 */
const DEFAULT_SAMPLE_PACK = process.env.POKEYBOARD_E2E_REAL_PACK === '1' ? 'real' : 'stub';

/**
 * `samplePack: 'real'` opts a spec back onto the full core pack. Tests that are
 * *about* sample loading or audio fidelity use it; everything else takes the
 * stub, which is invisible to their assertions.
 */
export const test = base.extend<{ samplePack: 'stub' | 'real' }>({
  samplePack: [DEFAULT_SAMPLE_PACK, { option: true }],
  // Playwright names this second parameter `use` by convention, but it is
  // positional — and `await use(...)` inside a function called `page` reads to
  // eslint-plugin-react-hooks as a React Hook called outside a component.
  // `runTest` is the same thing without the false positive.
  page: async ({ page, samplePack }, runTest) => {
    if (samplePack === 'stub') {
      await page.route(`**/${PACK_DIR}/manifest.json`, (route) =>
        route.fulfill({ json: STUB_MANIFEST }),
      );
    }
    await runTest(page);
  },
});

export { expect } from '@playwright/test';

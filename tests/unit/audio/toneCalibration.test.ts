import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SamplePackFileEntry, SamplePackManifest, SampleSelection } from '@/audio/audioTypes';
import { PIANO_INSTRUMENTS } from '@/audio/instruments';
import { SampleBank, VELOCITY_LAYER_THRESHOLDS } from '@/audio/SampleBank';
import { TONE_CALIBRATIONS } from '@/audio/toneCalibration';
import {
  centsBetween,
  FUNDAMENTAL_GUARD,
  fundamentalHz,
  guardedCutoffHz,
  MAKEUP_POINTS,
  OPEN_CUTOFF_HZ,
  type ToneCalibration,
  type ToneRamp,
} from '@/audio/toneCalibrationMath';

/**
 * The tone calibration as it ships: the committed table, over the committed
 * packs, through the sample bank. Brightness here is the table's own measure
 * of it, the one the generator matched the layers by.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function manifestOf(packVersion: string): SamplePackManifest {
  return JSON.parse(
    readFileSync(path.resolve('public', 'piano', packVersion, 'manifest.json'), 'utf8'),
  ) as SamplePackManifest;
}

const GRANDS = PIANO_INSTRUMENTS.filter(
  (instrument) => !manifestOf(instrument.packVersion).regions,
);

/** A bank over a real manifest holding `files` of it, each "decoded" to a stand-in naming its file. */
async function loadedBank(
  manifest: SamplePackManifest,
  files: readonly SamplePackFileEntry[] = manifest.files,
): Promise<SampleBank> {
  const served = { ...manifest, files: files.map((entry) => ({ ...entry, pack: 'core' })) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => served,
      arrayBuffer: async () => new TextEncoder().encode(url).buffer,
    })),
  );
  const context = {
    decodeAudioData: vi.fn(
      async (bytes: ArrayBuffer) =>
        ({ duration: 3, file: new TextDecoder().decode(bytes) }) as unknown as AudioBuffer,
    ),
  } as unknown as BaseAudioContext;
  const bank = new SampleBank('/pack/');
  await bank.loadCorePack(context);
  return bank;
}

/** The recording a selection plays. */
function entryOf(manifest: SamplePackManifest, sample: SampleSelection): SamplePackFileEntry {
  const file = (sample.buffer as unknown as { file: string }).file.replace('/pack/', '');
  return manifest.files.find((candidate) => candidate.file === file)!;
}

function rampOf(table: ToneCalibration, layer: number, midi: number): ToneRamp {
  const ramp = table.layers[layer]?.roots.find((root) => root.midi === midi)?.ramp;
  if (!ramp) throw new Error(`no ramp for layer ${layer} root ${midi}`);
  return ramp;
}

const KEYS = Array.from({ length: 88 }, (_, index) => 21 + index);
const [MEDIUM_FROM, LOUD_FROM] = VELOCITY_LAYER_THRESHOLDS;

describe('the tone calibration table', () => {
  it('covers every recording of every grand, and nothing else', () => {
    for (const instrument of PIANO_INSTRUMENTS) {
      const manifest = manifestOf(instrument.packVersion);
      const table = TONE_CALIBRATIONS[instrument.packVersion];
      if (manifest.regions) {
        expect(table).toBeUndefined();
        continue;
      }
      expect(
        table,
        `${instrument.packVersion} has no tone calibration: run ` +
          'npx vitest run --config vitest.tools.config.ts tests/tools/generateToneCalibration.ts',
      ).toBeDefined();
      for (const entry of manifest.files) {
        const root = table!.layers[entry.layer]?.roots.find((r) => r.midi === entry.midi);
        expect(root, `${instrument.packVersion} ${entry.file}`).toBeDefined();
        // The soft layer has no layer under it to reach down to: it plays open.
        expect(root!.ramp === undefined, `${entry.file}`).toBe(entry.layer === 0);
      }
      const roots = table!.layers.reduce((sum, layer) => sum + layer.roots.length, 0);
      expect(roots).toBe(manifest.files.length);
    }
  });

  it.each(GRANDS)(
    'meets the layer below within 60 cents at every switch of $packVersion the guard leaves alone',
    ({ packVersion }) => {
      const table = TONE_CALIBRATIONS[packVersion]!;
      let matched = 0;
      for (const layer of [1, 2]) {
        for (const root of table.layers[layer]!.roots) {
          const below = table.layers[layer - 1]!.roots.find((r) => r.midi === root.midi)!;
          const ramp = root.ramp!;
          const jump = centsBetween(ramp.centroidHz, below.centroidHz);
          const open = centsBetween(root.centroidHz, below.centroidHz);
          if (ramp.cutoffHz === ramp.matchedCutoffHz) {
            matched += 1;
            expect(Math.abs(jump), `${packVersion} ${layer}:${root.midi}`).toBeLessThanOrEqual(60);
          } else {
            // Guarded: part of the jump stays, but never more than there was.
            expect(Math.abs(jump), `${packVersion} ${layer}:${root.midi}`).toBeLessThan(
              Math.abs(open),
            );
          }
        }
      }
      // Most of the keyboard is matched outright; the guard is for the top.
      expect(matched).toBeGreaterThan(30);
    },
  );

  it.each(GRANDS)(
    'starts no ramp of $packVersion below FUNDAMENTAL_GUARD × its fundamental',
    ({ packVersion }) => {
      const table = TONE_CALIBRATIONS[packVersion]!;
      for (const layer of [1, 2]) {
        for (const root of table.layers[layer]!.roots) {
          const ramp = root.ramp!;
          const floor = FUNDAMENTAL_GUARD * fundamentalHz(root.midi);
          expect(ramp.cutoffHz, `${layer}:${root.midi}`).toBeGreaterThanOrEqual(floor - 0.5);
          // And lifted only as far as that: a match above it is kept.
          expect(ramp.cutoffHz).toBeCloseTo(guardedCutoffHz(ramp.matchedCutoffHz, root.midi), -1);
        }
      }
    },
  );

  it.each(GRANDS)(
    'holds a make-up for every eighth of every $packVersion ramp, falling as it opens',
    ({ packVersion }) => {
      const table = TONE_CALIBRATIONS[packVersion]!;
      for (const layer of [1, 2]) {
        for (const root of table.layers[layer]!.roots) {
          const { makeupDb } = root.ramp!;
          expect(makeupDb).toHaveLength(MAKEUP_POINTS);
          for (const [i, db] of makeupDb.entries()) {
            expect(db).toBeGreaterThanOrEqual(0);
            if (i > 0) expect(db).toBeLessThanOrEqual(makeupDb[i - 1]!);
          }
          // Only a guarded top root's filter sits near enough its fundamental
          // to need much; none needs more than the bass ramps' 1.3 dB.
          expect(makeupDb[0]).toBeLessThan(1.5);
        }
      }
    },
  );
});

describe.each(GRANDS)('the tone of the calibrated $packVersion', ({ packVersion }) => {
  const manifest = manifestOf(packVersion);
  const table = TONE_CALIBRATIONS[packVersion]!;

  it('plays the soft layer open', async () => {
    const bank = await loadedBank(manifest);
    for (const midi of KEYS) {
      for (const velocity of [0.05, 0.25, MEDIUM_FROM - 0.001]) {
        const sample = bank.getSample(midi, velocity)!;
        expect(entryOf(manifest, sample).layer).toBe(0);
        expect(sample.toneCutoffHz).toBeUndefined();
        expect(sample.toneMakeupDb).toBeUndefined();
      }
    }
  });

  it('starts each layer at its bottom cutoff and opens it to the layer’s top', async () => {
    const bank = await loadedBank(manifest);
    for (const midi of KEYS) {
      for (const [layer, bottom] of [
        [1, MEDIUM_FROM],
        [2, LOUD_FROM],
      ] as const) {
        const sample = bank.getSample(midi, bottom)!;
        const entry = entryOf(manifest, sample);
        expect(entry.layer).toBe(layer);
        const ramp = rampOf(table, layer, entry.midi);
        expect(sample.toneCutoffHz).toBeCloseTo(ramp.cutoffHz * sample.playbackRate, 6);
        expect(sample.toneMakeupDb).toBe(ramp.makeupDb[0]);
      }
      // Just under the loud layer, the medium ramp is all but open...
      const nearTop = bank.getSample(midi, LOUD_FROM - 1e-6)!;
      expect(nearTop.toneCutoffHz! / nearTop.playbackRate).toBeCloseTo(OPEN_CUTOFF_HZ, -2);
      expect(nearTop.toneMakeupDb).toBeLessThan(0.001);
      // ...and at full velocity the loud one is: no filter at all.
      const full = bank.getSample(midi, 1)!;
      expect(full.toneCutoffHz).toBeUndefined();
      expect(full.toneMakeupDb).toBeUndefined();
    }
  });

  it('brightens with velocity through each layer, the make-up easing off as it does', async () => {
    const bank = await loadedBank(manifest);
    for (const midi of [21, 45, 60, 61, 84, 107]) {
      for (const [from, to] of [
        [MEDIUM_FROM, LOUD_FROM],
        [LOUD_FROM, 1],
      ] as const) {
        let cutoff = 0;
        let makeup = Number.POSITIVE_INFINITY;
        for (let velocity = from; velocity < to; velocity += 0.01) {
          const sample = bank.getSample(midi, velocity)!;
          expect(sample.toneCutoffHz!).toBeGreaterThan(cutoff);
          expect(sample.toneMakeupDb!).toBeLessThanOrEqual(makeup);
          cutoff = sample.toneCutoffHz!;
          makeup = sample.toneMakeupDb!;
        }
      }
    }
  });

  it('never filters a note below FUNDAMENTAL_GUARD × its own fundamental', async () => {
    const bank = await loadedBank(manifest);
    for (const midi of KEYS) {
      for (let velocity = MEDIUM_FROM; velocity < 1; velocity += 0.02) {
        const cutoff = bank.getSample(midi, velocity)!.toneCutoffHz!;
        expect(cutoff, `${midi} at ${velocity}`).toBeGreaterThanOrEqual(
          FUNDAMENTAL_GUARD * fundamentalHz(midi) * (1 - 1e-9),
        );
      }
    }
  });

  it('plays a stand-in from a brighter layer as dark as its ramp goes, and one from a darker layer open', async () => {
    // Only the medium layer, every other root: what the e2e suite's stub pack
    // holds, and what a phone has early in a load.
    const mediumOnly = await loadedBank(
      manifest,
      manifest.files.filter((entry) => entry.layer === 1 && (entry.midi - 21) % 6 === 0),
    );
    for (const midi of KEYS) {
      // A soft note played on a medium recording: filtered to the soft layer's brightness.
      const soft = mediumOnly.getSample(midi, 0.3)!;
      const standIn = entryOf(manifest, soft);
      expect(standIn.layer).toBe(1);
      const ramp = rampOf(table, 1, standIn.midi);
      expect(soft.toneCutoffHz).toBeCloseTo(ramp.cutoffHz * soft.playbackRate, 6);
      expect(soft.toneMakeupDb).toBe(ramp.makeupDb[0]);
      // Its own layer: on its ramp as ever.
      const medium = mediumOnly.getSample(midi, 0.6)!;
      expect(medium.toneCutoffHz! / medium.playbackRate).toBeGreaterThan(ramp.cutoffHz);
      // A loud note on it: already darker than asked, so open.
      const loud = mediumOnly.getSample(midi, 0.9)!;
      expect(entryOf(manifest, loud).layer).toBe(1);
      expect(loud.toneCutoffHz).toBeUndefined();
      expect(loud.toneMakeupDb).toBeUndefined();
    }
    vi.unstubAllGlobals();
    const loudOnly = await loadedBank(
      manifest,
      manifest.files.filter((entry) => entry.layer === 2),
    );
    for (const midi of [30, 60, 90]) {
      const sample = loudOnly.getSample(midi, 0.6)!;
      const ramp = rampOf(table, 2, entryOf(manifest, sample).midi);
      expect(sample.toneCutoffHz).toBeCloseTo(ramp.cutoffHz * sample.playbackRate, 6);
    }
    vi.unstubAllGlobals();
    const softOnly = await loadedBank(
      manifest,
      manifest.files.filter((entry) => entry.layer === 0),
    );
    for (const midi of [30, 60, 90]) {
      expect(softOnly.getSample(midi, 0.6)!.toneCutoffHz).toBeUndefined();
      expect(softOnly.getSample(midi, 0.95)!.toneCutoffHz).toBeUndefined();
    }
  });
});

describe('no tone filter', () => {
  it('on the Wurlitzer, which keeps its own velocity model', async () => {
    const manifest = manifestOf('wurlitzer-ep203w-v1');
    const bank = await loadedBank(manifest);
    for (const midi of [33, 61, 90]) {
      for (const velocity of [0.1, 0.5, 0.8, 1]) {
        const sample = bank.getSample(midi, velocity)!;
        expect(sample.toneCutoffHz).toBeUndefined();
        expect(sample.toneMakeupDb).toBeUndefined();
      }
    }
  });

  it('on a pack no calibration covers', async () => {
    const real = manifestOf('headroom-grand-v2');
    const bank = await loadedBank({ ...real, version: 'headroom-grand-v99' });
    expect(bank.isCalibrated()).toBe(false);
    for (const midi of [30, 60, 90]) {
      for (const velocity of [0.5, 0.8]) {
        expect(bank.getSample(midi, velocity)!.toneCutoffHz).toBeUndefined();
      }
    }
  });
});

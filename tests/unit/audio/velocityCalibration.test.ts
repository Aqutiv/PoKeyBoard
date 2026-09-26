import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SamplePackFileEntry, SamplePackManifest } from '@/audio/audioTypes';
import { PIANO_INSTRUMENTS } from '@/audio/instruments';
import {
  SampleBank,
  VELOCITY_LAYER_THRESHOLDS,
  velocityGain,
  velocityToLayer,
} from '@/audio/SampleBank';
import { VELOCITY_CALIBRATIONS } from '@/audio/velocityCalibration';
import {
  ANCHOR_HIGH_MIDI,
  ANCHOR_LOW_MIDI,
  calibrationCovers,
  evaluateFit,
  heldBackDb,
  MAX_RESIDUAL_DB,
  powerMeanDb,
  targetDb,
  type VelocityCalibration,
} from '@/audio/velocityCalibrationMath';
import { curveDb } from '@/audio/velocityCurve';

/**
 * The calibration as it ships: the committed table, over the committed packs,
 * through the sample bank. A note's level here is its recording's measured
 * level plus the gain the bank gives it — the loudness a listener hears, since
 * the table measures each recording as loudness is heard (K-weighted), from
 * where a voice starts playing it.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function manifestOf(packVersion: string): SamplePackManifest {
  return JSON.parse(
    readFileSync(path.resolve('public', 'piano', packVersion, 'manifest.json'), 'utf8'),
  ) as SamplePackManifest;
}

const CALIBRATED = PIANO_INSTRUMENTS.filter(
  (instrument) => !manifestOf(instrument.packVersion).regions,
);

/**
 * A bank over a real manifest, holding `files` of it (all of them unless
 * said), each "decoded" to a stand-in that names its file.
 */
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

interface Heard {
  entry: SamplePackFileEntry;
  gain: number;
  /** What the note sounds at: its recording's measured level, plus the voice gain. */
  levelDb: number;
}

function hear(
  bank: SampleBank,
  manifest: SamplePackManifest,
  calibration: VelocityCalibration,
  midi: number,
  velocity: number,
): Heard {
  const sample = bank.getSample(midi, velocity);
  if (!sample) throw new Error(`no sample for ${midi} at ${velocity}`);
  const file = (sample.buffer as unknown as { file: string }).file.replace('/pack/', '');
  const entry = manifest.files.find((candidate) => candidate.file === file)!;
  const layer = calibration.layers[entry.layer]!;
  const recorded = layer.roots.find((root) => root.midi === entry.midi)!;
  return { entry, gain: sample.gain, levelDb: recorded.measuredDb + 20 * Math.log10(sample.gain) };
}

const KEYS = Array.from({ length: 88 }, (_, index) => 21 + index);

describe('the velocity calibration table', () => {
  it('covers every recording of every grand the app offers, and nothing else', () => {
    // A future grand pack without a table would quietly fall back to the old
    // per-layer trims, with their steps at every layer boundary.
    expect(CALIBRATED.length).toBeGreaterThanOrEqual(2);
    for (const instrument of PIANO_INSTRUMENTS) {
      const manifest = manifestOf(instrument.packVersion);
      const table = VELOCITY_CALIBRATIONS[instrument.packVersion];
      if (manifest.regions) {
        expect(table).toBeUndefined();
        continue;
      }
      expect(
        table,
        `${instrument.packVersion} has no velocity calibration: run ` +
          'npx vitest run --config vitest.tools.config.ts tests/tools/generateVelocityCalibration.ts',
      ).toBeDefined();
      expect(calibrationCovers(table!, manifest.files)).toBe(true);
      const recordings = table!.layers.reduce((sum, layer) => sum + layer.roots.length, 0);
      expect(recordings).toBe(manifest.files.length);
    }
  });

  it('holds every recording’s sample peak', () => {
    for (const table of Object.values(VELOCITY_CALIBRATIONS)) {
      for (const layer of table.layers) {
        for (const root of layer.roots) {
          expect(root.peakDb).toBeLessThanOrEqual(0);
          expect(root.peakDb).toBeGreaterThan(-60);
        }
      }
    }
  });

  it('never trusts a recording further off its layer’s fit than the limit', () => {
    for (const [version, table] of Object.entries(VELOCITY_CALIBRATIONS)) {
      const roots = new Set(table.layers.flatMap((layer) => layer.roots.map((root) => root.midi)));
      for (const midi of roots) {
        const recordings = table.layers.map((layer) => ({
          fitted: evaluateFit(layer.fit, midi),
          root: layer.roots.find((root) => root.midi === midi)!,
        }));
        for (const { fitted, root } of recordings) {
          expect(Math.abs(root.correctedDb - fitted), `${version} ${midi}`).toBeLessThanOrEqual(
            MAX_RESIDUAL_DB + 0.01,
          );
        }
        // Held back all together, by the least that brings every layer within it.
        const expected = heldBackDb(recordings.map(({ fitted, root }) => root.measuredDb - fitted));
        expect(
          expected,
          `${version} ${midi}: layers more than twice the limit apart`,
        ).toBeDefined();
        for (const { root } of recordings) {
          expect(root.measuredDb - root.correctedDb).toBeCloseTo(expected!, 1);
        }
      }
    }
  });
});

describe.each(CALIBRATED)('the calibrated $packVersion', ({ packVersion }) => {
  const manifest = manifestOf(packVersion);
  const calibration = VELOCITY_CALIBRATIONS[packVersion]!;

  it('meets itself at both layer boundaries, on every key', async () => {
    const bank = await loadedBank(manifest);
    for (const midi of KEYS) {
      for (const boundary of VELOCITY_LAYER_THRESHOLDS) {
        const below = hear(bank, manifest, calibration, midi, boundary - 0.001);
        const above = hear(bank, manifest, calibration, midi, boundary + 0.001);
        // Two recordings meet here, so the test is about something.
        expect(above.entry.layer).toBe(below.entry.layer + 1);
        expect(Math.abs(above.levelDb - below.levelDb), `${midi} at ${boundary}`).toBeLessThan(0.5);
      }
    }
  });

  it('plays the middle three octaves at the computer keyboard’s velocity as loudly as before', async () => {
    const bank = await loadedBank(manifest);
    const velocity = 0.75;
    const layer = velocityToLayer(velocity);
    const levelMatch = manifest.velocityLayers.find((entry) => entry.index === layer)?.levelMatch;
    const oldGainDb = 20 * Math.log10(velocityGain(velocity, layer) * (levelMatch ?? 1));
    const before: number[] = [];
    const after: number[] = [];
    for (let midi = ANCHOR_LOW_MIDI; midi <= ANCHOR_HIGH_MIDI; midi += 1) {
      const heard = hear(bank, manifest, calibration, midi, velocity);
      expect(heard.entry.layer).toBe(layer);
      after.push(heard.levelDb);
      before.push(heard.levelDb - 20 * Math.log10(heard.gain) + oldGainDb);
    }
    expect(Math.abs(powerMeanDb(after) - powerMeanDb(before))).toBeLessThan(0.1);
  });

  it('spans the curve’s whole range, whichever layers sound', async () => {
    const bank = await loadedBank(manifest);
    for (const midi of [36, 60, 84]) {
      const loud = hear(bank, manifest, calibration, midi, 1);
      const light = hear(bank, manifest, calibration, midi, 0.25);
      const soft = hear(bank, manifest, calibration, midi, 0.1);
      expect(loud.levelDb - light.levelDb).toBeCloseTo(curveDb(1) - curveDb(0.25), 1);
      expect(loud.levelDb - soft.levelDb).toBeCloseTo(curveDb(1) - curveDb(0.1), 1);
    }
  });

  it('plays a stand-in at the level of the recording it stands in for', async () => {
    /** How far a root plays off its target, all layers alike: what the limit held back. */
    const heldBack = (root: number) => {
      const recorded = calibration.layers[1]!.roots.find((entry) => entry.midi === root)!;
      return recorded.measuredDb - recorded.correctedDb;
    };
    const full = await loadedBank(manifest);
    const heardInFull = new Map<string, Heard>();
    for (const midi of KEYS) {
      for (const velocity of [0.2, 0.6, 0.95]) {
        heardInFull.set(`${midi}@${velocity}`, hear(full, manifest, calibration, midi, velocity));
      }
    }
    vi.unstubAllGlobals();
    // Only the medium layer, every other root: what the e2e suite's stub pack
    // holds, and what a phone has early in a load.
    const partial = await loadedBank(
      manifest,
      manifest.files.filter((entry) => entry.layer === 1 && (entry.midi - 21) % 6 === 0),
    );
    for (const midi of KEYS) {
      for (const velocity of [0.2, 0.6, 0.95]) {
        const standIn = hear(partial, manifest, calibration, midi, velocity);
        const own = heardInFull.get(`${midi}@${velocity}`)!;
        expect(standIn.entry.layer).toBe(1);
        const target = targetDb(calibration, velocity, midi);
        expect(standIn.levelDb).toBeCloseTo(target + heldBack(standIn.entry.midi), 1);
        expect(own.levelDb).toBeCloseTo(target + heldBack(own.entry.midi), 1);
        if (heldBack(standIn.entry.midi) === 0 && heldBack(own.entry.midi) === 0) {
          expect(Math.abs(standIn.levelDb - own.levelDb)).toBeLessThan(0.02);
        }
      }
    }
  });
});

describe('a pack without a table', () => {
  it('keeps the per-layer trims and level match exactly', async () => {
    const real = manifestOf('headroom-grand-v2');
    const manifest = { ...real, version: 'headroom-grand-v99' };
    expect(VELOCITY_CALIBRATIONS[manifest.version]).toBeUndefined();
    const bank = await loadedBank(manifest);
    for (const midi of [30, 60, 90]) {
      for (const velocity of [0.1, 0.449, 0.451, 0.75, 0.779, 0.781, 1]) {
        const layer = velocityToLayer(velocity);
        const levelMatch = manifest.velocityLayers.find(
          (entry) => entry.index === layer,
        )!.levelMatch!;
        expect(bank.getSample(midi, velocity)!.gain).toBeCloseTo(
          velocityGain(velocity, layer) * levelMatch,
          12,
        );
      }
    }
  });
});

describe('the Wurlitzer', () => {
  it('keeps its own region gains: v² times the region’s trim and the pack’s match', async () => {
    const manifest = manifestOf('wurlitzer-ep203w-v1');
    expect(VELOCITY_CALIBRATIONS[manifest.version]).toBeUndefined();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => manifest,
        arrayBuffer: async () => new TextEncoder().encode(url).buffer,
      })),
    );
    const context = {
      decodeAudioData: vi.fn(async () => ({ duration: 3 }) as unknown as AudioBuffer),
    } as unknown as BaseAudioContext;
    const bank = new SampleBank('/wurlitzer/');
    await bank.loadCorePack(context);
    await bank.ensureRangeLoaded(context, 21, 108);
    for (const midi of [33, 61, 90]) {
      for (const velocity of [0.1, 0.45, 0.78, 1]) {
        const midiVelocity = Math.max(1, Math.round(velocity * 127));
        const region = manifest.regions!.find(
          (candidate) =>
            midi >= candidate.lowKey &&
            midi <= candidate.highKey &&
            midiVelocity >= candidate.lowVelocity &&
            midiVelocity <= candidate.highVelocity,
        )!;
        expect(bank.getSample(midi, velocity)!.gain).toBeCloseTo(
          velocity * velocity * region.gain * manifest.levelMatch!,
          12,
        );
      }
    }
  });
});

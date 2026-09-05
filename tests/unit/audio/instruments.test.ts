import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SamplePackManifest } from '@/audio/audioTypes';
import {
  DEFAULT_PIANO_INSTRUMENT_ID,
  instrumentForPackVersion,
  pianoInstrument,
  PIANO_INSTRUMENTS,
  PIANO_INSTRUMENT_IDS,
} from '@/audio/instruments';
import { DEFAULT_SAMPLE_PACK_VERSION } from '@/domain/takeTypes';

/** rootMidis() in scripts/build-sample-pack.mjs. */
const ROOTS = Array.from({ length: 30 }, (_, index) => 21 + index * 3);
/** CORE_ROOT_MIN / CORE_ROOT_MAX in scripts/build-sample-pack.mjs. */
const CORE_ROOT_MIN = 45;
const CORE_ROOT_MAX = 84;

describe('the piano registry', () => {
  it('gives every instrument a distinct pack under public/piano', () => {
    const versions = PIANO_INSTRUMENTS.map((instrument) => instrument.packVersion);
    expect(new Set(versions).size).toBe(PIANO_INSTRUMENTS.length);
    for (const instrument of PIANO_INSTRUMENTS) {
      expect(instrument.path).toBe(`piano/${instrument.packVersion}/`);
    }
  });

  it('lists every instrument id', () => {
    expect([...PIANO_INSTRUMENT_IDS].sort()).toEqual(
      PIANO_INSTRUMENTS.map((instrument) => instrument.id).sort(),
    );
  });

  it('keeps the default piano aligned with the take schema default', () => {
    expect(pianoInstrument(DEFAULT_PIANO_INSTRUMENT_ID).packVersion).toBe(
      DEFAULT_SAMPLE_PACK_VERSION,
    );
  });

  it('resolves a stored pack version, falling back rather than throwing', () => {
    expect(instrumentForPackVersion('salamander-grand-v3').id).toBe('salamander-grand');
    expect(instrumentForPackVersion('headroom-grand-v2').id).toBe('headroom-grand');
    // Retired packs, still stamped on takes recorded before the stereo FLAC
    // generation (and, for v1, before the .sample rename).
    expect(instrumentForPackVersion('salamander-grand-v1').id).toBe('salamander-grand');
    expect(instrumentForPackVersion('salamander-grand-v2').id).toBe('salamander-grand');
    expect(instrumentForPackVersion('headroom-grand-v1').id).toBe('headroom-grand');
    expect(instrumentForPackVersion('grand-piano-v1').id).toBe(DEFAULT_PIANO_INSTRUMENT_ID);
    expect(instrumentForPackVersion('').id).toBe(DEFAULT_PIANO_INSTRUMENT_ID);
    expect(instrumentForPackVersion('bosendorfer-280').id).toBe(DEFAULT_PIANO_INSTRUMENT_ID);
  });
});

describe.each(PIANO_INSTRUMENTS)('the $packVersion pack on disk', (instrument) => {
  const packDir = path.resolve('public', 'piano', instrument.packVersion);
  const manifest = JSON.parse(
    readFileSync(path.join(packDir, 'manifest.json'), 'utf8'),
  ) as SamplePackManifest;

  it('describes itself and carries its recorded velocity layers', () => {
    expect(manifest.version).toBe(instrument.packVersion);
    expect(manifest.license).toMatch(/^CC-BY/);
    expect(manifest.sourceUrl).toMatch(/^https:\/\//);
    expect(manifest.velocityLayers.map((layer) => layer.index)).toEqual(
      manifest.regions ? [0, 1, 2, 3] : [0, 1, 2],
    );
  });

  it('preserves the native channel layout in lossless FLAC', () => {
    // The mono downmix was the single biggest fidelity loss, and a lossy codec
    // costs attack timing — neither should come back by accident on a rebuild.
    expect(manifest.format).toMatch(
      manifest.regions ? /^flac-16bit-44\.1khz-mono$/ : /^flac-16bit-\d+(\.\d+)?khz-stereo$/,
    );
  });

  it('starts every sample with the attack, not codec priming silence', () => {
    // FLAC has no encoder delay. A lossy re-encode would push the transient
    // later, which on a piano reads as added latency.
    for (const entry of manifest.files) {
      const bytes = readFileSync(path.join(packDir, entry.file));
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('fLaC');
    }
  });

  it('covers every root in all three layers', () => {
    if (manifest.regions) {
      for (let key = 21; key <= 108; key++)
        for (let velocity = 1; velocity <= 127; velocity++) {
          const regions = manifest.regions.filter(
            (r) =>
              key >= r.lowKey &&
              key <= r.highKey &&
              velocity >= r.lowVelocity &&
              velocity <= r.highVelocity,
          );
          expect(regions).toHaveLength(1);
          expect(manifest.files.some((file) => file.file === regions[0]?.file)).toBe(true);
        }
      return;
    }
    expect(manifest.files).toHaveLength(ROOTS.length * 3);
    for (const layer of [0, 1, 2]) {
      const midis = manifest.files
        .filter((entry) => entry.layer === layer)
        .map((entry) => entry.midi)
        .sort((a, b) => a - b);
      expect(midis).toEqual(ROOTS);
    }
  });

  it('marks the visible keyboard range as the core pack', () => {
    for (const entry of manifest.files) {
      const core = manifest.regions
        ? manifest.regions.some(
            (r) => r.file === entry.file && r.lowKey <= CORE_ROOT_MAX && r.highKey >= CORE_ROOT_MIN,
          )
        : entry.midi >= CORE_ROOT_MIN && entry.midi <= CORE_ROOT_MAX;
      expect(entry.pack).toBe(core ? 'core' : 'full');
    }
  });

  it('agrees with the bytes actually on disk', () => {
    let coreBytes = 0;
    let totalBytes = 0;
    for (const entry of manifest.files) {
      expect(statSync(path.join(packDir, entry.file)).size).toBe(entry.bytes);
      if (entry.pack === 'core') coreBytes += entry.bytes;
      totalBytes += entry.bytes;
    }
    expect(manifest.coreBytes).toBe(coreBytes);
    expect(manifest.totalBytes).toBe(totalBytes);
  });
});

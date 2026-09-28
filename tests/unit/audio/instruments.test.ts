import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SamplePackFileEntry, SamplePackManifest } from '@/audio/audioTypes';
import {
  DEFAULT_PIANO_INSTRUMENT_ID,
  instrumentForPackVersion,
  pianoInstrument,
  PIANO_INSTRUMENTS,
  PIANO_INSTRUMENT_IDS,
} from '@/audio/instruments';
import { layerLabels } from '@/audio/velocityLayers';
import { DEFAULT_SAMPLE_PACK_VERSION } from '@/domain/takeTypes';

/** rootMidis() in scripts/build-sample-pack.mjs. */
const ROOTS = Array.from({ length: 30 }, (_, index) => 21 + index * 3);
/** CORE_ROOT_MIN / CORE_ROOT_MAX in scripts/build-sample-pack.mjs. */
const CORE_ROOT_MIN = 45;
const CORE_ROOT_MAX = 84;
/** The grands whose source records a pianissimo under the three layers every grand has. */
const WITH_PIANISSIMO = new Set(['salamander-grand', 'bitklavier-grand']);

function manifestAt(packVersion: string): SamplePackManifest {
  return JSON.parse(
    readFileSync(path.resolve('public', 'piano', packVersion, 'manifest.json'), 'utf8'),
  ) as SamplePackManifest;
}

/**
 * Where a manifest entry lives: its own pack's directory, or — listed as
 * `../<pack>/<file>` — the directory of the earlier pack it re-uses.
 */
function homeOf(packVersion: string, entry: SamplePackFileEntry): { pack: string; file: string } {
  const reused = /^\.\.\/([^/]+)\/([^/]+)$/.exec(entry.file);
  return reused ? { pack: reused[1]!, file: reused[2]! } : { pack: packVersion, file: entry.file };
}

describe('the piano registry', () => {
  it('offers all four pianos, the grands first, Salamander by default', () => {
    expect(PIANO_INSTRUMENT_IDS).toEqual([
      'salamander-grand',
      'headroom-grand',
      'bitklavier-grand',
      'wurlitzer-ep203w',
    ]);
    expect(DEFAULT_PIANO_INSTRUMENT_ID).toBe('salamander-grand');
    expect(pianoInstrument('bitklavier-grand')).toMatchObject({
      packVersion: 'bitklavier-grand-v2',
      name: 'Steinway',
      midiProgram: 0,
    });
  });

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
    expect(instrumentForPackVersion('salamander-grand-v4').id).toBe('salamander-grand');
    expect(instrumentForPackVersion('headroom-grand-v2').id).toBe('headroom-grand');
    expect(instrumentForPackVersion('bitklavier-grand-v2').id).toBe('bitklavier-grand');
    // A later generation, stamped by a newer app shell, is still the same piano.
    expect(instrumentForPackVersion('bitklavier-grand-v3').id).toBe('bitklavier-grand');
    // Retired packs, still stamped on takes recorded before the pianissimo
    // layer, or the stereo FLAC generation (and, for v1, the .sample rename).
    expect(instrumentForPackVersion('salamander-grand-v1').id).toBe('salamander-grand');
    expect(instrumentForPackVersion('salamander-grand-v2').id).toBe('salamander-grand');
    expect(instrumentForPackVersion('salamander-grand-v3').id).toBe('salamander-grand');
    expect(instrumentForPackVersion('headroom-grand-v1').id).toBe('headroom-grand');
    expect(instrumentForPackVersion('bitklavier-grand-v1').id).toBe('bitklavier-grand');
    expect(instrumentForPackVersion('grand-piano-v1').id).toBe(DEFAULT_PIANO_INSTRUMENT_ID);
    expect(instrumentForPackVersion('').id).toBe(DEFAULT_PIANO_INSTRUMENT_ID);
    expect(instrumentForPackVersion('bosendorfer-280').id).toBe(DEFAULT_PIANO_INSTRUMENT_ID);
  });
});

describe.each(PIANO_INSTRUMENTS)('the $packVersion pack on disk', (instrument) => {
  const packDir = path.resolve('public', 'piano', instrument.packVersion);
  const manifest = manifestAt(instrument.packVersion);

  it('describes itself and carries its recorded velocity layers', () => {
    expect(manifest.version).toBe(instrument.packVersion);
    expect(manifest.license).toMatch(/^CC-BY/);
    expect(manifest.sourceUrl).toMatch(/^https:\/\//);
    if (manifest.regions) {
      expect(manifest.velocityLayers.map((layer) => layer.index)).toEqual([0, 1, 2, 3]);
      return;
    }
    // Softest first, numbered from 0, as the sample bank reads them.
    expect(layerLabels(manifest.velocityLayers)).toEqual(
      WITH_PIANISSIMO.has(instrument.id)
        ? ['pianissimo', 'soft', 'medium', 'loud']
        : ['soft', 'medium', 'loud'],
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

  it('covers every root in every layer', () => {
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
    expect(manifest.files).toHaveLength(ROOTS.length * manifest.velocityLayers.length);
    for (const { index } of manifest.velocityLayers) {
      const midis = manifest.files
        .filter((entry) => entry.layer === index)
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

  it('lists a file it re-uses exactly as the pack of the same piano that published it', () => {
    for (const entry of manifest.files) {
      const home = homeOf(manifest.version, entry);
      if (home.pack === manifest.version) continue;
      // Deleting a piano's samples matches every generation of it by name, so
      // a file shared with another piano would go with either.
      expect(home.pack).toMatch(new RegExp(`^${instrument.id}-v\\d+$`));
      const source = manifestAt(home.pack);
      const published = source.files.find((candidate) => candidate.file === home.file);
      expect(published, entry.file).toMatchObject({
        midi: entry.midi,
        pack: entry.pack,
        bytes: entry.bytes,
      });
      // The same upstream layer under the same label, carrying the gain and
      // the level match it was published with.
      const layer = manifest.velocityLayers[entry.layer]!;
      expect(layer).toEqual({ ...source.velocityLayers[published!.layer]!, index: layer.index });
    }
  });
});

describe('the bitklavier-grand-v2 pack', () => {
  const manifest = manifestAt('bitklavier-grand-v2');

  it('keeps v5, v7, v10 and v14 of its sixteen layers, each raised before dither', () => {
    expect(
      manifest.velocityLayers.map(({ sourceLayer, label }) => `${label} v${sourceLayer}`),
    ).toEqual(['pianissimo v5', 'soft v7', 'medium v10', 'loud v14']);
    for (const layer of manifest.velocityLayers) {
      expect(layer.gainDb).toBeGreaterThan(0);
      // What the gain's -1 dBFS ceiling held back, the app adds after decoding.
      expect(layer.levelMatch).toBeGreaterThanOrEqual(1);
    }
    // No other pack changed its source's level before dither.
    for (const { packVersion } of PIANO_INSTRUMENTS) {
      if (packVersion === manifest.version) continue;
      const other = manifestAt(packVersion);
      expect(other.velocityLayers.every((layer) => layer.gainDb === undefined)).toBe(true);
    }
  });

  it('was built from pinned sources, each file pinned by the pack that fetched it', () => {
    // A file it re-uses ("../bitklavier-grand-v1/C4v7.sample") was fetched, and
    // is pinned, where that pack was built; this one pins only what it fetched.
    const sources = new Map<string, string[]>();
    for (const entry of manifest.files) {
      const { pack, file } = homeOf(manifest.version, entry);
      // "Fs6v14.sample" came from upstream's "F#6v14.wav".
      const source = file.replace(/^([A-G])s/, '$1#').replace(/\.sample$/, '.wav');
      sources.set(pack, [...(sources.get(pack) ?? []), source]);
    }
    expect([...sources.keys()].sort()).toEqual(['bitklavier-grand-v1', 'bitklavier-grand-v2']);
    for (const [pack, fetched] of sources) {
      const pins = JSON.parse(
        readFileSync(path.resolve('scripts', 'lib', `${pack}.pins.json`), 'utf8'),
      ) as { files: Record<string, { bytes: number; sha256: string }> };
      expect(Object.keys(pins.files).sort(), pack).toEqual(fetched.sort());
      for (const pin of Object.values(pins.files)) {
        // At least the 2.25 s of the shortest recording, 48 kHz 24-bit stereo:
        // C8 v5, in its noise floor a second after it is struck.
        expect(pin.bytes).toBeGreaterThan(2.2 * 48_000 * 6);
        expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});

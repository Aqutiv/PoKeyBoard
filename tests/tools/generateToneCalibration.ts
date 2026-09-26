/**
 * Generates src/audio/toneCalibration.ts: how bright every recording of every
 * grand piano pack is, and the lowpass ramp that carries each velocity layer
 * down to the brightness of the one below it at its bottom. See
 * toneCalibrationMath.ts for what the numbers are for.
 *
 * Each recording is decoded from the committed pack at 48 kHz (ffmpeg, as the
 * pack build does, so it must be on the PATH): the rate an export renders at
 * and most devices play at, to which decodeAudioData resamples the Headroom
 * piano's 44.1 kHz files. Its onset is found exactly as the sample bank finds
 * it (`onsetOffsetOf`), and it is heard as its voice plays it: from there,
 * through its filter, under the envelope's attack (`playedVoice`). Then, for
 * every root of the medium and loud layers:
 *
 *   the bottom cutoff is searched for until the recording's brightness through
 *   it meets the layer below's, played open, and lifted to the top guard where
 *   that is higher (`guardedCutoffHz`);
 *   the make-up is what the filter then takes from its loudness, K-weighted as
 *   the velocity calibration weighs it, at every eighth of the way up the ramp.
 *
 * The run checks the make-up between those points (within 0.03 dB of what the
 * filter really takes), that every ramp the guard leaves alone meets the layer
 * below within a few cents, and that no voice anywhere on a ramp peaks higher
 * than the loudest voice of any pack at full velocity (`loudestVoicePeak`),
 * the worst case the output headroom spec drives the graph with; and it prints
 * what other guard multiples would have done, and the top octave before and
 * after the guard.
 *
 * The table is machine-owned: regenerating overwrites it. Only needed when a
 * pack is added or rebuilt as a new version; published packs never change.
 * Not part of `npm test` (which only globs tests/unit and tests/integration).
 * Run it explicitly:
 *
 *   npx vitest run --config vitest.tools.config.ts tests/tools/generateToneCalibration.ts
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as prettier from 'prettier';
import { expect, it } from 'vitest';
import type { SamplePackManifest } from '@/audio/audioTypes';
import { PIANO_INSTRUMENTS } from '@/audio/instruments';
import {
  MAX_ROOT_DISTANCE_SEMITONES,
  onsetOffsetOf,
  VELOCITY_LAYER_THRESHOLDS,
} from '@/audio/SampleBank';
import {
  applyBiquad,
  BRIGHTNESS_WINDOW_S,
  centsBetween,
  filterLossDb,
  FUNDAMENTAL_GUARD,
  fundamentalHz,
  MAKEUP_POINTS,
  makeupAt,
  OPEN_CUTOFF_HZ,
  playedVoice,
  rampCutoffHz,
  searchCutoffHz,
  spectralCentroidHz,
  voiceWindow,
  webAudioLowpass,
  type ToneCalibration,
  type ToneRamp,
  type ToneRoot,
} from '@/audio/toneCalibrationMath';
import { VELOCITY_CALIBRATIONS } from '@/audio/velocityCalibration';
import {
  calibratedGain,
  loudestVoicePeak,
  type VelocityCalibration,
} from '@/audio/velocityCalibrationMath';

// Paths hang off the project root: under jsdom, import.meta.url is an http
// URL rather than a file one, so it cannot anchor them.
const ROOT = process.cwd();
const TABLE_PATH = path.join(ROOT, 'src/audio/toneCalibration.ts');

/** The rate every recording is heard at; see above. */
const ANALYSIS_RATE = 48_000;

/** The lowest cutoff the search tries: under any piano's lowest fundamental. */
const SEARCH_FLOOR_HZ = 20;

/** The guard multiples the run compares with `FUNDAMENTAL_GUARD`, to show what the choice moves. */
const GUARD_CANDIDATES = [2, 2.5, 3, 4];

/** The lowest root of the top octave, C7, and of the two octaves the guard mostly binds on, C6. */
const TOP_OCTAVE_MIDI = 96;
const TOP_TWO_OCTAVES_MIDI = 84;

/** The furthest the make-up between the table's points may stray from what the filter takes. */
const MAKEUP_TOLERANCE_DB = 0.03;

interface Recording {
  channels: Float32Array[];
  /** Where its voice starts, in seconds: its onset, as the bank finds it. */
  offsetS: number;
}

/** Channel count, from the FLAC STREAMINFO block. */
function channelCount(bytes: Buffer): number {
  if (bytes.toString('ascii', 0, 4) !== 'fLaC' || (bytes[4]! & 127) !== 0) {
    throw new Error('Expected a native FLAC stream');
  }
  return Number((bytes.readBigUInt64BE(18) >> 41n) & 7n) + 1;
}

/** A whole pack file, decoded at `ANALYSIS_RATE`, one array per channel. */
async function decode(file: string): Promise<Recording> {
  const channels = channelCount(await readFile(file));
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const args = ['-v', 'error', '-i', file, '-ar', String(ANALYSIS_RATE), '-f', 'f32le', '-'];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg failed on ${file}: ${errors}`));
      else resolve(Buffer.concat(chunks));
    });
  });
  const frames = bytes.length / 4 / channels;
  const data = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      data[channel]![frame] = bytes.readFloatLE((frame * channels + channel) * 4);
    }
  }
  const buffer = {
    sampleRate: ANALYSIS_RATE,
    length: frames,
    numberOfChannels: channels,
    getChannelData: (channel: number) => data[channel]!,
  } as unknown as AudioBuffer;
  return { channels: data, offsetS: onsetOffsetOf(buffer) };
}

/** A recording's brightness, played through a filter at `cutoffHz`, or open. */
function brightness(window: readonly Float32Array[], cutoffHz?: number): number {
  return spectralCentroidHz(playedVoice(window, ANALYSIS_RATE, cutoffHz), ANALYSIS_RATE);
}

/** The highest sample of a voice from its start, through a filter at `cutoffHz` or open. */
function voicePeak(recording: Recording, cutoffHz?: number): number {
  const from = Math.round(recording.offsetS * ANALYSIS_RATE);
  const filter = cutoffHz === undefined ? undefined : webAudioLowpass(cutoffHz, ANALYSIS_RATE);
  let peak = 0;
  for (const samples of recording.channels) {
    const voice = samples.subarray(from);
    const played = filter ? applyBiquad(voice, filter) : voice;
    for (const sample of played) peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const LAYER_NAMES = ['soft', 'medium', 'loud'];

function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** What one ramp came to, with what the report needs beside the table's numbers. */
interface Ramp {
  layer: number;
  midi: number;
  ramp: ToneRamp;
  /** The layer below's brightness, the ramp's target. */
  targetHz: number;
  /** The recording's own brightness, open. */
  openHz: number;
  /** What the unguarded match would have needed. */
  matchedMakeupDb: number;
  /** The make-up and the brightness at each of `GUARD_CANDIDATES`. */
  candidates: { makeupDb: number; centroidHz: number; guarded: boolean }[];
  /** The largest gap between the make-up the table gives between its points and the filter's loss. */
  makeupErrorDb: number;
  /** The loudest this recording's voice peaks anywhere on the ramp, as a linear amplitude. */
  rampPeak: number;
  /** The velocity it peaks that loud at. */
  rampPeakVelocity: number;
  /** The same, over its own peak at full velocity, open, in dB. */
  rampPeakOverFullDb: number;
}

/** Measure one recording's ramp: its bottom cutoff against `below`, its make-up and its peaks. */
function measureRamp(
  layer: number,
  midi: number,
  recording: Recording,
  below: Recording,
  calibration: VelocityCalibration,
): Ramp {
  const window = voiceWindow(recording.channels, recording.offsetS, ANALYSIS_RATE);
  const targetHz = brightness(voiceWindow(below.channels, below.offsetS, ANALYSIS_RATE));
  const matched = searchCutoffHz(
    (hz) => brightness(window, hz),
    targetHz,
    SEARCH_FLOOR_HZ,
    OPEN_CUTOFF_HZ,
  );
  // Never under the guard, even by rounding: the runtime relies on it.
  const guard = FUNDAMENTAL_GUARD * fundamentalHz(midi);
  const cutoffHz = Math.max(Math.round(matched), Math.ceil(guard));
  const makeupDb = Array.from({ length: MAKEUP_POINTS }, (_, point) =>
    filterLossDb(window, ANALYSIS_RATE, rampCutoffHz(cutoffHz, point / MAKEUP_POINTS)),
  );
  const ramp: ToneRamp = {
    matchedCutoffHz: Math.round(matched),
    cutoffHz,
    centroidHz: round(brightness(window, cutoffHz), 1),
    makeupDb: makeupDb.map((db) => round(Math.max(0, db), 3)),
  };

  let makeupErrorDb = 0;
  for (let point = 0; point < MAKEUP_POINTS; point += 1) {
    const position = (point + 0.5) / MAKEUP_POINTS;
    const loss = filterLossDb(window, ANALYSIS_RATE, rampCutoffHz(cutoffHz, position));
    makeupErrorDb = Math.max(makeupErrorDb, Math.abs(makeupAt(ramp.makeupDb, position) - loss));
  }

  // The loudest the voice peaks along its ramp, on the keys it can sound: at
  // every eighth of the way up, and close under the top, where the gain is
  // all but full velocity's and a filter all but open can still lift a peak a
  // little. A stand-in from this layer for the one below plays its ramp's
  // bottom, at velocities just under it, and so no louder than it does there.
  const bottom = VELOCITY_LAYER_THRESHOLDS[layer - 1]!;
  const top = VELOCITY_LAYER_THRESHOLDS[layer] ?? 1;
  const keys = Array.from(
    { length: 2 * MAX_ROOT_DISTANCE_SEMITONES + 1 },
    (_, index) => midi - MAX_ROOT_DISTANCE_SEMITONES + index,
  ).filter((key) => key >= 21 && key <= 108);
  const loudestGain = (velocity: number) =>
    Math.max(...keys.map((key) => calibratedGain(calibration, velocity, key, layer, midi) ?? 0));
  const positions = [
    ...Array.from({ length: MAKEUP_POINTS }, (_, point) => point / MAKEUP_POINTS),
    0.95,
    0.99,
    0.999,
  ];
  let rampPeak = 0;
  let rampPeakVelocity = bottom;
  for (const position of positions) {
    const velocity = bottom + position * (top - bottom);
    const peak =
      voicePeak(recording, rampCutoffHz(cutoffHz, position)) *
      loudestGain(velocity) *
      10 ** (makeupAt(ramp.makeupDb, position) / 20);
    if (peak > rampPeak) {
      rampPeak = peak;
      rampPeakVelocity = velocity;
    }
  }
  const fullPeak = voicePeak(recording) * loudestGain(1);

  const candidates = GUARD_CANDIDATES.map((multiple) => {
    const hz = Math.max(matched, multiple * fundamentalHz(midi));
    return {
      makeupDb: filterLossDb(window, ANALYSIS_RATE, hz),
      centroidHz: brightness(window, hz),
      guarded: hz > matched,
    };
  });

  return {
    layer,
    midi,
    ramp,
    targetHz,
    openHz: brightness(window),
    matchedMakeupDb: filterLossDb(window, ANALYSIS_RATE, matched),
    candidates,
    makeupErrorDb,
    rampPeak,
    rampPeakVelocity,
    rampPeakOverFullDb: 20 * Math.log10(rampPeak / fullPeak),
  };
}

interface Pack {
  version: string;
  table: ToneCalibration;
  ramps: Ramp[];
  /** The pack's loudest voice at full velocity, dBFS; see `loudestVoicePeak`. */
  loudestFullDb: number;
}

async function measurePack(version: string, manifest: SamplePackManifest): Promise<Pack> {
  const calibration = VELOCITY_CALIBRATIONS[version];
  if (!calibration) throw new Error(`${version} has no velocity calibration: generate that first`);
  const dir = path.join(ROOT, 'public', 'piano', version);
  const recordings = new Map<string, Recording>();
  const queue = [...manifest.files];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        recordings.set(`${entry.layer}:${entry.midi}`, await decode(path.join(dir, entry.file)));
      }
    }),
  );
  const layerCount = Math.max(...manifest.files.map((entry) => entry.layer)) + 1;
  const ramps: Ramp[] = [];
  const layers = Array.from({ length: layerCount }, (_, layer) => {
    const roots: ToneRoot[] = manifest.files
      .filter((entry) => entry.layer === layer)
      .sort((a, b) => a.midi - b.midi)
      .map((entry) => {
        const recording = recordings.get(`${layer}:${entry.midi}`)!;
        const window = voiceWindow(recording.channels, recording.offsetS, ANALYSIS_RATE);
        const root: ToneRoot = { midi: entry.midi, centroidHz: round(brightness(window), 1) };
        if (layer === 0) return root;
        const below = recordings.get(`${layer - 1}:${entry.midi}`);
        if (!below) throw new Error(`${version} ${entry.file} has no recording under it`);
        const measured = measureRamp(layer, entry.midi, recording, below, calibration);
        ramps.push(measured);
        return { ...root, ramp: measured.ramp };
      });
    return { roots };
  });
  const loudestFullDb =
    20 * Math.log10(loudestVoicePeak(calibration, 1, MAX_ROOT_DISTANCE_SEMITONES));
  return { version, table: { layers }, ramps, loudestFullDb };
}

/** Whether a ramp's bottom cutoff was lifted by the guard. */
function guarded(ramp: Ramp): boolean {
  return ramp.ramp.cutoffHz > ramp.ramp.matchedCutoffHz;
}

function jumpCents(ramp: Ramp, centroidHz: number): number {
  return centsBetween(centroidHz, ramp.targetHz);
}

/** The loudest any voice of a pack peaks along the ramps, in dBFS. */
function loudestRampDb(pack: Pack): number {
  return 20 * Math.log10(Math.max(...pack.ramps.map((ramp) => ramp.rampPeak)));
}

/**
 * The loudest any voice of any calibrated pack peaks at full velocity, in
 * dBFS: what the output headroom spec drives the graph with.
 */
function worstFullDb(): number {
  const peaks = Object.values(VELOCITY_CALIBRATIONS).map((calibration) =>
    loudestVoicePeak(calibration, 1, MAX_ROOT_DISTANCE_SEMITONES),
  );
  return 20 * Math.log10(Math.max(...peaks));
}

/** The summary lines for the table's header, one pack's worth. */
function summaryLines(pack: Pack): string[] {
  const lines: string[] = [];
  for (const layer of [1, 2]) {
    const ramps = pack.ramps.filter((ramp) => ramp.layer === layer);
    const open = ramps.map((ramp) => Math.abs(jumpCents(ramp, ramp.openHz)));
    const toned = ramps.map((ramp) => Math.abs(jumpCents(ramp, ramp.ramp.centroidHz)));
    lines.push(
      `brightness step into ${LAYER_NAMES[layer]}, cents: ${median(open).toFixed(0)} open, ` +
        `${median(toned).toFixed(0)} toned (median; most ${Math.max(...open).toFixed(0)}, ` +
        `${Math.max(...toned).toFixed(0)})`,
    );
  }
  const guardedRamps = pack.ramps.filter(guarded);
  const lowest = Math.min(...guardedRamps.map((ramp) => ramp.midi));
  const makeups = pack.ramps.map((ramp) => ramp.ramp.makeupDb[0]!);
  const most = pack.ramps.find((ramp) => ramp.ramp.makeupDb[0] === Math.max(...makeups))!;
  lines.push(
    `guarded at ${FUNDAMENTAL_GUARD} × the fundamental: ${guardedRamps.length} of ` +
      `${pack.ramps.length} ramps, from ${noteName(lowest)}`,
    `make-up at a ramp's bottom, dB: median ${median(makeups).toFixed(2)}, most ` +
      `${Math.max(...makeups).toFixed(2)} (${noteName(most.midi)} ${LAYER_NAMES[most.layer]})`,
    `loudest voice on a ramp: ${loudestRampDb(pack).toFixed(2)} dBFS; at full velocity ` +
      `${pack.loudestFullDb.toFixed(2)}, and ${worstFullDb().toFixed(2)} on the loudest pack`,
  );
  return lines;
}

/** What each of `GUARD_CANDIDATES` would have done: printed, for the choice of `FUNDAMENTAL_GUARD`. */
function reportGuardCandidates(pack: Pack): void {
  console.log(`  guard multiples compared (${FUNDAMENTAL_GUARD} chosen):`);
  for (const [index, multiple] of GUARD_CANDIDATES.entries()) {
    const bound = pack.ramps.filter((ramp) => ramp.candidates[index]!.guarded);
    const most = Math.max(0, ...bound.map((ramp) => ramp.candidates[index]!.makeupDb));
    const leftIn = (from: number) =>
      median(
        pack.ramps
          .filter((ramp) => ramp.midi >= from)
          .map((ramp) => Math.abs(jumpCents(ramp, ramp.candidates[index]!.centroidHz))),
      );
    const lowest = bound.length ? noteName(Math.min(...bound.map((ramp) => ramp.midi))) : '-';
    console.log(
      `    ${String(multiple).padEnd(3)} binds on ${String(bound.length).padStart(2)} ramps from ` +
        `${lowest.padEnd(4)}, most make-up there ${most.toFixed(2)} dB; steps left from C6 ` +
        `${leftIn(TOP_TWO_OCTAVES_MIDI).toFixed(0)} cents, from C7 ` +
        `${leftIn(TOP_OCTAVE_MIDI).toFixed(0)} (median)`,
    );
  }
}

/** The top octave before the guard, after it, and with no ramps at all. */
function reportTopOctave(pack: Pack): void {
  const top = pack.ramps.filter((ramp) => ramp.midi >= TOP_OCTAVE_MIDI);
  const describe = (label: string, makeups: number[], steps: number[]) => {
    const sizes = steps.map(Math.abs);
    console.log(
      `    ${label.padEnd(20)} make-up ${Math.min(...makeups).toFixed(2)}–` +
        `${Math.max(...makeups).toFixed(2)} dB, steps ${median(sizes).toFixed(0)} cents ` +
        `(median), ${Math.max(...sizes).toFixed(0)} most`,
    );
  };
  console.log('  top octave (C7–C8):');
  describe(
    'matched, unguarded',
    top.map((ramp) => ramp.matchedMakeupDb),
    top.map(() => 0),
  );
  describe(
    `guarded at ${FUNDAMENTAL_GUARD}`,
    top.map((ramp) => ramp.ramp.makeupDb[0]!),
    top.map((ramp) => jumpCents(ramp, ramp.ramp.centroidHz)),
  );
  describe(
    'no ramps at all',
    top.map(() => 0),
    top.map((ramp) => jumpCents(ramp, ramp.openHz)),
  );
  for (const ramp of top) {
    console.log(
      `      ${noteName(ramp.midi).padEnd(4)} ${LAYER_NAMES[ramp.layer]!.padEnd(6)} ` +
        `matched ${String(ramp.ramp.matchedCutoffHz).padStart(5)} Hz, ` +
        `${ramp.matchedMakeupDb.toFixed(2)} dB; guarded ${String(ramp.ramp.cutoffHz).padStart(5)} Hz, ` +
        `${ramp.ramp.makeupDb[0]!.toFixed(2)} dB, step ${jumpCents(ramp, ramp.ramp.centroidHz).toFixed(0)} ` +
        `cents (open ${jumpCents(ramp, ramp.openHz).toFixed(0)})`,
    );
  }
}

/** One root to a line, its columns lined up, so a layer reads down the keyboard at a glance. */
function renderRoot(root: ToneRoot): string {
  const pad = (value: number, width: number, digits = 0) => value.toFixed(digits).padStart(width);
  const own = `midi: ${pad(root.midi, 3)}, centroidHz: ${pad(root.centroidHz, 6, 1)}`;
  if (!root.ramp) return `          { ${own} },`;
  const { matchedCutoffHz, cutoffHz, centroidHz, makeupDb } = root.ramp;
  const ramp =
    `matchedCutoffHz: ${pad(matchedCutoffHz, 5)}, cutoffHz: ${pad(cutoffHz, 5)}, ` +
    `centroidHz: ${pad(centroidHz, 6, 1)}, ` +
    `makeupDb: [${makeupDb.map((db) => db.toFixed(3)).join(', ')}]`;
  return `          { ${own}, ramp: { ${ramp} } },`;
}

function renderTable(packs: readonly Pack[]): string {
  const summary = packs
    .map((pack) =>
      [` *   ${pack.version}`, ...summaryLines(pack).map((line) => ` *     ${line}`)].join('\n'),
    )
    .join('\n');
  const layer = ({ roots }: ToneCalibration['layers'][number]) =>
    ['      {', '        roots: [', ...roots.map(renderRoot), '        ],', '      },'].join('\n');
  const rows = packs
    .map((pack) =>
      [
        `  '${pack.version}': {`,
        '    layers: [',
        ...pack.table.layers.map(layer),
        '    ],',
        '  },',
      ].join('\n'),
    )
    .join('\n');
  return `/**
 * How bright every recording of the grand pianos is, and the lowpass ramp that
 * makes each velocity layer's tone follow the touch: the tone calibration's
 * table. What the numbers mean, and how a voice's filter comes from them, is
 * toneCalibrationMath.ts.
 *
 * GENERATED — do not edit. Every number is measured from the committed sample
 * packs, so editing one by hand only makes a note play at the wrong tone.
 * Regenerate with:
 *
 *   npx vitest run --config vitest.tools.config.ts tests/tools/generateToneCalibration.ts
 *
 * Brightness is each recording's spectral centroid, in Hz, as its voice plays
 * over the ${BRIGHTNESS_WINDOW_S * 1000} ms after its onset, heard at ${ANALYSIS_RATE / 1000} kHz. A ramp's cutoffs
 * are in Hz at the recording's own pitch: where the search met the layer
 * below, and where the ramp starts, never under ${FUNDAMENTAL_GUARD} times the root's
 * fundamental. Its make-up is in dB at every eighth of the way up. Keyed by
 * pack version: a published pack never changes, so neither does its entry.
 * One recording to a line, which the formatter would spread over ten.
 *
${summary}
 */
import type { ToneCalibration } from './toneCalibrationMath';

// prettier-ignore
export const TONE_CALIBRATIONS: Readonly<Record<string, ToneCalibration>> = {
${rows}
};
`;
}

// Decoding 180 recordings and searching 120 ramps runs past the default per-test timeout.
it('generates the tone calibration', { timeout: 900_000 }, async () => {
  const packs: Pack[] = [];
  for (const instrument of PIANO_INSTRUMENTS) {
    const manifestPath = path.join(
      ROOT,
      'public',
      'piano',
      instrument.packVersion,
      'manifest.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SamplePackManifest;
    // A pack mapped by regions (the Wurlitzer) keeps its own velocity model.
    if (manifest.regions) continue;
    expect(manifest.version).toBe(instrument.packVersion);

    const pack = await measurePack(instrument.packVersion, manifest);
    packs.push(pack);

    console.log(`\n${pack.version}:`);
    for (const line of summaryLines(pack)) console.log(`  ${line}`);
    reportGuardCandidates(pack);
    reportTopOctave(pack);
    const worstMakeup = Math.max(...pack.ramps.map((ramp) => ramp.makeupErrorDb));
    console.log(`  make-up between the table's points: within ${worstMakeup.toFixed(3)} dB`);

    const loudest = pack.ramps.reduce((a, b) => (b.rampPeak > a.rampPeak ? b : a));
    const over = pack.ramps.reduce((a, b) => (b.rampPeakOverFullDb > a.rampPeakOverFullDb ? b : a));
    console.log(
      `  loudest voice on a ramp: ${loudestRampDb(pack).toFixed(2)} dBFS, ${noteName(loudest.midi)} ` +
        `${LAYER_NAMES[loudest.layer]} at ${loudest.rampPeakVelocity.toFixed(4)}; at full velocity ` +
        `${pack.loudestFullDb.toFixed(2)} dBFS, and ${worstFullDb().toFixed(2)} on the loudest ` +
        `pack; furthest over its own recording at full velocity: ` +
        `${over.rampPeakOverFullDb.toFixed(2)} dB, ${noteName(over.midi)} ${LAYER_NAMES[over.layer]} ` +
        `at ${over.rampPeakVelocity.toFixed(4)}`,
    );

    for (const ramp of pack.ramps) {
      const where = `${pack.version} ${noteName(ramp.midi)} ${LAYER_NAMES[ramp.layer]}`;
      // Matched outright, the ramp meets the layer below.
      if (!guarded(ramp)) {
        expect(Math.abs(jumpCents(ramp, ramp.ramp.centroidHz)), where).toBeLessThan(5);
      }
      expect(ramp.makeupErrorDb, where).toBeLessThanOrEqual(MAKEUP_TOLERANCE_DB);
    }
    // No voice on a ramp peaks past the loudest any pack's voice does at full
    // velocity, the worst case the output headroom spec drives the graph with.
    // (Close under the top, a ramp's filter all but open can lift a peak a
    // little past its own recording's at full velocity: the run prints how far.)
    expect(loudestRampDb(pack)).toBeLessThan(worstFullDb());
  }

  const source = renderTable(packs);
  const options = await prettier.resolveConfig(TABLE_PATH);
  await writeFile(TABLE_PATH, await prettier.format(source, { ...options, filepath: TABLE_PATH }));
  console.log(`\nWrote ${path.relative(ROOT, TABLE_PATH)} for ${packs.length} packs.`);
});

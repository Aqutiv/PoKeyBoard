/**
 * Generates src/audio/velocityCalibration.ts: how loudly every recording of
 * every grand piano pack was made, the curve through each layer, and the
 * reference level that keeps each pack as loud as it was. See
 * velocityCalibrationMath.ts for what the numbers are for.
 *
 * Each recording is decoded from the committed pack (ffmpeg, as the pack build
 * does, so it must be on the PATH), its onset found exactly as the sample bank
 * finds it (`onsetOffsetOf`), and its level measured over the 300 ms a voice
 * plays from there: K-weighted as BS.1770 weights loudness, the mean square of
 * both channels summed. That holds the attack and the start of the decay,
 * which is what the ear judges a struck note by, and it is a steady measure:
 * the step it leaves between two layers of a root moves by at most 0.2 dB
 * measured over 400 ms instead, and 0.5 dB over a whole second, where the
 * layers' different decays start to tell. The run prints those figures.
 *
 * The table is machine-owned: regenerating overwrites it. Only needed when a
 * pack is added or rebuilt as a new version; published packs never change.
 * Not part of `npm test` (which only globs tests/unit and tests/integration).
 * Run it explicitly:
 *
 *   npx vitest run --config vitest.tools.config.ts tests/tools/generateVelocityCalibration.ts
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as prettier from 'prettier';
import { expect, it } from 'vitest';
import type { SamplePackManifest } from '@/audio/audioTypes';
import { PIANO_INSTRUMENTS } from '@/audio/instruments';
import { kWeighting } from '@/audio/loudness';
import { onsetOffsetOf, velocityGain, velocityToLayer } from '@/audio/SampleBank';
import {
  ANCHOR_HIGH_MIDI,
  ANCHOR_LOW_MIDI,
  calibratedGain,
  calibrateLayers,
  MAX_RESIDUAL_DB,
  nearestRoot,
  solveReferenceDb,
  TILT_LAYER,
  type LayerCalibration,
  type VelocityCalibration,
} from '@/audio/velocityCalibrationMath';
import { CURVE_REFERENCE_VELOCITY } from '@/audio/velocityCurve';

// Paths hang off the project root: under jsdom, import.meta.url is an http
// URL rather than a file one, so it cannot anchor them.
const ROOT = process.cwd();
const TABLE_PATH = path.join(ROOT, 'src/audio/velocityCalibration.ts');

/** The window every level is measured over, from the recording's onset. */
const WINDOW_S = 0.3;
/** The windows the run compares it with, to show how much the choice moves. */
const CHECK_WINDOWS_S = [0.4, 1];
/** Enough of each file to hold the onset search and the longest window. */
const DECODE_S = 1.4;

interface Recording {
  channels: Float32Array[];
  sampleRate: number;
}

/** Native rate and channel count, from the FLAC STREAMINFO block. */
function streamInfo(bytes: Buffer): { sampleRate: number; channels: number } {
  if (bytes.toString('ascii', 0, 4) !== 'fLaC' || (bytes[4]! & 127) !== 0) {
    throw new Error('Expected a native FLAC stream');
  }
  const packed = bytes.readBigUInt64BE(18);
  return { sampleRate: Number(packed >> 44n), channels: Number((packed >> 41n) & 7n) + 1 };
}

/** The opening of a pack file, decoded at its own rate, one array per channel. */
async function decode(file: string): Promise<Recording> {
  const { sampleRate, channels } = streamInfo(await readFile(file));
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-t', String(DECODE_S), '-i', file, '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
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
  return { channels: data, sampleRate };
}

/**
 * K-weighted mean square over `[fromS, fromS + seconds)`, channels summed, in
 * dB the way BS.1770 reports it. The filters run from the top of the file, so
 * they have settled by the time the window opens.
 */
function kWeightedLevelDb(recording: Recording, fromS: number, seconds: number): number {
  const { channels, sampleRate } = recording;
  const [shelf, pass] = kWeighting(sampleRate);
  const from = Math.round(fromS * sampleRate);
  const to = Math.min(channels[0]!.length, from + Math.round(seconds * sampleRate));
  let power = 0;
  for (const samples of channels) {
    let shelf1 = 0;
    let shelf2 = 0;
    let pass1 = 0;
    let pass2 = 0;
    let sum = 0;
    for (let i = 0; i < to; i += 1) {
      const input = samples[i] as number;
      const shelved = shelf.b0 * input + shelf1;
      shelf1 = shelf.b1 * input - shelf.a1 * shelved + shelf2;
      shelf2 = shelf.b2 * input - shelf.a2 * shelved;
      const weighted = shelved + pass1;
      pass1 = -2 * shelved - pass.a1 * weighted + pass2;
      pass2 = shelved - pass.a2 * weighted;
      if (i >= from) sum += weighted * weighted;
    }
    power += sum / (to - from);
  }
  return -0.691 + 10 * Math.log10(power);
}

/** A stand-in AudioBuffer, enough for `onsetOffsetOf`. */
function asAudioBuffer({ channels, sampleRate }: Recording): AudioBuffer {
  return {
    sampleRate,
    length: channels[0]!.length,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel]!,
  } as unknown as AudioBuffer;
}

interface Measured {
  layer: number;
  midi: number;
  levelDb: number;
  /** The same recording over each of `CHECK_WINDOWS_S`. */
  checkDb: number[];
}

async function measurePack(packVersion: string, manifest: SamplePackManifest) {
  const dir = path.join(ROOT, 'public', 'piano', packVersion);
  const measured: Measured[] = [];
  const queue = [...manifest.files];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const recording = await decode(path.join(dir, entry.file));
        const onset = onsetOffsetOf(asAudioBuffer(recording));
        measured.push({
          layer: entry.layer,
          midi: entry.midi,
          levelDb: kWeightedLevelDb(recording, onset, WINDOW_S),
          checkDb: CHECK_WINDOWS_S.map((seconds) => kWeightedLevelDb(recording, onset, seconds)),
        });
      }
    }),
  );
  return measured;
}

/** The meter itself, checked against BS.1770's own calibration before it measures anything. */
function checkMeter(): void {
  const sampleRate = 48_000;
  const sine = new Float32Array(sampleRate);
  for (let i = 0; i < sine.length; i += 1) {
    sine[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  }
  // A full-scale 1 kHz sine in one channel reads −3.01 LKFS.
  const silence = new Float32Array(sampleRate);
  expect(kWeightedLevelDb({ channels: [sine, silence], sampleRate }, 0.5, 0.3)).toBeCloseTo(
    -3.01,
    1,
  );
}

/**
 * How far each layer boundary's step would move had loudness been judged over
 * another window: the difference between two layers of a root, measured the
 * other way, less the same difference over `WINDOW_S`.
 */
function reportWindowCheck(measured: readonly Measured[]): void {
  const at = (layer: number, midi: number) =>
    measured.find((entry) => entry.layer === layer && entry.midi === midi);
  for (const [index, seconds] of CHECK_WINDOWS_S.entries()) {
    const moves: number[] = [];
    for (const upper of measured) {
      const lower = at(upper.layer - 1, upper.midi);
      if (!lower) continue;
      const step = upper.levelDb - lower.levelDb;
      moves.push(upper.checkDb[index]! - lower.checkDb[index]! - step);
    }
    const meanAbs = moves.reduce((sum, move) => sum + Math.abs(move), 0) / moves.length;
    const worst = Math.max(...moves.map(Math.abs));
    console.log(
      `  over ${seconds * 1000} ms instead, the boundary steps would move ` +
        `${meanAbs.toFixed(2)} dB on average, ${worst.toFixed(2)} dB at most`,
    );
  }
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

/** The roots the limit held back, and by how much each still plays off its target. */
function heldBackRoots(calibration: VelocityCalibration): string[] {
  const shifts = new Map<number, number>();
  for (const layer of calibration.layers) {
    for (const root of layer.roots) {
      const shift = root.measuredDb - root.correctedDb;
      if (Math.abs(shift) > Math.abs(shifts.get(root.midi) ?? 0)) shifts.set(root.midi, shift);
    }
  }
  return [...shifts]
    .filter(([, shift]) => Math.abs(shift) >= 0.005)
    .sort(([a], [b]) => a - b)
    .map(
      ([midi, shift]) => `${noteName(midi)} ${shift > 0 ? '+' : '−'}${Math.abs(shift).toFixed(1)}`,
    );
}

function renderLayer(layer: LayerCalibration): string {
  const roots = layer.roots
    .map(
      (root) =>
        `{ midi: ${root.midi}, measuredDb: ${round(root.measuredDb, 2)}, correctedDb: ${round(root.correctedDb, 2)} },`,
    )
    .join('\n');
  const fit = layer.fit.map((term) => round(term, 4)).join(', ');
  return `{
    fit: [${fit}],
    rmsResidualDb: ${round(layer.rmsResidualDb, 2)},
    roots: [
      ${roots}
    ],
  },`;
}

function renderTable(packs: readonly { version: string; calibration: VelocityCalibration }[]) {
  const summary = packs
    .map(({ version, calibration }) => {
      const quality = calibration.layers
        .map((layer, index) => `${LAYER_NAMES[index]} ${layer.rmsResidualDb.toFixed(2)}`)
        .join(', ');
      const held = heldBackRoots(calibration);
      return [
        ` *   ${version}`,
        ` *     fit RMS residual, dB: ${quality}`,
        ` *     held back, dB left over target: ${held.length > 0 ? held.join(', ') : 'none'}`,
      ].join('\n');
    })
    .join('\n');
  const rows = packs
    .map(
      ({ version, calibration }) => `'${version}': {
    referenceDb: ${round(calibration.referenceDb, 3)},
    layers: [
      ${calibration.layers.map(renderLayer).join('\n')}
    ],
  },`,
    )
    .join('\n');
  return `/**
 * How loudly every recording of the grand pianos was made, and where each
 * pack's notes are aimed: the velocity calibration's table. What the numbers
 * mean, and how a voice's gain comes from them, is velocityCalibrationMath.ts.
 *
 * GENERATED — do not edit. Every number is measured from the committed sample
 * packs, so editing one by hand only makes a note play at the wrong level.
 * Regenerate with:
 *
 *   npx vitest run --config vitest.tools.config.ts tests/tools/generateVelocityCalibration.ts
 *
 * Levels are in dB as BS.1770 measures loudness, over the ${WINDOW_S * 1000} ms after each
 * recording's onset; fits are quadratics in octaves from middle C. A root
 * whose recordings stray more than ${MAX_RESIDUAL_DB} dB from their fits is held back to
 * that, and plays off its target by what is left. Keyed by pack version: a
 * published pack never changes, so neither does its entry.
 *
${summary}
 */
import type { VelocityCalibration } from './velocityCalibrationMath';

export const VELOCITY_CALIBRATIONS: Readonly<Record<string, VelocityCalibration>> = {
  ${rows}
};
`;
}

// Decoding 180 recordings runs past the default per-test timeout.
it('generates the velocity calibration', { timeout: 600_000 }, async () => {
  checkMeter();
  const packs: { version: string; calibration: VelocityCalibration }[] = [];
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

    const measured = await measurePack(instrument.packVersion, manifest);
    const layers = calibrateLayers(measured);
    expect(layers.map((_, index) => index)).toEqual(
      manifest.velocityLayers.map((layer) => layer.index),
    );

    // The anchor: C3–B5 at the computer keyboard's velocity, as loud as the
    // old trims and the pack's level match played them.
    const velocity = CURVE_REFERENCE_VELOCITY;
    const oldLayer = velocityToLayer(velocity);
    expect(oldLayer).toBe(TILT_LAYER);
    const levelMatch =
      manifest.velocityLayers.find((entry) => entry.index === oldLayer)?.levelMatch ?? 1;
    const oldGainDb = 20 * Math.log10(velocityGain(velocity, oldLayer) * levelMatch);
    const draft: VelocityCalibration = { referenceDb: 0, layers };
    const medium = layers[oldLayer]!.roots;
    const today: number[] = [];
    const relative: number[] = [];
    for (let midi = ANCHOR_LOW_MIDI; midi <= ANCHOR_HIGH_MIDI; midi += 1) {
      const root = nearestRoot(
        medium.map((entry) => entry.midi),
        midi,
      )!;
      const recorded = medium.find((entry) => entry.midi === root)!.measuredDb;
      const gain = calibratedGain(draft, velocity, midi, oldLayer, root)!;
      today.push(recorded + oldGainDb);
      relative.push(recorded + 20 * Math.log10(gain));
    }
    const calibration = { referenceDb: solveReferenceDb(today, relative), layers };
    packs.push({ version: instrument.packVersion, calibration });

    console.log(`\n${instrument.packVersion}: reference ${calibration.referenceDb.toFixed(2)} dB`);
    for (const [index, layer] of layers.entries()) {
      const fit = layer.fit.map((term) => term.toFixed(3)).join(', ');
      console.log(
        `  ${LAYER_NAMES[index]}: fit [${fit}], RMS residual ${layer.rmsResidualDb.toFixed(2)} dB`,
      );
    }
    const held = heldBackRoots(calibration);
    console.log(`  held back: ${held.length > 0 ? held.join(', ') : 'none'}`);
    reportWindowCheck(measured);
  }

  const source = renderTable(packs);
  const options = await prettier.resolveConfig(TABLE_PATH);
  await writeFile(TABLE_PATH, await prettier.format(source, { ...options, filepath: TABLE_PATH }));
  console.log(`\nWrote ${path.relative(ROOT, TABLE_PATH)} for ${packs.length} packs.`);
});

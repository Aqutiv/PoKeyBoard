import { kWeighting, type Biquad } from './loudness';
import { ATTACK_S, TONE_FILTER_Q_DB } from './sampleVoice';

/**
 * The arithmetic of the tone calibration, pure so the generator
 * (tests/tools/generateToneCalibration.ts), the sample bank and the tests all
 * share it.
 *
 * A grand pack is three recordings of every third key — soft, medium and loud
 * — and the velocity calibration plays each at the loudness its velocity asks
 * for (velocityCalibrationMath.ts). Loudness is not all a harder blow changes,
 * though: it brings the upper partials out, and on their own the recordings
 * step in brightness wherever one layer hands over to the next, by 200 to 900
 * cents of spectral centroid around middle C, as the piano goes. So every voice
 * of the medium and loud layers plays through a lowpass whose cutoff follows
 * its velocity across its layer:
 *
 *   at the layer's bottom, the cutoff that brings its recording down to the
 *   brightness of the layer below's, at the same root (the generator searches
 *   for it); at the layer's top, open; in between, evenly in log frequency.
 *
 * The soft layer has nothing below it to meet and always plays open. A filter
 * takes loudness with it, and the voice gives that back (the make-up), less
 * and less as the filter opens, so every note stays on the velocity curve.
 *
 * Brightness is the spectral centroid of the voice as it plays — from its
 * onset, through its filter, under the envelope's attack — over its first
 * 300 ms, the window the velocity calibration hears loudness over: the
 * magnitude-weighted mean frequency between 30 Hz and 10 kHz. Weighted by
 * magnitude rather than power, it follows the partials that make a note bright
 * rather than the few strongest at the bottom, which power weighting lets
 * decide it alone; stopped at 10 kHz, it leaves out the hiss above, which a
 * quiet recording carries as much of as a loud one and which would otherwise
 * count as brightness.
 *
 * The cutoffs are per root, not per layer: they climb with pitch from half a
 * kilohertz to two in the bass, as the piano goes, to several at the top, and
 * move smoothly from one root to the next. At the very top, though, a match can fall at or under the
 * note's own fundamental: up there the measure sits close to the fundamental,
 * and only taking the note itself down moves it, with up to 4.5 dB to give
 * back. So no ramp starts below `FUNDAMENTAL_GUARD` times its root's
 * fundamental, and those keys keep a smaller correction.
 */

/** Where every ramp opens out to: a lowpass this high leaves all a piano plays alone. */
export const OPEN_CUTOFF_HZ = 20_000;

/**
 * The top guard: no ramp starts below this many times its root's fundamental,
 * nor, scaled by the playback rate, any note below this many times its own.
 * Measured across the grands (the generator prints the comparison): at 2.5 a
 * guarded note's fundamental loses 0.14 dB, and no guarded ramp needs more than
 * 0.4 dB of make-up, within the 0.2–0.6 dB the middle of the keyboard needs,
 * where the ramps were approved by ear. At 2 that reaches 0.7 dB, and at 3 or
 * 4 the top two octaves keep less of their correction.
 */
export const FUNDAMENTAL_GUARD = 2.5;

/** How many points of each ramp the table holds the make-up at: every eighth of the way up. */
export const MAKEUP_POINTS = 8;

/** The window brightness is heard over, from the voice's start. */
export const BRIGHTNESS_WINDOW_S = 0.3;

/** The band brightness is heard in; see above. */
export const BRIGHTNESS_LOW_HZ = 30;
export const BRIGHTNESS_HIGH_HZ = 10_000;

/** The window's end is faded over this long, so its edge adds no brightness of its own. */
const BRIGHTNESS_TAPER_S = 0.005;

/** The transform's length: 16,384 points, zero-padded past the window. */
const BRIGHTNESS_FFT_SIZE = 16_384;

/** How closely the search pins a cutoff down: a ratio of 1.0001, a fifth of a cent. */
const SEARCH_PRECISION = 1e-4;

/** The ramp that tones one recording, as the table holds it. */
export interface ToneRamp {
  /** Where the search met the layer below's brightness, in Hz at the recording's pitch. */
  matchedCutoffHz: number;
  /** The cutoff at the layer's bottom: the match, lifted where the top guard binds. */
  cutoffHz: number;
  /** The recording's brightness through that cutoff, in Hz. */
  centroidHz: number;
  /**
   * What the filter takes from the recording's loudness, K-weighted, at every
   * eighth of the way up the ramp from its bottom, in dB; nothing at its top.
   */
  makeupDb: readonly number[];
}

export interface ToneRoot {
  midi: number;
  /** The recording's own brightness, played open, in Hz. */
  centroidHz: number;
  /** How it is darkened from its layer's bottom up; none on the soft layer. */
  ramp?: ToneRamp;
}

export interface ToneLayer {
  /** Every recorded root of the layer, low to high. */
  roots: readonly ToneRoot[];
}

export interface ToneCalibration {
  /** One per velocity layer, by index. */
  layers: readonly ToneLayer[];
}

/** A voice's filter: its cutoff at the recording's own pitch, and the make-up it needs. */
export interface VoiceTone {
  cutoffHz: number;
  makeupDb: number;
}

/** A key's fundamental, equal-tempered from A4 at 440 Hz. */
export function fundamentalHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A matched bottom cutoff, held at or above the top guard for its root. */
export function guardedCutoffHz(matchedHz: number, midi: number): number {
  return Math.max(matchedHz, FUNDAMENTAL_GUARD * fundamentalHz(midi));
}

/** How far `velocity` sits along a layer's span, from 0 at `bottom` to 1 at `top`. */
export function rampPosition(velocity: number, bottom: number, top: number): number {
  return Math.min(1, Math.max(0, (velocity - bottom) / (top - bottom)));
}

/** A ramp's cutoff `position` of the way up: evenly in log frequency, from its bottom to open. */
export function rampCutoffHz(bottomHz: number, position: number): number {
  return bottomHz * (OPEN_CUTOFF_HZ / bottomHz) ** position;
}

/**
 * The make-up `position` of the way up a ramp, from the table's points. The
 * loss falls away with the cutoff about as a power of it, so between two
 * points it is interpolated geometrically, which follows it to within 0.03 dB;
 * from a last point to nothing, and at the top, where the filter is open,
 * there is nothing to make up.
 */
export function makeupAt(makeupDb: readonly number[], position: number): number {
  if (!(position < 1)) return 0;
  const along = Math.max(0, position) * makeupDb.length;
  const index = Math.floor(along);
  const from = makeupDb[index] ?? 0;
  const to = makeupDb[index + 1] ?? 0;
  const fraction = along - index;
  return from > 0 && to > 0 ? from * (to / from) ** fraction : from + (to - from) * fraction;
}

/** A ramp's filter `position` of the way up it; none once it is open. */
export function toneAt(ramp: ToneRamp, position: number): VoiceTone | undefined {
  if (!(position < 1)) return undefined;
  return {
    cutoffHz: rampCutoffHz(ramp.cutoffHz, position),
    makeupDb: makeupAt(ramp.makeupDb, position),
  };
}

/** The ramp for the recording of `root` on `layer`, if the table holds one. */
export function toneRamp(
  calibration: ToneCalibration,
  layer: number,
  root: number,
): ToneRamp | undefined {
  return calibration.layers[layer]?.roots.find((entry) => entry.midi === root)?.ramp;
}

/**
 * The filter a note plays through, at the recording's own pitch: a note struck
 * at `velocity` asks for layer `requested`, and the bank found the recording
 * of `root` on `layer`. `thresholds` are where each layer above the first
 * begins (the sample bank's `VELOCITY_LAYER_THRESHOLDS`).
 *
 * Found on the layer it asked for, a note plays that layer's ramp. During a
 * partial load another layer can stand in: one from a brighter layer plays at
 * its ramp's bottom, as dark as the table takes it, which is as near as it can
 * come to the tone asked for; one from a darker layer plays open, being darker
 * already. Either way its make-up keeps it on the curve.
 */
export function voiceTone(
  calibration: ToneCalibration,
  thresholds: readonly number[],
  velocity: number,
  requested: number,
  layer: number,
  root: number,
): VoiceTone | undefined {
  const ramp = toneRamp(calibration, layer, root);
  if (!ramp || layer < requested) return undefined;
  if (layer > requested) return toneAt(ramp, 0);
  const bottom = thresholds[layer - 1] ?? 0;
  const top = thresholds[layer] ?? 1;
  return toneAt(ramp, rampPosition(velocity, bottom, top));
}

/**
 * Whether the table holds every one of these recordings, with a ramp for
 * every one above the soft layer.
 */
export function toneCalibrationCovers(
  calibration: ToneCalibration,
  files: readonly { layer: number; midi: number }[],
): boolean {
  return files.every((file) => {
    const root = calibration.layers[file.layer]?.roots.find((entry) => entry.midi === file.midi);
    return root !== undefined && (file.layer === 0 || root.ramp !== undefined);
  });
}

/** How far `hz` lies above `referenceHz`, in cents. */
export function centsBetween(hz: number, referenceHz: number): number {
  return 1200 * Math.log2(hz / referenceHz);
}

// The measurement, for the generator and the tests.

/**
 * Web Audio's lowpass at `cutoffHz`, its Q read as dB (`TONE_FILTER_Q_DB`):
 * the coefficients a BiquadFilterNode computes, normalised. At or past
 * Nyquist it passes everything, as the node does.
 */
export function webAudioLowpass(
  cutoffHz: number,
  sampleRate: number,
  qDb: number = TONE_FILTER_Q_DB,
): Biquad {
  const normalized = cutoffHz / (sampleRate / 2);
  if (normalized >= 1) return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  const theta = Math.PI * normalized;
  const alpha = Math.sin(theta) / (2 * 10 ** (qDb / 20));
  const cos = Math.cos(theta);
  const a0 = 1 + alpha;
  const b = (1 - cos) / 2 / a0;
  return { b0: b, b1: 2 * b, b2: b, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** A biquad's gain at `hz`, in dB. */
export function biquadGainDb(biquad: Biquad, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const [c1, s1, c2, s2] = [Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w)];
  const numerator =
    (biquad.b0 + biquad.b1 * c1 + biquad.b2 * c2) ** 2 + (biquad.b1 * s1 + biquad.b2 * s2) ** 2;
  const denominator =
    (1 + biquad.a1 * c1 + biquad.a2 * c2) ** 2 + (biquad.a1 * s1 + biquad.a2 * s2) ** 2;
  return 10 * Math.log10(numerator / denominator);
}

/** `input` through a biquad from silence, as a voice's filter starts with its voice. */
export function applyBiquad(input: ArrayLike<number>, biquad: Biquad): Float64Array {
  const { b0, b1, b2, a1, a2 } = biquad;
  const output = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i] as number;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[i] = y;
  }
  return output;
}

/**
 * The first `BRIGHTNESS_WINDOW_S` of a recording's voice, from where the bank
 * starts it (`offsetS`, its onset; see `onsetOffsetOf`).
 */
export function voiceWindow(
  channels: readonly Float32Array[],
  offsetS: number,
  sampleRate: number,
): Float32Array[] {
  const from = Math.round(offsetS * sampleRate);
  const to = from + Math.round(BRIGHTNESS_WINDOW_S * sampleRate);
  return channels.map((samples) => samples.subarray(from, to));
}

/**
 * A voice as it sounds: through its tone filter at `cutoffHz`, if it has one,
 * and under the envelope's attack, which rises from silence over `ATTACK_S`.
 * The attack matters: a recording that starts on its hammer (the Headroom
 * piano's do) loses the first click of it there, and reads darker for that.
 */
export function playedVoice(
  channels: readonly ArrayLike<number>[],
  sampleRate: number,
  cutoffHz?: number,
): Float64Array[] {
  const filter = cutoffHz === undefined ? undefined : webAudioLowpass(cutoffHz, sampleRate);
  const attack = ATTACK_S * sampleRate;
  return channels.map((samples) => {
    const played = filter ? applyBiquad(samples, filter) : Float64Array.from(samples);
    for (let i = 0; i < attack && i < played.length; i += 1) {
      played[i] = (played[i] as number) * (i / attack);
    }
    return played;
  });
}

/** An in-place radix-2 transform of `re + i·im`, whose length is a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = -Math.sin((2 * Math.PI * k) / n);
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const wr = cos[k * stride] as number;
        const wi = sin[k * stride] as number;
        const a = start + k;
        const b = a + half;
        const br = re[b] as number;
        const bi = im[b] as number;
        const tr = br * wr - bi * wi;
        const ti = br * wi + bi * wr;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
      }
    }
  }
}

/**
 * A voice's brightness: the magnitude-weighted spectral centroid of `channels`
 * (a window of it, the end faded over 5 ms), between 30 Hz and 10 kHz, the
 * channels' energy summed.
 */
export function spectralCentroidHz(
  channels: readonly ArrayLike<number>[],
  sampleRate: number,
): number {
  const length = Math.min(...channels.map((samples) => samples.length));
  let size = BRIGHTNESS_FFT_SIZE;
  while (size < length) size *= 2;
  const taper = Math.round(BRIGHTNESS_TAPER_S * sampleRate);
  const weight = (i: number) =>
    i < length - taper ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * (length - i)) / taper);
  const energy = new Float64Array(size / 2);
  // Two real channels ride one complex transform, the first as its real part
  // and the second as its imaginary; each bin's energy, summed over both, is
  // then the mean of its own and its mirror's.
  for (let channel = 0; channel < channels.length; channel += 2) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const first = channels[channel]!;
    const second = channels[channel + 1];
    for (let i = 0; i < length; i += 1) {
      re[i] = (first[i] as number) * weight(i);
      if (second) im[i] = (second[i] as number) * weight(i);
    }
    fft(re, im);
    for (let k = 1; k < size / 2; k += 1) {
      const mirror = size - k;
      energy[k] =
        (energy[k] as number) +
        ((re[k] as number) ** 2 +
          (im[k] as number) ** 2 +
          (re[mirror] as number) ** 2 +
          (im[mirror] as number) ** 2) /
          2;
    }
  }
  let weighted = 0;
  let total = 0;
  for (let k = 1; k < size / 2; k += 1) {
    const hz = (k * sampleRate) / size;
    if (hz < BRIGHTNESS_LOW_HZ || hz > BRIGHTNESS_HIGH_HZ) continue;
    const magnitude = Math.sqrt(energy[k] as number);
    weighted += hz * magnitude;
    total += magnitude;
  }
  return weighted / total;
}

/** The K-weighted mean square of `channels`, summed over them: loudness as BS.1770 weighs it. */
export function kWeightedPower(channels: readonly ArrayLike<number>[], sampleRate: number): number {
  const [shelf, highPass] = kWeighting(sampleRate);
  let power = 0;
  for (const samples of channels) {
    const weighted = applyBiquad(applyBiquad(samples, shelf), highPass);
    let sum = 0;
    for (const sample of weighted) sum += sample * sample;
    power += sum / weighted.length;
  }
  return power;
}

/**
 * What a tone filter at `cutoffHz` takes from a voice's loudness, in dB: the
 * make-up that gives it back. `channels` is a window of the voice as recorded.
 */
export function filterLossDb(
  channels: readonly ArrayLike<number>[],
  sampleRate: number,
  cutoffHz: number,
): number {
  const open = kWeightedPower(playedVoice(channels, sampleRate), sampleRate);
  const filtered = kWeightedPower(playedVoice(channels, sampleRate, cutoffHz), sampleRate);
  return 10 * Math.log10(open / filtered);
}

/**
 * The cutoff at which `measureAt` — a brightness that rises as the cutoff
 * does — meets `target`, searched between `lowHz` and `highHz` by halving the
 * interval in log frequency. A target past either end gives that end.
 */
export function searchCutoffHz(
  measureAt: (cutoffHz: number) => number,
  target: number,
  lowHz: number,
  highHz: number,
): number {
  if (measureAt(highHz) <= target) return highHz;
  if (measureAt(lowHz) >= target) return lowHz;
  let low = lowHz;
  let high = highHz;
  while (high / low > 1 + SEARCH_PRECISION) {
    const middle = Math.sqrt(low * high);
    if (measureAt(middle) > target) high = middle;
    else low = middle;
  }
  return Math.sqrt(low * high);
}

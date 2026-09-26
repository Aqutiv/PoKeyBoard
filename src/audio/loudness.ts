import { runInSlices, runToEnd, type SliceOptions, type Steps } from '@/utils/steps';
import { LIMITER_MAKEUP_DB, LIVE_OUTPUT_GAIN_DB } from './gainStaging';

/**
 * How loud an export is, and how it is kept from clipping.
 *
 * An export used to leave at whatever level the take happened to be played at,
 * with a peak check that could not fire: the graph's soft clipper tops out
 * below its threshold. So a quiet take made a quiet file and a loud one a file
 * sitting a hair under full scale, where an MP3 decoder's own overshoot clips
 * it. Loudness is measured the way broadcasters and streaming services measure
 * it, ITU-R BS.1770: K-weighted, gated, in LUFS. A take is brought to a common
 * level and a look-ahead limiter holds its loudest moments under a true-peak
 * ceiling, one that counts the peaks between samples a decoder reconstructs
 * as well as the samples themselves.
 *
 * Pure. A long take is tens of millions of samples, and each pass over them is
 * written as steps (`Steps`) that pause every few thousand frames: the worker
 * that encodes the MP3 runs them straight through, and the main thread, when
 * the worker cannot run, runs the same code a slice at a time so the page
 * never freezes for the seconds a pass can take there.
 */

/**
 * Frames a pass works through between pauses: well under a millisecond even
 * for the limiter, so a slice ends close to when it should.
 */
const FRAMES_PER_STEP = 4096;

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * BS.1770's K-weighting at any sample rate: a high shelf of about +4 dB above
 * 1.5 kHz for the head's own effect on sound, then a high-pass at 38 Hz. The
 * standard tabulates both at 48 kHz only; these are the analogue designs that
 * table was drawn from (the construction libebur128 uses), so every rate gets
 * the same curve and 48 kHz gets exactly the table.
 */
export function kWeighting(sampleRate: number): readonly [Biquad, Biquad] {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf: Biquad = {
    b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    b1: (2 * (shelfK * shelfK - vh)) / shelfA0,
    b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    a1: (2 * (shelfK * shelfK - 1)) / shelfA0,
    a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
  };

  const passK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const passQ = 0.5003270373238773;
  const passA0 = 1 + passK / passQ + passK * passK;
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (passK * passK - 1)) / passA0,
    a2: (1 - passK / passQ + passK * passK) / passA0,
  };
  return [shelf, highPass];
}

/** Gating blocks are 400 ms long and start every 100 ms. */
const STEP_S = 0.1;
const STEPS_PER_BLOCK = 4;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

function lufsOf(power: number): number {
  return -0.691 + 10 * Math.log10(power);
}

/**
 * Integrated loudness in LUFS, BS.1770-4: the mean K-weighted power of the
 * 400 ms blocks that are not silence (−70 LUFS) and not more than 10 LU below
 * the rest, so that pauses and a long reverb tail do not pull the figure down.
 * Every channel counts at unit weight, as the front pair does in the standard.
 * −Infinity when nothing is loud enough to measure, or shorter than a block.
 */
export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  return runToEnd(integratedLoudnessSteps(channels, sampleRate));
}

/** `integratedLoudness`, pausing after every 100 ms of each channel. */
function* integratedLoudnessSteps(
  channels: readonly Float32Array[],
  sampleRate: number,
): Steps<number> {
  const step = Math.round(sampleRate * STEP_S);
  const segments = Math.floor((channels[0]?.length ?? 0) / step);
  if (segments < STEPS_PER_BLOCK) return Number.NEGATIVE_INFINITY;

  // Weighted energy per 100 ms step, summed over channels; a block is four.
  const energy = new Float64Array(segments);
  const [shelf, highPass] = kWeighting(sampleRate);
  for (const samples of channels) {
    let shelf1 = 0;
    let shelf2 = 0;
    let pass1 = 0;
    let pass2 = 0;
    for (let segment = 0; segment < segments; segment += 1) {
      let sum = 0;
      const end = (segment + 1) * step;
      for (let i = segment * step; i < end; i += 1) {
        const input = samples[i] as number;
        // Transposed direct form II, one stage after the other.
        const shelved = shelf.b0 * input + shelf1;
        shelf1 = shelf.b1 * input - shelf.a1 * shelved + shelf2;
        shelf2 = shelf.b2 * input - shelf.a2 * shelved;
        const weighted = shelved + pass1;
        pass1 = -2 * shelved - highPass.a1 * weighted + pass2;
        pass2 = shelved - highPass.a2 * weighted;
        sum += weighted * weighted;
      }
      energy[segment] = (energy[segment] as number) + sum;
      yield;
    }
  }

  const blockLength = step * STEPS_PER_BLOCK;
  const blocks = new Float64Array(segments - STEPS_PER_BLOCK + 1);
  let running = 0;
  for (let segment = 0; segment < segments; segment += 1) {
    running += energy[segment] as number;
    if (segment >= STEPS_PER_BLOCK) running -= energy[segment - STEPS_PER_BLOCK] as number;
    if (segment >= STEPS_PER_BLOCK - 1) {
      blocks[segment - STEPS_PER_BLOCK + 1] = Math.max(0, running) / blockLength;
    }
  }

  const absolute = 10 ** ((ABSOLUTE_GATE_LUFS + 0.691) / 10);
  let sum = 0;
  let count = 0;
  for (const power of blocks) {
    if (power <= absolute) continue;
    sum += power;
    count += 1;
  }
  if (count === 0) return Number.NEGATIVE_INFINITY;
  const relative = (sum / count) * 10 ** (RELATIVE_GATE_LU / 10);
  sum = 0;
  count = 0;
  for (const power of blocks) {
    if (power <= absolute || power <= relative) continue;
    sum += power;
    count += 1;
  }
  return lufsOf(sum / count);
}

/** Taps either side of the point being reconstructed. */
const HALF_TAPS = 6;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k += 1) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

/**
 * A 4× windowed-sinc interpolator, twelve taps a phase like the one BS.1770
 * suggests: the value at a quarter, a half and three quarters of the way from
 * one sample to the next. Kaiser-windowed (β = 5), which reads a sine's crest
 * within 0.04 dB up to 16 kHz; each phase sums to one, so steady levels read
 * as themselves.
 */
const QUARTER_PHASES: readonly Float64Array[] = [0.25, 0.5, 0.75].map((offset) => {
  const taps = new Float64Array(HALF_TAPS * 2);
  let sum = 0;
  for (let j = 0; j < taps.length; j += 1) {
    const t = j - HALF_TAPS + 1 - offset;
    const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
    const window = besselI0(5 * Math.sqrt(Math.max(0, 1 - (t / HALF_TAPS) ** 2))) / besselI0(5);
    taps[j] = sinc * window;
    sum += taps[j] as number;
  }
  return taps.map((tap) => tap / sum);
});

/** The largest magnitude on the quarter points between `x[n]` and `x[n + 1]`. */
function peakBetween(x: Float32Array, n: number): number {
  const from = n - HALF_TAPS + 1;
  let peak = 0;
  for (const taps of QUARTER_PHASES) {
    let value = 0;
    for (let j = 0; j < taps.length; j += 1) {
      const index = from + j;
      if (index >= 0 && index < x.length) value += (taps[j] as number) * (x[index] as number);
    }
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/**
 * Whether the stretch from `x[n]` to `x[n + 1]` could hide a peak of `level`.
 * Between two samples a signal rises above the larger of them by under 6 dB
 * unless it carries energy above 16 kHz at nearly full scale, which a piano
 * does not; so only a stretch within 6 dB of the level is worth reconstructing.
 */
function mayReach(x: Float32Array, n: number, level: number): boolean {
  const half = level / 2;
  return Math.abs(x[n] as number) >= half || Math.abs(x[n + 1] as number) >= half;
}

/** The highest magnitude the signal reaches, between samples as well as on them. */
export function truePeak(channels: readonly Float32Array[]): number {
  return runToEnd(truePeakSteps(channels));
}

/** `truePeak`, pausing every `FRAMES_PER_STEP` frames of each channel. */
function* truePeakSteps(channels: readonly Float32Array[]): Steps<number> {
  let samplePeak = 0;
  for (const samples of channels) {
    for (let from = 0; from < samples.length; from += FRAMES_PER_STEP) {
      const to = Math.min(samples.length, from + FRAMES_PER_STEP);
      for (let i = from; i < to; i += 1) {
        const magnitude = Math.abs(samples[i] as number);
        if (magnitude > samplePeak) samplePeak = magnitude;
      }
      yield;
    }
  }
  let peak = samplePeak;
  for (const samples of channels) {
    // Every stretch from one sample to the next: all but the last sample start one.
    const stretches = samples.length - 1;
    for (let from = 0; from < stretches; from += FRAMES_PER_STEP) {
      const to = Math.min(stretches, from + FRAMES_PER_STEP);
      for (let n = from; n < to; n += 1) {
        if (!mayReach(samples, n, samplePeak)) continue;
        const between = peakBetween(samples, n);
        if (between > peak) peak = between;
      }
      yield;
    }
  }
  return peak;
}

/**
 * How far ahead the limiter sees a peak coming. Gain comes down over this long
 * — a straight ramp, long enough not to click on a piano's attack — and is
 * all the way down when the peak arrives.
 */
const LOOKAHEAD_S = 0.005;

/** How fast gain recovers after a peak: a time constant, not a fixed ramp. */
const RELEASE_S = 0.15;

/**
 * Bring every channel under `ceiling` — between samples too — turning them all
 * down together so the stereo image never swings, and only where they would
 * otherwise pass it. In place; returns the deepest reduction, in dB.
 *
 * The gain wanted at each frame is the ceiling over its peak. Taking the
 * minimum of that over the look-ahead window and then averaging over the same
 * window ramps the gain smoothly and still has it at or below the wanted value
 * on every frame: each average is of minima that all include that frame. The
 * release then eases it back, never above that answer either.
 */
export function limitTruePeak(
  channels: readonly Float32Array[],
  ceiling: number,
  sampleRate: number,
): number {
  return runToEnd(limitTruePeakSteps(channels, ceiling, sampleRate));
}

/**
 * `limitTruePeak`, pausing every `FRAMES_PER_STEP` frames. The window, its
 * minima and the gain all live in the generator's own variables, so a pause
 * picks up on the very next frame as if there had been none.
 */
function* limitTruePeakSteps(
  channels: readonly Float32Array[],
  ceiling: number,
  sampleRate: number,
): Steps<number> {
  const length = channels[0]?.length ?? 0;
  const window = Math.max(HALF_TAPS + 2, Math.round(LOOKAHEAD_S * sampleRate));
  const recover = 1 - Math.exp(-1 / (RELEASE_S * sampleRate));

  // Sliding minimum of the wanted gain over the last `window` frames.
  const minIndex = new Int32Array(window);
  const minValue = new Float64Array(window);
  let head = 0;
  let size = 0;
  // The last `window` of those minima, averaged.
  const minima = new Float64Array(window).fill(1);
  let minimaSum = window;
  let gain = 1;
  let deepest = 1;

  const frames = length + window - 1;
  for (let from = 0; from < frames; from += FRAMES_PER_STEP) {
    const to = Math.min(frames, from + FRAMES_PER_STEP);
    for (let n = from; n < to; n += 1) {
      let wanted = 1;
      if (n < length) {
        let peak = 0;
        for (const samples of channels) {
          const magnitude = Math.abs(samples[n] as number);
          if (magnitude > peak) peak = magnitude;
          if (n + 1 < length && mayReach(samples, n, ceiling)) {
            const between = peakBetween(samples, n);
            if (between > peak) peak = between;
          }
        }
        if (peak > ceiling) wanted = ceiling / peak;
      }

      // One frame leaves the window as this one joins it; out first, so the
      // queue never holds more than the window.
      if (size > 0 && (minIndex[head] as number) <= n - window) {
        head = (head + 1) % window;
        size -= 1;
      }
      while (size > 0 && (minValue[(head + size - 1) % window] as number) >= wanted) size -= 1;
      minIndex[(head + size) % window] = n;
      minValue[(head + size) % window] = wanted;
      size += 1;

      // The minimum for the window starting at `frame`. Windows that start
      // before the first frame are still counted, over the frames they do
      // reach: a loud attack in the take's first few milliseconds has to be
      // brought down in time as much as any other.
      const frame = n - window + 1;
      const minimum = minValue[head] as number;
      const slot = ((frame % window) + window) % window;
      minimaSum += minimum - (minima[slot] as number);
      minima[slot] = minimum;
      if (frame < 0) continue;
      gain = Math.min(minimaSum / window, gain + (1 - gain) * recover);
      if (gain < deepest) deepest = gain;
      if (gain < 1) {
        for (const samples of channels) samples[frame] = (samples[frame] as number) * gain;
      }
    }
    yield;
  }
  return 20 * Math.log10(deepest);
}

/**
 * What an export does with its level. `normalized` brings every take to one
 * loudness, so a quiet take can be heard on a phone and a loud one no longer
 * towers over it; `asPlayed` keeps the level the take was played at, so a
 * pianissimo stays one.
 */
export type LoudnessMode = 'normalized' | 'asPlayed';

/** A normalized export's loudness: Apple Music's level, a common target for streaming. */
export const TARGET_LUFS = -16;

/** Room left above the loudest moment for an MP3 decoder's own overshoot. */
export const CEILING_DBTP = -1;

/**
 * The most a normalized export turns its loudest moment down to reach the
 * target. A piano's attack is much of its sound, so a take that would need
 * more — a pianissimo piece with one crashing chord — stops short of the
 * target instead. The library's own tracks need at most about 4 dB.
 */
export const MAX_LIMITING_DB = 5;

/**
 * What `asPlayed` lifts the render by: all the gain live playback gives the
 * piano under its limiter's threshold — the output gain ahead of the limiter
 * and the limiter's own automatic makeup (`gainStaging.ts`) — which an export
 * leaves out along with the rest of that stage (`peakGuard`). With it, a take
 * kept at its played level is as loud as the app sounds at the default volume.
 */
export const LIVE_MAKEUP_DB = LIVE_OUTPUT_GAIN_DB + LIMITER_MAKEUP_DB;

/**
 * How far the metronome sits under the level it clicks at live. An accented
 * click at full volume peaks at full scale, which on its own would have the
 * limiter ducking the piano on every bar line.
 */
const CLICK_LEVEL = 0.5;

/**
 * The metronome as an export mixes it: one accented click and one plain one,
 * each rendered the way the live metronome sounds, and where each click of the
 * take falls. A few kilobytes, where a rendered click track would be another
 * full-length channel.
 */
export interface ClickTrack {
  /** Seconds from the start of the take. */
  atS: Float64Array;
  /** 1 where the click is a bar's accent. */
  accent: Uint8Array;
  accentSound: Float32Array;
  beatSound: Float32Array;
}

/**
 * Add every click of `track` to both channels, at `CLICK_LEVEL`, pausing after
 * each: a click is a few thousand frames, and a long take thousands of clicks.
 */
function* mixClicks(
  left: Float32Array,
  right: Float32Array,
  track: ClickTrack,
  sampleRate: number,
): Steps<void> {
  for (let c = 0; c < track.atS.length; c += 1) {
    const sound = track.accent[c] ? track.accentSound : track.beatSound;
    const at = Math.round((track.atS[c] as number) * sampleRate);
    const end = Math.min(sound.length, left.length - at);
    for (let j = Math.max(0, -at); j < end; j += 1) {
      const click = (sound[j] as number) * CLICK_LEVEL;
      left[at + j] = (left[at + j] as number) + click;
      right[at + j] = (right[at + j] as number) + click;
    }
    yield;
  }
}

export interface MasteringResult {
  /** The piano's loudness as rendered, before anything here touched it. */
  renderedLufs: number;
  /** What the piano was turned up (or down) by. */
  gainDb: number;
  /** The most the limiter then turned the loudest moment down, ≤ 0. */
  limitedDb: number;
}

/**
 * Finish a rendered take for export, in place: set the piano's level, mix in
 * the metronome if there is one (measured apart, so clicks never count toward
 * the piano's loudness), and hold the result under the true-peak ceiling. A
 * take too short or too quiet to measure keeps its played level.
 */
export function masterExport(
  left: Float32Array,
  right: Float32Array,
  clicks: ClickTrack | null,
  mode: LoudnessMode,
  sampleRate: number,
): MasteringResult {
  return runToEnd(masterExportSteps(left, right, clicks, mode, sampleRate));
}

/**
 * `masterExport` on the main thread, for when the worker cannot run it: the
 * same work a slice at a time, so the page can paint and take a click on
 * Cancel between slices, stopping at the next one once `options.signal` is
 * aborted. The samples come out exactly as `masterExport` leaves them.
 */
export function masterExportInSlices(
  left: Float32Array,
  right: Float32Array,
  clicks: ClickTrack | null,
  mode: LoudnessMode,
  sampleRate: number,
  options?: SliceOptions,
): Promise<MasteringResult> {
  return runInSlices(masterExportSteps(left, right, clicks, mode, sampleRate), options);
}

/** `masterExport` as steps, for either way of running it. */
function* masterExportSteps(
  left: Float32Array,
  right: Float32Array,
  clicks: ClickTrack | null,
  mode: LoudnessMode,
  sampleRate: number,
): Steps<MasteringResult> {
  const piano = [left, right];
  const renderedLufs = yield* integratedLoudnessSteps(piano, sampleRate);
  const ceiling = 10 ** (CEILING_DBTP / 20);
  let gain = 10 ** (LIVE_MAKEUP_DB / 20);
  if (mode === 'normalized' && Number.isFinite(renderedLufs)) {
    gain = 10 ** ((TARGET_LUFS - renderedLufs) / 20);
    const peak = yield* truePeakSteps(piano);
    const most = ceiling * 10 ** (MAX_LIMITING_DB / 20);
    if (peak * gain > most) gain = most / peak;
  }
  for (let from = 0; from < left.length; from += FRAMES_PER_STEP) {
    const to = Math.min(left.length, from + FRAMES_PER_STEP);
    for (let i = from; i < to; i += 1) {
      left[i] = (left[i] as number) * gain;
      right[i] = (right[i] as number) * gain;
    }
    yield;
  }
  if (clicks) yield* mixClicks(left, right, clicks, sampleRate);
  const limitedDb = yield* limitTruePeakSteps(piano, ceiling, sampleRate);
  return { renderedLufs, gainDb: 20 * Math.log10(gain), limitedDb };
}

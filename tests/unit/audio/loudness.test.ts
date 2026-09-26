import { describe, expect, it, vi } from 'vitest';
import { LIMITER_MAKEUP_DB, LIVE_OUTPUT_GAIN_DB } from '@/audio/gainStaging';
import {
  CEILING_DBTP,
  integratedLoudness,
  kWeighting,
  limitTruePeak,
  LIVE_MAKEUP_DB,
  masterExport,
  masterExportInSlices,
  MAX_LIMITING_DB,
  TARGET_LUFS,
  truePeak,
  type ClickTrack,
} from '@/audio/loudness';

const RATE = 48_000;

function dbfs(db: number): number {
  return 10 ** (db / 20);
}

/** A sine of `peakDb` for `seconds`, starting at `phase` radians. */
function sine(frequency: number, peakDb: number, seconds: number, phase = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const amplitude = dbfs(peakDb);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE + phase);
  }
  return out;
}

/** Faded in and out over 10 ms: a tone that starts at full level has a crest of its own. */
function faded(samples: Float32Array): Float32Array {
  const ramp = Math.round(0.01 * RATE);
  for (let i = 0; i < ramp; i += 1) {
    const gain = i / ramp;
    samples[i] = samples[i]! * gain;
    samples[samples.length - 1 - i] = samples[samples.length - 1 - i]! * gain;
  }
  return samples;
}

function joined(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function stereo(samples: Float32Array): Float32Array[] {
  return [samples, samples.slice()];
}

describe('K-weighting', () => {
  it('is the table BS.1770 gives at 48 kHz', () => {
    const [shelf, highPass] = kWeighting(48_000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 10);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 10);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 10);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 10);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 10);
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 10);
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 10);
  });
});

describe('integrated loudness', () => {
  // The EBU's own checks for a meter (Tech 3341): a stereo 1 kHz tone at
  // −23 dBFS reads −23 LUFS.
  it('reads a stereo tone at its level', () => {
    expect(integratedLoudness(stereo(sine(1000, -23, 20)), RATE)).toBeCloseTo(-23, 1);
    expect(integratedLoudness(stereo(sine(1000, -33, 20)), RATE)).toBeCloseTo(-33, 1);
  });

  it('leaves the quiet stretches out of the average', () => {
    // −36 dBFS either side of a minute at −23 is more than 10 LU down: gated.
    const quiet = sine(1000, -36, 10);
    const programme = joined(quiet, sine(1000, -23, 60), quiet);
    expect(integratedLoudness(stereo(programme), RATE)).toBeCloseTo(-23, 1);
  });

  it('weighs what a listener hears least, least', () => {
    // K-weighting's high-pass: 20 Hz at the same level reads far quieter.
    expect(integratedLoudness(stereo(sine(20, -23, 10)), RATE)).toBeLessThan(-35);
  });

  it('has nothing to say about silence or a sliver', () => {
    expect(integratedLoudness(stereo(new Float32Array(RATE * 5)), RATE)).toBe(-Infinity);
    expect(integratedLoudness(stereo(sine(1000, -80, 5)), RATE)).toBe(-Infinity);
    expect(integratedLoudness(stereo(sine(1000, -23, 0.3)), RATE)).toBe(-Infinity);
  });
});

describe('true peak', () => {
  it('finds a peak that falls between the samples', () => {
    // A quarter of the sample rate, 45° in: every sample lands 3 dB below the
    // crest, which a decoder reconstructs all the same.
    const between = faded(sine(RATE / 4, -1, 1, Math.PI / 4));
    let samplePeak = 0;
    for (const sample of between) samplePeak = Math.max(samplePeak, Math.abs(sample));
    expect(20 * Math.log10(samplePeak)).toBeCloseTo(-4, 1);
    expect(20 * Math.log10(truePeak([between]))).toBeCloseTo(-1, 1);
  });

  it('is the sample peak for anything low enough to have no hidden crest', () => {
    const tone = faded(sine(100, -6, 1, 0.3));
    expect(20 * Math.log10(truePeak(stereo(tone)))).toBeCloseTo(-6, 2);
  });
});

describe('the limiter', () => {
  const ceiling = dbfs(-1);

  /** Quiet tone with a loud burst in the middle, as a chord's attack would be. */
  function burst(): Float32Array {
    return joined(sine(440, -20, 1), sine(440, 3, 0.2), sine(440, -20, 1));
  }

  it('holds the loudest moment under the ceiling, between samples too', () => {
    const channels = stereo(burst());
    const deepest = limitTruePeak(channels, ceiling, RATE);
    expect(truePeak(channels)).toBeLessThanOrEqual(ceiling * 1.001);
    expect(deepest).toBeCloseTo(-4, 0);
  });

  it('leaves everything well away from a peak exactly as it was', () => {
    const original = burst();
    const channels = stereo(original);
    limitTruePeak(channels, ceiling, RATE);
    // Before the 5 ms look-ahead, and after the release has long settled.
    for (const i of [0, 1000, 40_000]) expect(channels[0]![i]).toBe(original[i]);
    const settled = Math.round(2.1 * RATE);
    expect(channels[0]![settled]).toBeCloseTo(original[settled]!, 4);
  });

  it('turns down without a click: the gain moves a little each sample', () => {
    const original = burst();
    const channels = stereo(original);
    limitTruePeak(channels, ceiling, RATE);
    // Gain read back where the tone is near its crest, sample by sample.
    let previous = 1;
    let steepest = 0;
    for (let i = 0; i < original.length; i += 1) {
      if (Math.abs(original[i]!) < 0.05) continue;
      const gain = channels[0]![i]! / original[i]!;
      steepest = Math.max(steepest, Math.abs(gain - previous));
      previous = gain;
    }
    expect(steepest).toBeLessThan(0.01);
  });

  it('turns both channels down together', () => {
    const left = burst();
    const right = sine(440, -20, left.length / RATE);
    const rightBefore = right.slice();
    limitTruePeak([left, right], ceiling, RATE);
    const middle = Math.round(1.1 * RATE);
    expect(right[middle]! / rightBefore[middle]!).toBeCloseTo(ceiling / dbfs(3), 1);
  });

  it('holds an attack in the take’s first milliseconds under the ceiling too', () => {
    // Loud from the very first sample: the look-ahead has no past to ramp in.
    const channels = stereo(sine(440, 3, 0.5));
    limitTruePeak(channels, ceiling, RATE);
    expect(truePeak(channels)).toBeLessThanOrEqual(ceiling * 1.001);
  });

  it('does nothing to a signal already under the ceiling', () => {
    const original = sine(440, -3, 1);
    const channels = stereo(original);
    expect(limitTruePeak(channels, ceiling, RATE)).toBe(0);
    expect(channels[0]).toEqual(original);
  });
});

describe('mastering an export', () => {
  const ceiling = dbfs(CEILING_DBTP);

  it('brings a quiet take up to the target, peaks and all under the ceiling', () => {
    const [left, right] = stereo(faded(sine(1000, -30, 10)));
    const result = masterExport(left!, right!, null, 'normalized', RATE);
    expect(result.renderedLufs).toBeCloseTo(-30, 0);
    expect(integratedLoudness([left!, right!], RATE)).toBeCloseTo(TARGET_LUFS, 1);
    expect(truePeak([left!, right!])).toBeLessThanOrEqual(ceiling * 1.001);
  });

  it('brings a loud take down to it as well', () => {
    const [left, right] = stereo(faded(sine(1000, -8, 10)));
    masterExport(left!, right!, null, 'normalized', RATE);
    expect(integratedLoudness([left!, right!], RATE)).toBeCloseTo(TARGET_LUFS, 1);
  });

  it('stops short of the target rather than flatten one crashing chord', () => {
    // Quiet throughout but for 20 ms 24 dB louder — too brief to move the
    // loudness, too tall to reach the target without far more limiting than a
    // piano's attack is allowed.
    const quiet = sine(1000, -30, 5);
    const [left, right] = stereo(faded(joined(quiet, sine(1000, -6, 0.02), quiet)));
    const result = masterExport(left!, right!, null, 'normalized', RATE);
    expect(result.gainDb).toBeLessThan(TARGET_LUFS - result.renderedLufs - 1);
    expect(result.limitedDb).toBeCloseTo(-MAX_LIMITING_DB, 1);
    expect(integratedLoudness([left!, right!], RATE)).toBeLessThan(TARGET_LUFS - 1);
    expect(truePeak([left!, right!])).toBeLessThanOrEqual(ceiling * 1.001);
  });

  it('keeps a take as played as loud as the app sounds live', () => {
    // All the live stage gives the piano under its limiter's threshold: its
    // output gain and the limiter's own makeup.
    expect(LIVE_MAKEUP_DB).toBe(LIVE_OUTPUT_GAIN_DB + LIMITER_MAKEUP_DB);
    const [left, right] = stereo(faded(sine(1000, -30, 10)));
    const result = masterExport(left!, right!, null, 'asPlayed', RATE);
    expect(result.gainDb).toBeCloseTo(LIVE_MAKEUP_DB, 5);
    expect(integratedLoudness([left!, right!], RATE)).toBeCloseTo(-30 + LIVE_MAKEUP_DB, 1);
  });

  it('mixes the metronome in without letting it count toward the level', () => {
    const piano = stereo(faded(sine(1000, -30, 10)));
    // A click every half second, the bar's first one accented.
    const clicks = {
      atS: Float64Array.from({ length: 20 }, (_, i) => i / 2),
      accent: Uint8Array.from({ length: 20 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
      accentSound: Float32Array.of(1, 0.5),
      beatSound: Float32Array.of(0.6, 0.3),
    };
    const without = masterExport(piano[0]!.slice(), piano[1]!.slice(), null, 'normalized', RATE);
    const [left, right] = piano;
    const withClicks = masterExport(left!, right!, clicks, 'normalized', RATE);
    expect(withClicks.gainDb).toBeCloseTo(without.gainDb, 5);
    // Each click joins at half its level, over the piano: an accent at 2 s,
    // a plain click at 2.5 s, both channels alike.
    expect(left![RATE * 2]).toBeCloseTo(0.5, 1);
    expect(right![RATE * 2 + 1]).toBeCloseTo(0.25, 1);
    expect(left![RATE * 2.5]).toBeCloseTo(0.3, 1);
  });

  it('leaves a take too quiet to measure at its played level', () => {
    const [left, right] = stereo(new Float32Array(RATE * 2));
    const result = masterExport(left!, right!, null, 'normalized', RATE);
    expect(result.renderedLufs).toBe(-Infinity);
    expect(result.gainDb).toBeCloseTo(LIVE_MAKEUP_DB, 5);
    expect(left!.every((sample) => sample === 0)).toBe(true);
  });
});

describe('mastering on the main thread', () => {
  /**
   * A quiet tone with a loud burst every five seconds, and a metronome over it,
   * so every pass has work to do: the level to set, peaks to find and limit,
   * and clicks to mix.
   */
  function longTake(seconds: number) {
    const parts: Float32Array[] = [];
    for (let at = 0; at < seconds; at += 5) parts.push(sine(440, -24, 4.8), sine(440, 0, 0.2));
    const [left, right] = stereo(faded(joined(...parts)));
    const beats = seconds * 2;
    const clicks: ClickTrack = {
      atS: Float64Array.from({ length: beats }, (_, i) => i / 2),
      accent: Uint8Array.from({ length: beats }, (_, i) => (i % 4 === 0 ? 1 : 0)),
      accentSound: sine(1000, -6, 0.065),
      beatSound: sine(800, -12, 0.065),
    };
    return { left: left!, right: right!, clicks };
  }

  /** Whether two buffers hold the very same bits, sample for sample. */
  function sameBits(a: Float32Array, b: Float32Array): boolean {
    const x = new Uint32Array(a.buffer, a.byteOffset, a.length);
    const y = new Uint32Array(b.buffer, b.byteOffset, b.length);
    return x.length === y.length && x.every((bits, i) => bits === y[i]);
  }

  it('masters in slices exactly as it does in one go', async () => {
    for (const mode of ['normalized', 'asPlayed'] as const) {
      const whole = longTake(20);
      const sliced = longTake(20);
      const expected = masterExport(whole.left, whole.right, whole.clicks, mode, RATE);
      // A turn after every step: as many slices as the work can be cut into.
      const pause = vi.fn(async () => undefined);
      const result = await masterExportInSlices(
        sliced.left,
        sliced.right,
        sliced.clicks,
        mode,
        RATE,
        { pause, sliceMs: 0 },
      );
      expect(pause.mock.calls.length).toBeGreaterThan(100);
      expect(result).toEqual(expected);
      expect(sameBits(sliced.left, whole.left)).toBe(true);
      expect(sameBits(sliced.right, whole.right)).toBe(true);
    }
  });

  it('gives the page a turn more than once while mastering a long take', async () => {
    // Two minutes: a dozen slices' work at the usual length, even on a fast machine.
    const { left, right, clicks } = longTake(120);
    const pause = vi.fn(async () => undefined);
    await masterExportInSlices(left, right, clicks, 'normalized', RATE, { pause });
    expect(pause.mock.calls.length).toBeGreaterThan(1);
  });

  it('stops when the export is cancelled, with the abort error, before it finishes', async () => {
    const { left, right, clicks } = longTake(20);
    const before = left.slice();
    const controller = new AbortController();
    const pause = vi.fn(async () => {
      if (pause.mock.calls.length === 3) controller.abort();
    });
    const error = await masterExportInSlices(left, right, clicks, 'normalized', RATE, {
      signal: controller.signal,
      pause,
      sliceMs: 0,
    }).catch((reason: unknown) => reason);
    // The signal's own reason, as `throwIfAborted` throws it in the encoder.
    expect(error).toBe(controller.signal.reason);
    expect(error).toMatchObject({ name: 'AbortError' });
    // Nothing more once it knew, and it was still measuring: not a sample
    // has been touched.
    expect(pause).toHaveBeenCalledTimes(3);
    expect(sameBits(left, before)).toBe(true);
  });
});

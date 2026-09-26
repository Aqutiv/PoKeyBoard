import { describe, expect, it } from 'vitest';
import { kWeighting } from '@/audio/loudness';
import { ATTACK_S, TONE_FILTER_Q_DB } from '@/audio/sampleVoice';
import {
  applyBiquad,
  biquadGainDb,
  centsBetween,
  filterLossDb,
  FUNDAMENTAL_GUARD,
  fundamentalHz,
  guardedCutoffHz,
  MAKEUP_POINTS,
  makeupAt,
  OPEN_CUTOFF_HZ,
  playedVoice,
  rampCutoffHz,
  rampPosition,
  searchCutoffHz,
  spectralCentroidHz,
  toneAt,
  webAudioLowpass,
  type ToneRamp,
} from '@/audio/toneCalibrationMath';

const RATE = 48_000;

/**
 * A sine `seconds` long, faded in over its first 20 ms: a tone that starts
 * dead on full level has a click at its start, which is brightness of its own.
 */
function sine(hz: number, amplitude = 0.5, seconds = 0.3): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const fade = 0.02 * RATE;
  for (let i = 0; i < samples.length; i += 1) {
    const rise = i < fade ? 0.5 - 0.5 * Math.cos((Math.PI * i) / fade) : 1;
    samples[i] = rise * amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
  return samples;
}

function mix(...signals: Float32Array[]): Float32Array {
  const out = new Float32Array(signals[0]!.length);
  for (const signal of signals) {
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] as number) + (signal[i] as number);
  }
  return out;
}

/** The mean square of a signal from `from` on: its steady level, past any start-up. */
function meanSquare(samples: ArrayLike<number>, from = 0): number {
  let sum = 0;
  for (let i = from; i < samples.length; i += 1) sum += (samples[i] as number) ** 2;
  return sum / (samples.length - from);
}

describe('the brightness measure', () => {
  it('reads a steady tone at its own frequency', () => {
    const tone = sine(1000);
    expect(spectralCentroidHz([tone, tone], RATE)).toBeCloseTo(1000, -1);
  });

  it('weighs each partial by its magnitude, not its power', () => {
    // One at 500 Hz, three times as strong at 2 kHz: magnitude-weighted,
    // (500 + 3 · 2000) / 4 = 1625 Hz; power-weighted it would be 1850.
    const tones = mix(sine(500, 0.2), sine(2000, 0.6));
    expect(spectralCentroidHz([tones, tones], RATE)).toBeGreaterThan(1600);
    expect(spectralCentroidHz([tones, tones], RATE)).toBeLessThan(1650);
  });

  it('hears 30 Hz to 10 kHz only, where hiss cannot lift it', () => {
    const tones = mix(sine(500, 0.3), sine(2000, 0.3));
    const plain = spectralCentroidHz([tones, tones], RATE);
    // Swelling and dying across the whole window, these stay within a few
    // hertz of their own frequencies, all outside the band.
    const swell = (samples: Float32Array) =>
      samples.map(
        (sample, i) => sample * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / samples.length)),
      );
    const outside = mix(tones, swell(sine(10, 0.6)), swell(sine(14_000, 0.6)));
    expect(spectralCentroidHz([outside, outside], RATE)).toBeCloseTo(plain, -1);
  });

  it('counts both channels', () => {
    expect(spectralCentroidHz([sine(500, 0.3), sine(2000, 0.3)], RATE)).toBeCloseTo(1250, -1);
  });
});

describe('the tone filter', () => {
  it('is Web Audio’s lowpass with its Q read as dB: 3.1 dB down at the cutoff, and no bump', () => {
    const filter = webAudioLowpass(1000, RATE);
    expect(biquadGainDb(filter, 1000, RATE)).toBeCloseTo(TONE_FILTER_Q_DB, 2);
    // Twelve dB an octave from there on.
    expect(biquadGainDb(filter, 2000, RATE)).toBeCloseTo(-12.4, 1);
    for (let hz = 10; hz < 1000; hz *= 1.1) {
      expect(biquadGainDb(filter, hz, RATE)).toBeLessThanOrEqual(0);
    }
  });

  it('passes everything at and above Nyquist, as Web Audio does', () => {
    const input = mix(sine(300), sine(9000));
    const passed = applyBiquad(input, webAudioLowpass(30_000, RATE));
    for (let i = 0; i < input.length; i += 97) expect(passed[i]).toBeCloseTo(input[i]!, 6);
  });

  it('runs from silence, as a voice’s filter does', () => {
    const out = applyBiquad(sine(2000, 1), webAudioLowpass(1000, RATE));
    expect(out[0]).toBe(0);
    // In steady state it passes the tone at its gain there.
    const gain = 10 ** (biquadGainDb(webAudioLowpass(1000, RATE), 2000, RATE) / 20);
    expect(Math.sqrt(2 * meanSquare(out, 4800))).toBeCloseTo(gain, 2);
  });
});

describe('a voice as the measure hears it', () => {
  it('rises from silence over the envelope’s attack, after its filter', () => {
    const steady = new Float32Array(RATE / 10).fill(0.5);
    const [played] = playedVoice([steady], RATE);
    const attack = Math.round(ATTACK_S * RATE);
    expect(played![0]).toBe(0);
    expect(played![attack / 2]).toBeCloseTo(0.25, 3);
    expect(played![attack + 10]).toBeCloseTo(0.5, 6);
    // Filtered first: a lowpass passes the steady level whole once settled.
    const [filtered] = playedVoice([steady], RATE, 1000);
    expect(filtered!.at(-1)).toBeCloseTo(0.5, 4);
  });
});

describe('the cutoff search', () => {
  it('finds where a measure rising with the cutoff meets its target', () => {
    const found = searchCutoffHz((hz) => Math.log(hz), Math.log(1234), 20, OPEN_CUTOFF_HZ);
    expect(Math.abs(centsBetween(found, 1234))).toBeLessThan(0.5);
  });

  it('stops at either end when the target lies past it', () => {
    expect(searchCutoffHz((hz) => hz, 50_000, 20, OPEN_CUTOFF_HZ)).toBe(OPEN_CUTOFF_HZ);
    expect(searchCutoffHz((hz) => hz, 5, 20, OPEN_CUTOFF_HZ)).toBe(20);
  });

  it('darkens a bright sound to a darker one’s brightness', () => {
    const bright = mix(sine(400, 0.3), sine(4000, 0.3));
    const dark = mix(sine(400, 0.3), sine(4000, 0.05));
    const target = spectralCentroidHz(playedVoice([dark], RATE), RATE);
    const cutoff = searchCutoffHz(
      (hz) => spectralCentroidHz(playedVoice([bright], RATE, hz), RATE),
      target,
      20,
      OPEN_CUTOFF_HZ,
    );
    const reached = spectralCentroidHz(playedVoice([bright], RATE, cutoff), RATE);
    expect(Math.abs(centsBetween(reached, target))).toBeLessThan(1);
    expect(cutoff).toBeGreaterThan(400);
    expect(cutoff).toBeLessThan(4000);
  });
});

describe('the make-up', () => {
  it('gives back what the filter takes from a tone', () => {
    // A tone at the cutoff loses the filter's gain there, and nothing else.
    const loss = filterLossDb([sine(1000), sine(1000)], RATE, 1000);
    expect(loss).toBeCloseTo(-TONE_FILTER_Q_DB, 1);
    expect(filterLossDb([sine(1000)], RATE, OPEN_CUTOFF_HZ)).toBeLessThan(0.01);
  });

  it('weighs what it takes as loudness is weighed, K-weighted', () => {
    // Equal tones at 200 Hz and 4 kHz, filtered at 1 kHz: the filter takes
    // most of the 4 kHz one, which counts for more than the 200 Hz one to the
    // ear (and to BS.1770's K-weighting), so the loss is well over the 3 dB an
    // unweighted meter would read.
    const tones = mix(sine(200, 0.3), sine(4000, 0.3));
    const weight = (hz: number) =>
      kWeighting(RATE).reduce((db, stage) => db + biquadGainDb(stage, hz, RATE), 0);
    const filter = webAudioLowpass(1000, RATE);
    const before = 10 ** (weight(200) / 10) + 10 ** (weight(4000) / 10);
    const after =
      10 ** ((weight(200) + biquadGainDb(filter, 200, RATE)) / 10) +
      10 ** ((weight(4000) + biquadGainDb(filter, 4000, RATE)) / 10);
    const expected = 10 * Math.log10(before / after);
    expect(expected).toBeGreaterThan(4);
    expect(filterLossDb([tones], RATE, 1000)).toBeCloseTo(expected, 1);
  });
});

describe('a ramp', () => {
  const ramp: ToneRamp = {
    matchedCutoffHz: 1000,
    cutoffHz: 1000,
    centroidHz: 500,
    makeupDb: [0.8, 0.4, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005],
  };

  it('holds one make-up for every eighth of the way up', () => {
    expect(MAKEUP_POINTS).toBe(8);
    expect(ramp.makeupDb).toHaveLength(MAKEUP_POINTS);
  });

  it('runs from its bottom cutoff up to open, evenly in log frequency', () => {
    expect(rampCutoffHz(1000, 0)).toBeCloseTo(1000, 6);
    expect(rampCutoffHz(1000, 0.5)).toBeCloseTo(Math.sqrt(1000 * OPEN_CUTOFF_HZ), 6);
    expect(rampCutoffHz(1000, 1)).toBeCloseTo(OPEN_CUTOFF_HZ, 6);
    expect(toneAt(ramp, 0)).toEqual({ cutoffHz: 1000, makeupDb: 0.8 });
    expect(toneAt(ramp, 0.25)!.cutoffHz).toBeCloseTo(1000 * 20 ** 0.25, 6);
  });

  it('gives back the make-up the table holds, and between its points geometrically', () => {
    expect(makeupAt(ramp.makeupDb, 0)).toBe(0.8);
    expect(makeupAt(ramp.makeupDb, 1 / 8)).toBeCloseTo(0.4, 12);
    expect(makeupAt(ramp.makeupDb, 1 / 16)).toBeCloseTo(Math.sqrt(0.8 * 0.4), 12);
    expect(makeupAt(ramp.makeupDb, 0.3)).toBeCloseTo(0.2 * 0.5 ** 0.4, 12);
    // From the last point it fades to nothing at the top.
    expect(makeupAt(ramp.makeupDb, 15 / 16)).toBeCloseTo(0.0025, 12);
    expect(makeupAt([0.3, 0, 0, 0, 0, 0, 0, 0], 1 / 16)).toBeCloseTo(0.15, 12);
  });

  it('is open at its top, with nothing to make up', () => {
    expect(toneAt(ramp, 1)).toBeUndefined();
    expect(makeupAt(ramp.makeupDb, 1)).toBe(0);
  });

  it('places a velocity along its layer, clamped to it', () => {
    expect(rampPosition(0.45, 0.45, 0.78)).toBe(0);
    expect(rampPosition(0.615, 0.45, 0.78)).toBeCloseTo(0.5, 12);
    expect(rampPosition(0.3, 0.45, 0.78)).toBe(0);
    expect(rampPosition(1.2, 0.78, 1)).toBe(1);
  });
});

describe('the top guard', () => {
  it('knows each key’s fundamental', () => {
    expect(fundamentalHz(69)).toBe(440);
    expect(fundamentalHz(60)).toBeCloseTo(261.63, 2);
    expect(fundamentalHz(108)).toBeCloseTo(4186.01, 2);
  });

  it('keeps a bottom cutoff at least FUNDAMENTAL_GUARD times its root’s fundamental', () => {
    expect(FUNDAMENTAL_GUARD).toBeGreaterThanOrEqual(2.5);
    expect(FUNDAMENTAL_GUARD).toBeLessThanOrEqual(4);
    // Middle C matched well above it keeps its match...
    expect(guardedCutoffHz(1638, 60)).toBe(1638);
    // ...but the top of the keyboard's match, near the fundamental itself, is lifted.
    expect(guardedCutoffHz(2189, 99)).toBeCloseTo(FUNDAMENTAL_GUARD * fundamentalHz(99), 9);
  });
});

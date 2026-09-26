import { describe, expect, it } from 'vitest';
import {
  earlyReflections,
  MAX_REVERB_IMPULSE_S,
  renderReverbImpulse,
  REVERB_ROOM_PRESETS,
  reverbImpulse,
  reverbImpulseLength,
  specNormalizationScale,
} from '@/audio/reverbImpulse';
import { REVERB_ROOMS, type ReverbRoom } from '@/domain/takeTypes';

const SAMPLE_RATES = [44_100, 48_000] as const;

/**
 * The Web Audio spec's own `calculateNormalizationScale`, transcribed as the
 * spec writes it: what a ConvolverNode does to its impulse when `normalize` is
 * left on. Kept apart from the module's copy so the two check each other.
 */
function specScale(channels: readonly Float32Array[], sampleRate: number): number {
  const GainCalibration = 0.00125;
  const GainCalibrationSampleRate = 44100;
  const MinPower = 0.000125;
  let power = 0;
  for (const data of channels) {
    let channelPower = 0;
    for (const sample of data) channelPower += sample * sample;
    power += channelPower;
  }
  power = Math.sqrt(power / (channels.length * (channels[0] as Float32Array).length));
  if (!isFinite(power) || isNaN(power) || power < MinPower) power = MinPower;
  let scale = 1 / power;
  scale *= GainCalibration;
  scale *= GainCalibrationSampleRate / sampleRate;
  return scale;
}

/**
 * The impulse every take was heard through before rooms: 2.2 s of seeded noise
 * under a power-law envelope, lightly smoothed, peak-scaled, and then
 * normalised by the browser. Room is calibrated against it, so that a take
 * keeps the amount of reverb it was made with.
 */
function legacyImpulse(sampleRate: number): Float32Array[] {
  const length = Math.floor(2.2 * sampleRate);
  let seed = (0x9e3779b9 ^ sampleRate ^ length) >>> 0;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (const data of channels) {
    let smoothed = 0;
    let peak = 0;
    for (let i = 0; i < length; i += 1) {
      const envelope = Math.pow(1 - i / length, 2.8);
      smoothed += 0.35 * ((random() * 2 - 1) * envelope - smoothed);
      data[i] = smoothed;
      peak = Math.max(peak, Math.abs(smoothed));
    }
    for (let i = 0; i < length; i += 1) data[i] = (data[i] as number) * (0.5 / peak);
  }
  const scale = specScale(channels, sampleRate);
  return channels.map((data) => data.map((sample) => sample * scale));
}

function energy(channels: readonly ArrayLike<number>[]): number {
  let total = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i += 1) total += (data[i] as number) ** 2;
  }
  return total;
}

const db = (ratio: number) => 10 * Math.log10(ratio);

/** A second-order Butterworth section (RBJ cookbook), run twice: 24 dB an octave. */
function band(
  data: Float32Array,
  type: 'lowpass' | 'highpass',
  hz: number,
  sampleRate: number,
): Float64Array {
  const w = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const [b0, b1, b2] =
    type === 'lowpass'
      ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
  let signal: ArrayLike<number> = data;
  for (let pass = 0; pass < 2; pass += 1) {
    const out = new Float64Array(data.length);
    let [x1, x2, y1, y2] = [0, 0, 0, 0];
    for (let i = 0; i < data.length; i += 1) {
      const x = signal[i] as number;
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      [x2, x1, y2, y1] = [x1, x, y1, y];
      out[i] = y;
    }
    signal = out;
  }
  return signal as Float64Array;
}

/**
 * Reverberation time by Schroeder's backward integration: the energy still to
 * come at each moment, in dB, fitted by least squares from −5 to −25 dB and
 * extrapolated to 60 dB (T20).
 */
function schroederRt60(data: ArrayLike<number>, sampleRate: number): number {
  const remaining = new Float64Array(data.length);
  let total = 0;
  for (let i = data.length - 1; i >= 0; i -= 1) {
    total += (data[i] as number) ** 2;
    remaining[i] = total;
  }
  let [n, sx, sy, sxx, sxy] = [0, 0, 0, 0, 0];
  for (let i = 0; i < data.length; i += 1) {
    const level = db((remaining[i] as number) / total);
    if (level > -5) continue;
    if (level < -25) break;
    const t = i / sampleRate;
    [n, sx, sy, sxx, sxy] = [n + 1, sx + t, sy + level, sxx + t * t, sxy + t * level];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return -60 / slope;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sameSamples(a: readonly Float32Array[], b: readonly Float32Array[]): boolean {
  return (
    a.length === b.length &&
    a.every((data, channel) => {
      const other = b[channel] as Float32Array;
      return data.length === other.length && data.every((sample, i) => sample === other[i]);
    })
  );
}

describe('room impulses', () => {
  it.each(REVERB_ROOMS)('%s is silent through its pre-delay, then sounds', (room) => {
    const { preDelayS } = REVERB_ROOM_PRESETS[room];
    expect(preDelayS).toBeGreaterThanOrEqual(0.01);
    expect(preDelayS).toBeLessThanOrEqual(0.025);
    for (const sampleRate of SAMPLE_RATES) {
      const channels = renderReverbImpulse(room, sampleRate);
      const start = Math.round(preDelayS * sampleRate);
      for (const data of channels) {
        expect(data.subarray(0, start).every((sample) => sample === 0)).toBe(true);
        const firstMs = data.subarray(start, start + Math.round(sampleRate / 1000));
        expect(firstMs.some((sample) => sample !== 0)).toBe(true);
      }
    }
  });

  it('waits longer before a bigger room answers', () => {
    const preDelays = REVERB_ROOMS.map((room) => REVERB_ROOM_PRESETS[room].preDelayS);
    expect(preDelays).toEqual([...preDelays].sort((a, b) => a - b));
    expect(new Set(preDelays).size).toBe(REVERB_ROOMS.length);
  });

  it.each(REVERB_ROOMS)('%s: early reflections between 5 and 80 ms, trading sides', (room) => {
    const reflections = earlyReflections(room);
    expect(reflections.length).toBeGreaterThanOrEqual(6);
    expect(reflections.length).toBeLessThanOrEqual(10);
    reflections.forEach((reflection, k) => {
      expect(reflection.timeS).toBeGreaterThanOrEqual(0.005);
      // The far side hears it a fraction of a millisecond later.
      expect(reflection.timeS + reflection.farDelayS).toBeLessThanOrEqual(0.08);
      expect(reflection.farDelayS).toBeGreaterThan(0);
      expect(reflection.farDelayS).toBeLessThan(0.001);
      expect(reflection.farGain).toBeLessThan(1);
      if (k > 0) {
        const previous = reflections[k - 1]!;
        expect(reflection.timeS).toBeGreaterThan(previous.timeS);
        expect(reflection.channel).not.toBe(previous.channel);
      }
    });
    // The first one ends the pre-delay.
    expect(reflections[0]!.timeS).toBe(REVERB_ROOM_PRESETS[room].preDelayS);

    // Each stands out of the tail around it, on its own side.
    for (const sampleRate of SAMPLE_RATES) {
      const channels = renderReverbImpulse(room, sampleRate);
      for (const reflection of reflections) {
        const data = channels[reflection.channel] as Float32Array;
        const at = Math.round(reflection.timeS * sampleRate);
        const around = data.subarray(
          at - Math.round(0.003 * sampleRate),
          at + Math.round(0.003 * sampleRate),
        );
        const rms = Math.sqrt(energy([around]) / around.length);
        expect(Math.abs(data[at] as number)).toBeGreaterThan(3 * rms);
      }
    }
  });

  it.each(REVERB_ROOMS)('%s: the lows decay at the room’s RT60, and the highs sooner', (room) => {
    const { rt60S, rt60HighS } = REVERB_ROOM_PRESETS[room];
    expect(rt60HighS).toBeLessThan(rt60S);
    for (const sampleRate of SAMPLE_RATES) {
      const channels = renderReverbImpulse(room, sampleRate);
      const low = mean(
        channels.map((data) => schroederRt60(band(data, 'lowpass', 500, sampleRate), sampleRate)),
      );
      const high = mean(
        channels.map((data) => schroederRt60(band(data, 'highpass', 8000, sampleRate), sampleRate)),
      );
      expect(Math.abs(low / rt60S - 1)).toBeLessThanOrEqual(0.1);
      // The one-pole crossover rolls off gently, so a little of the slow band
      // is still there up high and lengthens what is measured there — the
      // more, the further apart the two decays are.
      expect(high / rt60HighS).toBeGreaterThanOrEqual(0.9);
      expect(high / rt60HighS).toBeLessThanOrEqual(1.3);
      expect(high).toBeLessThan(0.75 * low);
    }
  });

  it('gives Room as much reverb as the impulse it replaces, at the same mix', () => {
    for (const sampleRate of SAMPLE_RATES) {
      const today = energy(legacyImpulse(sampleRate));
      const room = energy(reverbImpulse('room', sampleRate));
      expect(Math.abs(db(room / today))).toBeLessThanOrEqual(0.5);
    }
  });

  it('is normalised the way a ConvolverNode would, and then trimmed', () => {
    // After the spec's normalisation an impulse's RMS is fixed, so its energy
    // depends only on its length; the room's trim goes on top of that.
    for (const room of REVERB_ROOMS) {
      for (const sampleRate of SAMPLE_RATES) {
        const channels = reverbImpulse(room, sampleRate);
        const length = (channels[0] as Float32Array).length;
        const normalised = (0.00125 * (44100 / sampleRate)) ** 2 * channels.length * length;
        const trimmed = normalised * 10 ** (REVERB_ROOM_PRESETS[room].trimDb / 10);
        expect(db(energy(channels) / trimmed)).toBeCloseTo(0, 3);
      }
    }
  });

  it('computes the spec’s normalisation scale, floor included', () => {
    const steady = [new Float32Array(1000).fill(0.1), new Float32Array(1000).fill(-0.1)];
    const rms = Math.fround(0.1);
    expect(specNormalizationScale(steady, 44_100)).toBeCloseTo(0.00125 / rms, 10);
    expect(specNormalizationScale(steady, 48_000)).toBeCloseTo(
      (0.00125 / rms) * (44_100 / 48_000),
      10,
    );
    // Near silence is not scaled up without bound.
    const faint = [new Float32Array(1000).fill(1e-6), new Float32Array(1000)];
    expect(specNormalizationScale(faint, 44_100)).toBeCloseTo(0.00125 / 0.000125, 10);
    for (const sampleRate of SAMPLE_RATES) {
      const today = legacyImpulse(sampleRate);
      expect(specNormalizationScale(today, sampleRate)).toBeCloseTo(
        specScale(today, sampleRate),
        10,
      );
    }
  });

  it('makes the same impulse every time, seeded by room and sample rate', () => {
    for (const room of REVERB_ROOMS) {
      expect(
        sameSamples(renderReverbImpulse(room, 48_000), renderReverbImpulse(room, 48_000)),
      ).toBe(true);
    }
    const room = renderReverbImpulse('room', 48_000);
    expect(sameSamples(room, renderReverbImpulse('hall', 48_000))).toBe(false);
    // Another rate is another impulse, not this one resampled.
    const other = renderReverbImpulse('room', 44_100);
    expect(sameSamples(room, other)).toBe(false);
    expect(
      Math.abs((other[0] as Float32Array).length / 44_100 - room[0]!.length / 48_000),
    ).toBeLessThan(1 / 44_100);
  });

  it('decorrelates the two sides, so the room is as wide as the speakers', () => {
    for (const room of REVERB_ROOMS) {
      const [left, right] = renderReverbImpulse(room, 48_000) as [Float32Array, Float32Array];
      let [lr, ll, rr] = [0, 0, 0];
      for (let i = 0; i < left.length; i += 1) {
        lr += (left[i] as number) * (right[i] as number);
        ll += (left[i] as number) ** 2;
        rr += (right[i] as number) ** 2;
      }
      expect(Math.abs(lr / Math.sqrt(ll * rr))).toBeLessThan(0.2);
    }
  });

  it('keeps each impulse, per room and sample rate', () => {
    const first = reverbImpulse('cathedral', 48_000);
    expect(reverbImpulse('cathedral', 48_000)).toBe(first);
    expect(reverbImpulse('cathedral', 44_100)).not.toBe(first);
    expect(sameSamples(first, renderReverbImpulse('cathedral', 48_000))).toBe(true);
  });

  it('caps the longest room for a phone’s sake', () => {
    expect(MAX_REVERB_IMPULSE_S).toBe(4.5);
    expect(REVERB_ROOM_PRESETS.cathedral.rt60S).toBe(4.5);
    for (const sampleRate of SAMPLE_RATES) {
      for (const room of REVERB_ROOMS) {
        const length = reverbImpulseLength(room, sampleRate);
        expect(length).toBeLessThanOrEqual(MAX_REVERB_IMPULSE_S * sampleRate);
        expect(renderReverbImpulse(room, sampleRate)[0]!.length).toBe(length);
      }
      expect(reverbImpulseLength('cathedral', sampleRate)).toBe(MAX_REVERB_IMPULSE_S * sampleRate);
    }
  });

  it.each(REVERB_ROOMS)('%s lasts until its tail has all but died away', (room: ReverbRoom) => {
    const { preDelayS, rt60S } = REVERB_ROOM_PRESETS[room];
    const length = reverbImpulseLength(room, 48_000);
    expect(length / 48_000).toBeCloseTo(Math.min(MAX_REVERB_IMPULSE_S, preDelayS + rt60S), 3);
  });
});

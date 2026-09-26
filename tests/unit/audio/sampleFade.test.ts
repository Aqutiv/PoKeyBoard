import { describe, expect, it } from 'vitest';
import { DITHER_FLOOR, endsFaded, FADE_S, fadeOut } from '../../../scripts/lib/sampleFade.mjs';

describe('the fade-out a converted piano sample ends with', () => {
  it('runs over the last 1.5 s of the trim when the source is longer', () => {
    expect(fadeOut(7, 40.196)).toEqual({ startS: 5.5, lengthS: FADE_S });
    expect(fadeOut(9, 9)).toEqual({ startS: 7.5, lengthS: FADE_S });
    // A range-fetched source holds its trim and a second more.
    expect(fadeOut(12, 13)).toEqual({ startS: 10.5, lengthS: FADE_S });
  });

  it('runs over the last 1.5 s of a source that ends before the trim', () => {
    // The bitKlavier A7 v10 recording lasts 3.492 s, against the top
    // register's 7 s trim: from the trim, its fade would start 2 s after it
    // had ended, and the file would stop with no fade of its own.
    const { startS, lengthS } = fadeOut(7, 3.492);
    expect(lengthS).toBe(FADE_S);
    expect(startS).toBeCloseTo(1.992, 9);
    expect(startS + lengthS).toBeCloseTo(3.492, 9);
    // One that ends partway into where the old fade would have run.
    expect(fadeOut(7, 6.542).startS).toBeCloseTo(5.042, 9);
  });

  it('fades a very short source over its second half, leaving the attack alone', () => {
    expect(fadeOut(7, 2)).toEqual({ startS: 1, lengthS: 1 });
    expect(fadeOut(7, 0)).toEqual({ startS: 0, lengthS: 0 });
  });
});

describe('the check that a written sample ends faded', () => {
  const RATE = 48_000;

  /**
   * Four seconds of a decaying 440 Hz tone, stereo, faded out over its last
   * `fadeS` from full gain to none where the fade would end at `fadeEndS`.
   */
  function tone({
    fadeS,
    fadeEndS = 4,
    level = 0.5,
  }: {
    fadeS: number;
    fadeEndS?: number;
    level?: number;
  }): Float32Array[] {
    const frames = 4 * RATE;
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      const t = i / RATE;
      const fade = fadeS > 0 ? Math.min(1, Math.max(0, (fadeEndS - t) / fadeS)) : 1;
      samples[i] = level * Math.exp(-t / 2) * Math.sin(2 * Math.PI * 440 * t) * fade;
    }
    return [samples, samples.slice()];
  }

  it('passes a sample faded over its last 1.5 s', () => {
    expect(endsFaded(tone({ fadeS: FADE_S }), RATE, FADE_S).faded).toBe(true);
  });

  it('fails one that stops with no fade, or partway through one', () => {
    expect(endsFaded(tone({ fadeS: 0 }), RATE, FADE_S).faded).toBe(false);
    // Scheduled from a 7 s trim over a recording 4.5 s long: a third to go.
    expect(endsFaded(tone({ fadeS: FADE_S, fadeEndS: 4.5 }), RATE, FADE_S).faded).toBe(false);
  });

  it('fails one that ends on only a short fade of its own', () => {
    // The bitKlavier sources end on a 100 ms fade: well under the file's own
    // peak by their last 10 ms, but nothing like the fade the build applies.
    const own = tone({ fadeS: 0.1 });
    const { faded, last } = endsFaded(own, RATE, FADE_S);
    expect(faded).toBe(false);
    expect(20 * Math.log10(last / 0.5)).toBeLessThan(-30);
  });

  it('passes one that has already decayed into the dither', () => {
    const quiet = tone({ fadeS: 0, level: 2 * DITHER_FLOOR });
    expect(endsFaded(quiet, RATE, FADE_S).faded).toBe(true);
  });
});

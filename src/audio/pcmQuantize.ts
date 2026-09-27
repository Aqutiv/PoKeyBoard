import { xorshift32 } from '@/utils/random';

/**
 * Where every export's dither starts, so the same mastered render always
 * comes out as the same file — from the worker, or from the main thread
 * starting over where the worker died.
 */
const DITHER_SEED = 0x5eed_f1ac;

/**
 * Write `count` samples of `source` from `start` into `target` from 0, as
 * integers; see `createQuantizer`.
 */
export type Quantize = (
  source: Float32Array,
  start: number,
  count: number,
  target: Int32Array,
) => void;

/**
 * Float samples in [−1, 1) as `bits`-bit integers, for a lossless file.
 *
 * Rounding alone would leave the error following the music: at 16 bits a
 * fading reverb tail would break into a gritty buzz in its last few steps.
 * Adding triangular (TPDF) dither of ±1 step first — the difference of two
 * uniform draws — turns that error into a steady hiss about 93 dB under full
 * scale, unrelated to the music and far under the recordings' own noise. At
 * 24 bits it costs nothing either way, and one rule is simpler than two. Full
 * scale is 2^(bits − 1), and the true-peak limiter keeps every sample far
 * enough inside it that the dither never clips; the clamp is only a guard.
 *
 * Each quantizer draws from a generator of its own, so it must be made once
 * per export, and fed that export's blocks in order.
 */
export function createQuantizer(bits: number): Quantize {
  const scale = 2 ** (bits - 1);
  const max = scale - 1;
  const min = -scale;
  const random = xorshift32(DITHER_SEED);
  return (source, start, count, target) => {
    for (let i = 0; i < count; i += 1) {
      const value = Math.round((source[start + i] as number) * scale + random() - random());
      target[i] = value > max ? max : value < min ? min : value;
    }
  };
}

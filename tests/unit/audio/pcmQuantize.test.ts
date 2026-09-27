// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createQuantizer } from '@/audio/pcmQuantize';

function quantize(source: Float32Array, bits: number): Int32Array {
  const out = new Int32Array(source.length);
  createQuantizer(bits)(source, 0, source.length, out);
  return out;
}

describe('quantizing for a lossless file', () => {
  it('draws the same dither for every export of the same render', () => {
    const source = Float32Array.from({ length: 10_000 }, (_, i) => 0.3 * Math.sin(i / 9));
    expect(quantize(source, 16)).toEqual(quantize(source, 16));

    // Fed in blocks, one quantizer carries its dither on from block to block.
    const quantizer = createQuantizer(16);
    const blocks = new Int32Array(source.length);
    const block = new Int32Array(4096);
    for (let from = 0; from < source.length; from += 4096) {
      const count = Math.min(4096, source.length - from);
      quantizer(source, from, count, block);
      blocks.set(block.subarray(0, count), from);
    }
    expect(blocks).toEqual(quantize(source, 16));
  });

  it('turns rounding into a quarter of a step squared of noise, centred on the signal', () => {
    const length = 200_000;
    const source = Float32Array.from({ length }, (_, i) => 0.25 * Math.sin(i / 13.7));
    for (const bits of [16, 24]) {
      const scale = 2 ** (bits - 1);
      const out = quantize(source, bits);
      let sum = 0;
      let squares = 0;
      let worst = 0;
      for (let i = 0; i < length; i += 1) {
        const error = out[i]! - source[i]! * scale;
        sum += error;
        squares += error * error;
        worst = Math.max(worst, Math.abs(error));
      }
      // Triangular dither (variance 1/6) plus rounding what it leaves (1/12).
      expect(Math.abs(sum / length)).toBeLessThan(0.01);
      expect(squares / length).toBeGreaterThan(0.24);
      expect(squares / length).toBeLessThan(0.26);
      expect(worst).toBeLessThanOrEqual(1.5);
    }
  });

  it('leaves silence within a step of zero, and clamps at full scale', () => {
    const silence = quantize(new Float32Array(1000), 16);
    expect(silence.every((sample) => Math.abs(sample) <= 1)).toBe(true);
    expect(silence.some((sample) => sample !== 0)).toBe(true);

    const extremes = Float32Array.from([1, -1, 0.99999, -0.99999, 1.5, -1.5]);
    const out = quantize(extremes, 16);
    for (const sample of out) {
      expect(sample).toBeGreaterThanOrEqual(-32_768);
      expect(sample).toBeLessThanOrEqual(32_767);
    }
    expect(out[0]).toBe(32_767);
    expect(out[4]).toBe(32_767);
    expect(out[5]).toBe(-32_768);
    expect(quantize(Float32Array.of(1, -1), 24)).toEqual(Int32Array.of(8_388_607, -8_388_608));
  });
});

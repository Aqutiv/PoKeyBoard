import { describe, expect, it } from 'vitest';
import { velocityGain, velocityToLayer, VELOCITY_LAYER_THRESHOLDS } from '@/audio/SampleBank';

describe('velocityToLayer', () => {
  it('maps velocity bands to the three layers', () => {
    expect(velocityToLayer(0)).toBe(0);
    expect(velocityToLayer(VELOCITY_LAYER_THRESHOLDS[0] - 0.01)).toBe(0);
    expect(velocityToLayer(VELOCITY_LAYER_THRESHOLDS[0])).toBe(1);
    expect(velocityToLayer(VELOCITY_LAYER_THRESHOLDS[1] - 0.01)).toBe(1);
    expect(velocityToLayer(VELOCITY_LAYER_THRESHOLDS[1])).toBe(2);
    expect(velocityToLayer(1)).toBe(2);
  });
});

describe('velocityGain', () => {
  it('is monotonically non-decreasing within a layer', () => {
    for (let layer = 0; layer < 3; layer += 1) {
      let previous = 0;
      for (let v = 0.05; v <= 1; v += 0.05) {
        const gain = velocityGain(v, layer);
        expect(gain).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = gain;
      }
    }
  });

  it('stays within the safety clamp', () => {
    for (let layer = 0; layer < 3; layer += 1) {
      for (const v of [0, 0.001, 0.3, 0.6, 0.9, 1]) {
        const gain = velocityGain(v, layer);
        expect(gain).toBeGreaterThanOrEqual(0.25);
        expect(gain).toBeLessThanOrEqual(1.7);
      }
    }
  });

  it('does not jump wildly across layer boundaries', () => {
    for (const boundary of VELOCITY_LAYER_THRESHOLDS) {
      const below = velocityGain(boundary - 0.001, velocityToLayer(boundary - 0.001));
      const above = velocityGain(boundary + 0.001, velocityToLayer(boundary + 0.001));
      // The samples themselves get louder across the boundary; the applied
      // gain must not amplify that step by more than ~2x in either direction.
      expect(above / below).toBeGreaterThan(0.5);
      expect(above / below).toBeLessThan(2);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  layerLabels,
  layerSearchOrder,
  mediumLayer,
  velocityGain,
  velocityThresholds,
  velocityToLayer,
  type LayerLabel,
} from '@/audio/velocityLayers';

const layers = (...labels: string[]) => labels.map((label, index) => ({ index, label }));
const THREE: LayerLabel[] = ['soft', 'medium', 'loud'];
const FOUR: LayerLabel[] = ['pianissimo', 'soft', 'medium', 'loud'];

describe('a grand’s velocity layers', () => {
  it('reads each layer’s label, softest first', () => {
    expect(layerLabels(layers('soft', 'medium', 'loud'))).toEqual(THREE);
    expect(layerLabels(layers('pianissimo', 'soft', 'medium', 'loud'))).toEqual(FOUR);
    // Whatever order the manifest lists them in, by index.
    expect(
      layerLabels([
        { index: 2, label: 'loud' },
        { index: 0, label: 'soft' },
        { index: 1, label: 'medium' },
      ]),
    ).toEqual(THREE);
  });

  it('refuses a pack it would play on the wrong velocities', () => {
    expect(() => layerLabels(layers('soft', 'fortissimo'))).toThrow(/Unknown velocity layer/);
    expect(() => layerLabels(layers('medium', 'soft'))).toThrow(/softest to loudest/);
    expect(() => layerLabels(layers('soft', 'soft', 'medium'))).toThrow(/softest to loudest/);
    expect(() => layerLabels(layers('soft', 'loud'))).toThrow(/medium velocity layer/);
    expect(() =>
      layerLabels([
        { index: 0, label: 'soft' },
        { index: 2, label: 'medium' },
      ]),
    ).toThrow(/without gaps/);
  });

  it('takes a pack of soft, medium and loud over where it always has, and a pianissimo layer under 0.30', () => {
    expect(velocityThresholds(THREE)).toEqual([0.45, 0.78]);
    expect(velocityThresholds(FOUR)).toEqual([0.3, 0.45, 0.78]);
  });

  it('maps velocity bands to the layers', () => {
    const three = velocityThresholds(THREE);
    expect([0, 0.44, 0.45, 0.77, 0.78, 1].map((v) => velocityToLayer(v, three))).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
    const four = velocityThresholds(FOUR);
    expect([0, 0.29, 0.3, 0.44, 0.45, 0.78, 1].map((v) => velocityToLayer(v, four))).toEqual([
      0, 0, 1, 1, 2, 3, 3,
    ]);
    // One layer plays everything.
    expect(velocityToLayer(0.9, [])).toBe(0);
  });

  it('looks for a stand-in nearest first, the softer of two as near — as three layers always did', () => {
    expect(layerSearchOrder(0, 3)).toEqual([0, 1, 2]);
    expect(layerSearchOrder(1, 3)).toEqual([1, 0, 2]);
    expect(layerSearchOrder(2, 3)).toEqual([2, 1, 0]);
    expect(layerSearchOrder(0, 4)).toEqual([0, 1, 2, 3]);
    expect(layerSearchOrder(2, 4)).toEqual([2, 1, 3, 0]);
    expect(layerSearchOrder(3, 4)).toEqual([3, 2, 1, 0]);
  });

  it('finds the medium layer wherever it is numbered', () => {
    expect(mediumLayer(THREE)).toBe(1);
    expect(mediumLayer(FOUR)).toBe(2);
  });
});

// The gain of a pack with no velocity calibration. The grands have one, and
// velocityCalibration.test.ts holds them to meeting themselves at every layer
// boundary; these are the looser promises of the fallback.
describe('velocityGain, for a pack with no calibration', () => {
  it('is monotonically non-decreasing within a layer', () => {
    for (const label of FOUR) {
      let previous = 0;
      for (let v = 0.05; v <= 1; v += 0.05) {
        const gain = velocityGain(v, label);
        expect(gain).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = gain;
      }
    }
  });

  it('stays within the safety clamp', () => {
    for (const label of FOUR) {
      for (const v of [0, 0.001, 0.3, 0.6, 0.9, 1]) {
        const gain = velocityGain(v, label);
        expect(gain).toBeGreaterThanOrEqual(0.25);
        expect(gain).toBeLessThanOrEqual(1.7);
      }
    }
  });

  it('does not jump wildly across the boundaries of soft, medium and loud', () => {
    for (const boundary of velocityThresholds(THREE)) {
      const labelAt = (v: number) => THREE[velocityToLayer(v, velocityThresholds(THREE))]!;
      const below = velocityGain(boundary - 0.001, labelAt(boundary - 0.001));
      const above = velocityGain(boundary + 0.001, labelAt(boundary + 0.001));
      // The samples themselves get louder across the boundary; the applied
      // gain must not amplify that step by more than ~2x in either direction.
      // Only a bound: one trim per layer cannot match recordings that differ
      // note by note, which is what the calibration is for.
      expect(above / below).toBeGreaterThan(0.5);
      expect(above / below).toBeLessThan(2);
    }
  });
});

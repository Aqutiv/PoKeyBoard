import { describe, expect, it } from 'vitest';
import {
  calibratedGain,
  calibrateLayers,
  calibrationCovers,
  clampResidualDb,
  evaluateFit,
  fitQuadratic,
  heldBackDb,
  loudestVoicePeak,
  MAX_RESIDUAL_DB,
  nearestRoot,
  octavesFromMiddleC,
  powerMeanDb,
  registerTiltDb,
  solveReferenceDb,
  targetDb,
  type Quadratic,
  type VelocityCalibration,
} from '@/audio/velocityCalibrationMath';
import { curveDb } from '@/audio/velocityCurve';

/** Roots every minor third across the keyboard, as the grand packs are recorded. */
const ROOTS = Array.from({ length: 30 }, (_, index) => 21 + index * 3);

describe('fitQuadratic', () => {
  it('recovers a quadratic exactly from points on it', () => {
    const truth: Quadratic = [-20, 1.5, -0.8];
    const points = ROOTS.map((midi) => {
      const x = octavesFromMiddleC(midi);
      return [x, truth[0] + truth[1] * x + truth[2] * x * x] as const;
    });
    const fit = fitQuadratic(points);
    for (let i = 0; i < 3; i += 1) expect(fit[i]).toBeCloseTo(truth[i] as number, 9);
  });

  it('leaves residuals with no constant, linear or quadratic part: least squares', () => {
    // A deterministic scatter around a curve.
    const points = ROOTS.map((midi, index) => {
      const x = octavesFromMiddleC(midi);
      return [x, -24 + 2 * x - 0.5 * x * x + Math.sin(index * 2.3) * 1.7] as const;
    });
    const fit = fitQuadratic(points);
    let sum = 0;
    let sumX = 0;
    let sumX2 = 0;
    for (const [x, y] of points) {
      const residual = y - (fit[0] + fit[1] * x + fit[2] * x * x);
      sum += residual;
      sumX += residual * x;
      sumX2 += residual * x * x;
    }
    expect(sum).toBeCloseTo(0, 9);
    expect(sumX).toBeCloseTo(0, 9);
    expect(sumX2).toBeCloseTo(0, 9);
  });

  it('refuses fewer than three distinct pitches', () => {
    expect(() => fitQuadratic([[0, 1]])).toThrow();
    expect(() =>
      fitQuadratic([
        [0, 1],
        [0, 2],
        [1, 3],
      ]),
    ).toThrow();
  });
});

describe('evaluateFit', () => {
  it('reads the fit in octaves from middle C: level there, slope, bow', () => {
    const fit: Quadratic = [-20, 2, -1];
    expect(evaluateFit(fit, 60)).toBe(-20);
    expect(evaluateFit(fit, 72)).toBe(-19);
    expect(evaluateFit(fit, 48)).toBe(-23);
  });
});

/** The limit, so the cases below read as how far past it they are. */
const LIMIT = MAX_RESIDUAL_DB;

describe('the residual clamp', () => {
  it('passes a residual inside ±7 dB and holds one outside it at the limit', () => {
    expect(MAX_RESIDUAL_DB).toBe(7);
    expect(clampResidualDb(6.9)).toBe(6.9);
    expect(clampResidualDb(-2)).toBe(-2);
    expect(clampResidualDb(7.5)).toBe(7);
    expect(clampResidualDb(-9)).toBe(-7);
  });

  it('holds a root back by nothing while all its recordings are within the limit', () => {
    // Headroom's F♯6, 6.2–6.9 dB hot on every layer, is corrected in full.
    expect(heldBackDb([6.2, 6.9, 6.6])).toBe(0);
    expect(heldBackDb([1, -2, LIMIT])).toBe(0);
  });

  it('otherwise by the least shared shift that brings every recording within it', () => {
    // Hot on every layer; and off on one layer alone.
    expect(heldBackDb([LIMIT + 2.2, LIMIT + 2.9, LIMIT + 2.6])).toBeCloseTo(2.9, 12);
    expect(heldBackDb([-LIMIT - 2.2, -1.3, 1])).toBeCloseTo(-2.2, 12);
  });

  it('gives up on a shared shift when the recordings lie more than twice the limit apart', () => {
    expect(heldBackDb([-LIMIT - 1, LIMIT + 0.5])).toBeUndefined();
  });
});

/** Three layers 6 dB apart, gently scattered, with the recordings `offsets` moves. */
function measuredPack(offsets: (layer: number, midi: number) => number) {
  return [0, 1, 2].flatMap((layer) =>
    ROOTS.map((midi) => {
      const x = octavesFromMiddleC(midi);
      const level = -30 + 6 * layer + x - 0.4 * x * x + Math.cos(midi + layer) * 0.8;
      return { layer, midi, levelDb: level + offsets(layer, midi), peakDb: level + 14 };
    }),
  );
}

describe('calibrateLayers', () => {
  it('fits every layer and keeps every root, low to high', () => {
    const layers = calibrateLayers(measuredPack(() => 0));
    expect(layers).toHaveLength(3);
    for (const [index, layer] of layers.entries()) {
      expect(layer.roots.map((root) => root.midi)).toEqual(ROOTS);
      expect(layer.fit[0]).toBeCloseTo(-30 + 6 * index, 0);
      expect(layer.rmsResidualDb).toBeGreaterThan(0);
      expect(layer.rmsResidualDb).toBeLessThan(1);
    }
  });

  it('takes a root as measured while every layer of it is within the limit of its fit', () => {
    for (const layer of calibrateLayers(measuredPack(() => 0))) {
      for (const root of layer.roots) expect(root.correctedDb).toBe(root.measuredDb);
    }
  });

  it('carries every recording’s peak through', () => {
    const measured = measuredPack(() => 0);
    for (const [index, layer] of calibrateLayers(measured).entries()) {
      for (const root of layer.roots) {
        const recording = measured.find(
          (entry) => entry.layer === index && entry.midi === root.midi,
        );
        expect(root.peakDb).toBe(recording?.peakDb);
      }
    }
  });

  it('holds a stray root back on all its layers at once, never past the limit', () => {
    // One root recorded 5 dB past the limit throughout, one whose soft layer
    // alone is 4 dB past it the other way.
    const layers = calibrateLayers(
      measuredPack((layer, midi) =>
        midi === 72 ? LIMIT + 5 : midi === 87 && layer === 0 ? -LIMIT - 4 : 0,
      ),
    );
    for (const midi of ROOTS) {
      const roots = layers.map((layer) => layer.roots.find((root) => root.midi === midi)!);
      const shifts = roots.map((root) => root.measuredDb - root.correctedDb);
      for (const [index, root] of roots.entries()) {
        const fitted = evaluateFit(layers[index]!.fit, midi);
        expect(Math.abs(root.correctedDb - fitted)).toBeLessThanOrEqual(MAX_RESIDUAL_DB + 1e-9);
        // One shift for the whole root, so its layers still meet at one level.
        expect(shifts[index]).toBeCloseTo(shifts[0]!, 9);
      }
      if (midi === 72) expect(shifts[0]).toBeGreaterThan(3);
      else if (midi === 87) expect(shifts[0]).toBeLessThan(-1.5);
      else expect(shifts[0]).toBe(0);
    }
  });

  it('clamps each recording on its own when no shared shift can hold them all', () => {
    const layers = calibrateLayers(
      measuredPack((layer, midi) => (midi === 72 ? [-LIMIT - 2, 0, LIMIT + 2][layer]! : 0)),
    );
    for (const layer of layers) {
      const root = layer.roots.find((entry) => entry.midi === 72)!;
      const fitted = evaluateFit(layer.fit, 72);
      expect(root.correctedDb).toBeCloseTo(fitted + clampResidualDb(root.measuredDb - fitted), 9);
    }
  });
});

describe('powerMeanDb', () => {
  it('averages power, not decibels', () => {
    expect(powerMeanDb([-20, -20, -20])).toBeCloseTo(-20, 12);
    expect(powerMeanDb([0, -10])).toBeCloseTo(10 * Math.log10(1.1 / 2), 12);
  });
});

describe('solveReferenceDb', () => {
  it('finds the reference that brings the anchor keys to their old average level', () => {
    const today = [-20, -22.5, -18, -19.25];
    const relative = [1.5, -1, 0.25, 3];
    const reference = solveReferenceDb(today, relative);
    const anchored = relative.map((level) => reference + level);
    expect(powerMeanDb(anchored)).toBeCloseTo(powerMeanDb(today), 12);
  });

  it('insists on one relative level per key', () => {
    expect(() => solveReferenceDb([-20, -21], [0])).toThrow();
  });
});

describe('nearestRoot', () => {
  it('picks the closest root, and the lower of two equally close ones', () => {
    expect(nearestRoot([21, 24, 27], 22)).toBe(21);
    expect(nearestRoot([21, 24, 27], 23)).toBe(24);
    expect(nearestRoot([20, 24], 22)).toBe(20);
    expect(nearestRoot([], 60)).toBeUndefined();
  });
});

/**
 * A small calibration: flat soft and loud layers, and a tilted medium one.
 * Every recording peaks at −40 dBFS but those `peaks` names, by layer and root.
 */
function sampleCalibration(peaks: Record<string, number> = {}): VelocityCalibration {
  const layer = (index: number, fit: Quadratic, hot = 0) => ({
    fit,
    rmsResidualDb: 0,
    roots: [48, 60, 72].map((midi) => {
      const level = evaluateFit(fit, midi) + (midi === 72 ? hot : 0);
      return {
        midi,
        measuredDb: level,
        correctedDb: level,
        peakDb: peaks[`${index}:${midi}`] ?? -40,
      };
    }),
  });
  return {
    referenceDb: -18,
    layers: [layer(0, [-30, 0, 0]), layer(1, [-24, 1.5, -0.5]), layer(2, [-16, 0, 0], 2)],
  };
}

describe('the calibrated voice gain', () => {
  it('tilts the target like the medium layer, zero at middle C', () => {
    const calibration = sampleCalibration();
    expect(registerTiltDb(calibration, 60)).toBe(0);
    expect(registerTiltDb(calibration, 72)).toBeCloseTo(1, 12);
    expect(registerTiltDb(calibration, 48)).toBeCloseTo(-2, 12);
  });

  it('aims every note at the reference, plus the curve, plus the tilt', () => {
    const calibration = sampleCalibration();
    expect(targetDb(calibration, 0.75, 60)).toBeCloseTo(-18, 12);
    expect(targetDb(calibration, 0.3, 72)).toBeCloseTo(-18 + curveDb(0.3) + 1, 12);
  });

  it('takes whichever recording stands in to the same level', () => {
    const calibration = sampleCalibration();
    // Played from its own root on every layer, a note lands on one level.
    for (const velocity of [0.2, 0.6, 0.95]) {
      const levels = [0, 1, 2].map((layer) => {
        const recording = calibration.layers[layer]!.roots.find((root) => root.midi === 72)!;
        const gain = calibratedGain(calibration, velocity, 72, layer, 72);
        return recording.measuredDb + 20 * Math.log10(gain as number);
      });
      for (const level of levels) {
        expect(level).toBeCloseTo(targetDb(calibration, velocity, 72), 9);
      }
    }
  });

  it('knows nothing of a recording the table does not hold', () => {
    const calibration = sampleCalibration();
    expect(calibratedGain(calibration, 0.5, 60, 3, 60)).toBeUndefined();
    expect(calibratedGain(calibration, 0.5, 63, 1, 63)).toBeUndefined();
  });

  it('finds the loudest peak a voice reaches: a recording’s peak times its gain', () => {
    const calibration = sampleCalibration({ '2:60': -3 });
    // On its own key only, the hot recording is the loudest.
    expect(loudestVoicePeak(calibration, 1, 0)).toBeCloseTo(
      calibratedGain(calibration, 1, 60, 2, 60)! * 10 ** (-3 / 20),
      12,
    );
    // A softer velocity plays every voice quieter.
    expect(loudestVoicePeak(calibration, 0.5, 0)).toBeLessThan(loudestVoicePeak(calibration, 1, 0));
  });

  it('counts the keys a recording can stand in for, where the tilt can raise its gain', () => {
    const calibration = sampleCalibration({ '2:60': -3 });
    // The medium layer's tilt rises from middle C to F♯5 (78), so the same
    // recording pitched up to A4, nine semitones, plays hotter than on C4.
    const standIns = Array.from({ length: 19 }, (_, index) => 51 + index);
    const expected = Math.max(
      ...standIns.map((midi) => calibratedGain(calibration, 1, midi, 2, 60)! * 10 ** (-3 / 20)),
    );
    expect(loudestVoicePeak(calibration, 1, 9)).toBeCloseTo(expected, 12);
    expect(expected).toBeGreaterThan(loudestVoicePeak(calibration, 1, 0));
  });

  it('keeps to the keys the pack was recorded across', () => {
    // The top root, 72, could reach up to 81, where the tilt is higher still,
    // but no key above the highest recording is on the keyboard.
    const calibration = sampleCalibration({ '2:72': -3 });
    expect(loudestVoicePeak(calibration, 1, 9)).toBeCloseTo(
      calibratedGain(calibration, 1, 72, 2, 72)! * 10 ** (-3 / 20),
      12,
    );
  });

  it('covers a manifest only when it holds every one of its files', () => {
    const calibration = sampleCalibration();
    expect(
      calibrationCovers(calibration, [
        { layer: 0, midi: 48 },
        { layer: 2, midi: 72 },
      ]),
    ).toBe(true);
    expect(
      calibrationCovers(calibration, [
        { layer: 0, midi: 48 },
        { layer: 1, midi: 63 },
      ]),
    ).toBe(false);
  });
});

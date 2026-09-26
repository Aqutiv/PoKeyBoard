import { curveDb } from './velocityCurve';

/**
 * The arithmetic of the velocity calibration, pure so the generator
 * (tests/tools/generateVelocityCalibration.ts), the sample bank and the tests
 * all share it.
 *
 * A grand pack is three recordings of every third key — soft, medium and loud
 * — each made at whatever level that note and that session happened to give.
 * The generator measures every one (velocityCalibration.ts holds the result),
 * and a voice's gain is then simply the distance from its recording's level to
 * where the note should sound:
 *
 *   target(v, key) = reference + curveDb(v) + tilt(key)
 *   gain           = target − the recording's level
 *
 * The tilt is the medium layer's own balance from bass to treble, so a pack
 * keeps the voice it was recorded with while every recording in it, on every
 * layer, lands on one level for one velocity. Which layer sounds then changes
 * the timbre and never the loudness.
 *
 * A recording's level is taken as measured, as long as it lies within 7 dB of
 * the fit through its layer. Real roots stray that far — the Headroom piano's
 * F♯6 and C7 were recorded 6–7 dB hot, alike on all three layers — but a root
 * further out than that is more likely a measurement gone wrong, and
 * correcting it in full would be trusting that. Such a root is corrected only
 * as far as the limit allows, all its layers together, by one shared amount;
 * see `heldBackDb`.
 */

/**
 * A quadratic in pitch, in octaves from middle C (`octavesFromMiddleC`), so
 * its terms read as the level at middle C, the slope per octave and the bow.
 */
export type Quadratic = readonly [number, number, number];

export function octavesFromMiddleC(midi: number): number {
  return (midi - 60) / 12;
}

/** A fit's level at a key. */
export function evaluateFit(fit: Quadratic, midi: number): number {
  const x = octavesFromMiddleC(midi);
  return fit[0] + fit[1] * x + fit[2] * x * x;
}

/** The least-squares quadratic through `[x, y]` points; throws for fewer than three distinct x. */
export function fitQuadratic(points: readonly (readonly [number, number])[]): Quadratic {
  // The normal equations: sums of x⁰…x⁴, and of y·x⁰…y·x².
  const s = [0, 0, 0, 0, 0];
  const t = [0, 0, 0];
  for (const [x, y] of points) {
    let power = 1;
    for (let k = 0; k < 5; k += 1) {
      s[k] = (s[k] as number) + power;
      if (k < 3) t[k] = (t[k] as number) + power * y;
      power *= x;
    }
  }
  const [s0, s1, s2, s3, s4] = s as [number, number, number, number, number];
  const [t0, t1, t2] = t as [number, number, number];
  // Cramer's rule on the symmetric 3×3 system.
  const det3 = (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number,
    i: number,
  ) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const det = det3(s0, s1, s2, s1, s2, s3, s2, s3, s4);
  // Scale-aware: the determinant of distinct points is of the order of s0·s2·s4.
  if (!(Math.abs(det) > 1e-9 * Math.max(1, Math.abs(s0 * s2 * s4)))) {
    throw new Error('A quadratic fit needs at least three distinct pitches.');
  }
  return [
    det3(t0, s1, s2, t1, s2, s3, t2, s3, s4) / det,
    det3(s0, t0, s2, s1, t1, s3, s2, t2, s4) / det,
    det3(s0, s1, t0, s1, s2, t1, s2, s3, t2) / det,
  ];
}

/**
 * The furthest a recording's level is trusted to stray from its layer's fit.
 * Every root of the published grands lies within it: the furthest, Headroom's
 * F♯6, measures 6.9 dB off on its medium layer.
 */
export const MAX_RESIDUAL_DB = 7;

export function clampResidualDb(residualDb: number): number {
  return Math.min(MAX_RESIDUAL_DB, Math.max(-MAX_RESIDUAL_DB, residualDb));
}

/**
 * How much of a root's measured deviation the correction leaves in, given how
 * far each of its recordings (one per layer) measured from its layer's fit: 0
 * when every one is within `MAX_RESIDUAL_DB`, and otherwise the least shift,
 * shared by all of them, that brings each within it. The root then plays that
 * much above (or below) its target on every layer.
 *
 * Shared, because held back one recording at a time, a root with one layer
 * past the limit and the next inside it would step in level where the two
 * meet — which is the very thing the calibration is for. (Tried at a 4 dB
 * limit, that left six Headroom roots stepping by up to 2.2 dB.) Undefined
 * when no single shift will do, the recordings lying more than twice the limit
 * apart; each is then clamped on its own. No root of the published grands is
 * held back at all; this guards the packs to come.
 */
export function heldBackDb(residualsDb: readonly number[]): number | undefined {
  const least = Math.max(...residualsDb) - MAX_RESIDUAL_DB;
  const most = Math.min(...residualsDb) + MAX_RESIDUAL_DB;
  if (least > most) return undefined;
  return Math.min(most, Math.max(least, 0));
}

export interface CalibratedRoot {
  midi: number;
  /** The recording's level as measured; see the generator. */
  measuredDb: number;
  /**
   * The level its gain assumes: the measurement, less whatever `heldBackDb`
   * leaves in — always within `MAX_RESIDUAL_DB` of the fit.
   */
  correctedDb: number;
  /** The recording's sample peak, dBFS, over both channels and the whole file. */
  peakDb: number;
}

export interface LayerCalibration {
  /** The layer's level over pitch. */
  fit: Quadratic;
  /** How far its roots measure from the fit, root mean square, before clamping. */
  rmsResidualDb: number;
  /** Every recorded root of the layer, low to high. */
  roots: readonly CalibratedRoot[];
}

export interface VelocityCalibration {
  /**
   * Where middle C sounds at the reference velocity (`CURVE_REFERENCE_VELOCITY`),
   * in the same units as the measurements: chosen so the pack's middle three
   * octaves play at that velocity exactly as loudly as they did before the
   * calibration (`solveReferenceDb`).
   */
  referenceDb: number;
  /** One per velocity layer, by index. */
  layers: readonly LayerCalibration[];
}

/** One recording, as measured. */
export interface MeasuredRecording {
  layer: number;
  midi: number;
  levelDb: number;
  peakDb: number;
}

/**
 * Fit a quadratic through each layer's measured roots, then correct every
 * root, all its layers together (`heldBackDb`). Layers are numbered from 0.
 */
export function calibrateLayers(measured: readonly MeasuredRecording[]): LayerCalibration[] {
  const count = Math.max(-1, ...measured.map((recording) => recording.layer)) + 1;
  const layers = Array.from({ length: count }, (_, layer) =>
    measured.filter((recording) => recording.layer === layer).sort((a, b) => a.midi - b.midi),
  );
  const fits = layers.map((recordings) =>
    fitQuadratic(recordings.map((root) => [octavesFromMiddleC(root.midi), root.levelDb])),
  );
  const residualOf = (recording: MeasuredRecording) =>
    recording.levelDb - evaluateFit(fits[recording.layer] as Quadratic, recording.midi);

  const heldBack = new Map<number, number | undefined>();
  for (const midi of new Set(measured.map((recording) => recording.midi))) {
    const residuals = measured.filter((recording) => recording.midi === midi).map(residualOf);
    heldBack.set(midi, heldBackDb(residuals));
  }

  return layers.map((recordings, layer) => {
    const fit = fits[layer] as Quadratic;
    let squares = 0;
    const roots = recordings.map((recording) => {
      const residual = residualOf(recording);
      squares += residual * residual;
      const shared = heldBack.get(recording.midi);
      return {
        midi: recording.midi,
        measuredDb: recording.levelDb,
        correctedDb:
          shared === undefined
            ? evaluateFit(fit, recording.midi) + clampResidualDb(residual)
            : recording.levelDb - shared,
        peakDb: recording.peakDb,
      };
    });
    return { fit, rmsResidualDb: Math.sqrt(squares / recordings.length), roots };
  });
}

/** The level of a set of levels' average power. */
export function powerMeanDb(levelsDb: readonly number[]): number {
  let sum = 0;
  for (const level of levelsDb) sum += 10 ** (level / 10);
  return 10 * Math.log10(sum / levelsDb.length);
}

/**
 * The keys the anchor is kept over, C3–B5: the keyboard's default range, and
 * the keys the Wurlitzer's level match was measured on, against Salamander at
 * the anchor velocity (scripts/lib/wurlitzer.mjs). Keeping these as loud as
 * they were keeps that match true.
 */
export const ANCHOR_LOW_MIDI = 48;
export const ANCHOR_HIGH_MIDI = 83;

/**
 * The reference level that plays a pack's anchor keys, on average power, as
 * loudly as they played before: `todayDb` holds each key's old level,
 * `relativeDb` the level the calibration gives it with a reference of zero.
 */
export function solveReferenceDb(
  todayDb: readonly number[],
  relativeDb: readonly number[],
): number {
  if (todayDb.length !== relativeDb.length || todayDb.length === 0) {
    throw new Error('The anchor needs one relative level for every key.');
  }
  return powerMeanDb(todayDb) - powerMeanDb(relativeDb);
}

/** The closest of `roots` to `midi`, the lower of two as close; how the sample bank picks one. */
export function nearestRoot(roots: readonly number[], midi: number): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const root of [...roots].sort((a, b) => a - b)) {
    const distance = Math.abs(root - midi);
    if (distance < bestDistance) {
      best = root;
      bestDistance = distance;
    }
  }
  return best;
}

/** The layer whose balance across the keyboard every target follows. */
export const TILT_LAYER = 1;

/** The medium layer's level at `midi` relative to middle C: the pack's own bass-to-treble balance. */
export function registerTiltDb(calibration: VelocityCalibration, midi: number): number {
  const fit = calibration.layers[TILT_LAYER]?.fit;
  return fit ? evaluateFit(fit, midi) - fit[0] : 0;
}

/** Where a key struck at `velocity` should sound. */
export function targetDb(calibration: VelocityCalibration, velocity: number, midi: number): number {
  return calibration.referenceDb + curveDb(velocity) + registerTiltDb(calibration, midi);
}

/** The level the table takes a recording to have, or undefined when it holds none such. */
export function correctedLevelDb(
  calibration: VelocityCalibration,
  layer: number,
  root: number,
): number | undefined {
  return calibration.layers[layer]?.roots.find((entry) => entry.midi === root)?.correctedDb;
}

/**
 * The voice gain that plays key `midi` at `velocity` from the recording of
 * `root` on `layer` — whichever one the bank found, so a stand-in during a
 * partial load sounds as loud as the recording it stands in for. Undefined
 * when the table holds no such recording.
 */
export function calibratedGain(
  calibration: VelocityCalibration,
  velocity: number,
  midi: number,
  layer: number,
  root: number,
): number | undefined {
  const recorded = correctedLevelDb(calibration, layer, root);
  if (recorded === undefined) return undefined;
  return 10 ** ((targetDb(calibration, velocity, midi) - recorded) / 20);
}

/**
 * The loudest a single voice can peak at `velocity`, as a linear amplitude:
 * each recording's sample peak times the gain it plays at, on every key it can
 * sound — its own, and any within `reachSemitones` it may stand in for during a
 * partial load, kept to the keys the pack was recorded across. The tilt makes
 * a recording's gain depend on the key, so a stand-in can peak higher than the
 * recording on its own key does.
 */
export function loudestVoicePeak(
  calibration: VelocityCalibration,
  velocity: number,
  reachSemitones: number,
): number {
  const roots = calibration.layers.flatMap((layer) => layer.roots.map((root) => root.midi));
  const lowest = Math.min(...roots);
  const highest = Math.max(...roots);
  let loudest = 0;
  for (const [layer, { roots: recordings }] of calibration.layers.entries()) {
    for (const { midi: root, peakDb } of recordings) {
      const from = Math.max(lowest, root - reachSemitones);
      const to = Math.min(highest, root + reachSemitones);
      for (let midi = from; midi <= to; midi += 1) {
        const gain = calibratedGain(calibration, velocity, midi, layer, root) ?? 0;
        loudest = Math.max(loudest, gain * 10 ** (peakDb / 20));
      }
    }
  }
  return loudest;
}

/** Whether the table holds every one of these recordings. */
export function calibrationCovers(
  calibration: VelocityCalibration,
  files: readonly { layer: number; midi: number }[],
): boolean {
  return files.every((file) => correctedLevelDb(calibration, file.layer, file.midi) !== undefined);
}

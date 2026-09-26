/**
 * How much louder a harder note is: one curve, in decibels, for every piano
 * whose recordings are calibrated (see velocityCalibration.ts).
 *
 * The level is a power of the velocity, anchored at the velocity the computer
 * keyboard plays by default, so the app's everyday level stays where it was:
 *
 *   curveDb(v) = 20 · γ · log10(v / 0.75)
 *
 *   velocity   0.1     0.25    0.5    0.75   1
 *   dB         −21.0   −11.5   −4.2   0      +3.0
 *
 * γ = 1.2 spans about 14 dB from a light touch (0.25) to full, and 24 dB from
 * 0.1; the per-layer trims it replaces gave about 8 and 13. The curve is the
 * whole of the dynamic range: every recording is first brought to its level,
 * so the velocity layers change only the timbre, never the loudness.
 */

/** Where the curve is 0 dB: the computer keyboard's default velocity. */
export const CURVE_REFERENCE_VELOCITY = 0.75;

/** The curve's exponent, as a power of velocity: 20·γ dB for every tenfold. */
export const CURVE_GAMMA = 1.2;

/**
 * The softest a note plays, relative to the reference: 33 dB under a note at
 * full velocity, inside the 30–40 dB a grand spans from its softest to its
 * loudest. The curve reaches it at velocity 0.042, between MIDI 5 and 6, so it
 * catches only MIDI velocities 1–5, which the curve alone would take down to
 * nearly −48 dB — too far under everything else to hear. The app's own inputs
 * never play that softly: the lightest touch is 0.15, at −17 dB.
 */
export const CURVE_FLOOR_DB = -30;

/** A note's level at `velocity` (0..1, clamped), in dB relative to the reference velocity. */
export function curveDb(velocity: number): number {
  const clamped = Math.min(1, velocity);
  if (!(clamped > 0)) return CURVE_FLOOR_DB;
  const level = 20 * CURVE_GAMMA * Math.log10(clamped / CURVE_REFERENCE_VELOCITY);
  return Math.max(CURVE_FLOOR_DB, level);
}

/**
 * The velocity that plays at `levelDb` on the curve: its inverse, for a level
 * named in decibels rather than a velocity guessed at. A level at or under the
 * floor gives the velocity where the curve meets it; one past full velocity's
 * +3 dB, full velocity.
 */
export function velocityForCurveDb(levelDb: number): number {
  const level = Math.max(CURVE_FLOOR_DB, levelDb);
  return Math.min(1, CURVE_REFERENCE_VELOCITY * 10 ** (level / (20 * CURVE_GAMMA)));
}

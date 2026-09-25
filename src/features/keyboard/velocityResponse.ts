/**
 * Input curves: how a gesture becomes a note's velocity, 0..1.
 *
 * Every input with a velocity of its own reads it through here — a touch on
 * the key bed, a MIDI keyboard's strike, a Shift-accented key on the computer
 * keyboard — so one module decides what each gesture is worth. The game
 * controller has no velocity to read and plays the fixed one.
 *
 * What a curve returns is what gets recorded. A take stores its velocities
 * after the curve, so these settings reach its drawn dynamics and its MIDI
 * export; a stored take always plays back exactly as it was captured, whatever
 * the curves say today.
 */

export type TouchSensitivity = 'light' | 'normal' | 'firm';

export const TOUCH_SENSITIVITIES = ['light', 'normal', 'firm'] as const;

export type MidiVelocityCurve = 'light' | 'normal' | 'heavy';

export const MIDI_VELOCITY_CURVES = ['light', 'normal', 'heavy'] as const;

/** The softest and loudest raw velocities a calibration captured, 1..127. */
export interface MidiVelocityRange {
  min: number;
  max: number;
}

/**
 * Touch position on a key: soft near the top, full at the bottom, rising from
 * a floor on a power curve. `normal` is the curve the piano has always had;
 * the others move the floor by 0.1 and the exponent by 0.4 either way:
 *
 *   sensitivity   floor   exponent   top of key   halfway   forte by
 *   light         0.35    1.0        0.35 (p)     0.68      56% down the key
 *   normal        0.25    1.4        0.25 (pp)    0.53      71%
 *   firm          0.15    1.8        0.15 (ppp)   0.39      80%
 *
 * Forte is the importer's MIDI 90 (`FORTE_VELOCITY`), and the marks are the
 * bands the score draws, so the lightest touch lands a dynamic apart on each.
 * All three meet at full velocity at the bottom of the key: a sensitivity
 * moves where loud begins, never what the loudest note is. Light is a straight
 * line, so every step down the key adds the same.
 */
const TOUCH_CURVES: Record<TouchSensitivity, { floor: number; exponent: number }> = {
  light: { floor: 0.35, exponent: 1 },
  normal: { floor: 0.25, exponent: 1.4 },
  firm: { floor: 0.15, exponent: 1.8 },
};

/** yFraction 0 is the top of the key, 1 the bottom; anything past either is the edge. */
export function touchVelocity(yFraction: number, sensitivity: TouchSensitivity): number {
  const { floor, exponent } = TOUCH_CURVES[sensitivity];
  const clamped = Math.min(1, Math.max(0, yFraction));
  return Math.min(1, floor + (1 - floor) * Math.pow(clamped, exponent));
}

/**
 * The narrowest calibrated span accepted. Stretching less than this over the
 * whole of 1–127 would turn the slightest difference in touch into the full
 * dynamic range, and such a capture is far more likely a misunderstood prompt
 * than a keyboard that really plays that narrowly.
 */
export const MIN_MIDI_RANGE_SPAN = 16;

/**
 * Exponents on the calibrated velocity, as a fraction of full. Light and heavy
 * undo each other, and each moves the middle strike about as far as the touch
 * sensitivities move the middle of a key: 64 plays as 80 on light and as 45 on
 * heavy. Full velocity stays full on both.
 */
const MIDI_CURVE_EXPONENTS: Record<Exclude<MidiVelocityCurve, 'normal'>, number> = {
  light: 2 / 3,
  heavy: 1.5,
};

/**
 * A MIDI note-on velocity, 1..127, as the piano plays it. A calibrated range
 * is stretched over the whole of 1–127 first — a strike outside it counts as
 * its nearer end — and the curve bends the result. `normal` with no range is
 * the device's own velocity, unchanged.
 */
export function midiVelocity(
  raw: number,
  curve: MidiVelocityCurve,
  range: MidiVelocityRange | null,
): number {
  const linear = Math.min(1, Math.max(0, calibrated(raw, range) / 127));
  if (curve === 'normal') return linear;
  return Math.pow(linear, MIDI_CURVE_EXPONENTS[curve]);
}

function calibrated(raw: number, range: MidiVelocityRange | null): number {
  if (!range || range.max <= range.min) return raw;
  const stretched = 1 + ((raw - range.min) * 126) / (range.max - range.min);
  return Math.min(127, Math.max(1, stretched));
}

/** The range a softest and a loudest strike make, or null when they are too close to use. */
export function calibratedRange(softest: number, loudest: number): MidiVelocityRange | null {
  return loudest - softest >= MIN_MIDI_RANGE_SPAN ? { min: softest, max: loudest } : null;
}

/**
 * How much Shift adds to a computer-keyboard note. The computer keyboard has
 * no touch to read, so an accent is a fixed step up from the fixed velocity:
 * at the default 0.75 an accented note plays at 0.95.
 */
const ACCENT_STEP = 0.2;

export function accentVelocity(base: number): number {
  return Math.min(1, base + ACCENT_STEP);
}

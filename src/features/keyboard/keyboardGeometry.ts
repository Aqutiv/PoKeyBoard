import { isBlackKey } from '@/utils/midi';

/** Full addressable range: A0 through C8 (both white keys). */
export const FULL_RANGE_LOW = 21;
export const FULL_RANGE_HIGH = 108;

/** Default visible anchor: C3 (spec default range C3-B5). */
export const DEFAULT_ANCHOR_MIDI = 48;

export const BLACK_KEY_WIDTH = 0.62; // in white-key units
export const BLACK_KEY_HEIGHT = 0.62; // fraction of white-key height

/**
 * Real pianos nudge black keys off exact centers; these are the black-key
 * center positions in white-key units measured from the octave's C.
 */
const BLACK_CENTER_FROM_C: Record<number, number> = {
  1: 0.95, // C#
  3: 2.05, // D#
  6: 3.93, // F#
  8: 5.0, // G#
  10: 6.07, // A#
};

export interface KeyLayout {
  midi: number;
  isBlack: boolean;
  /** Left edge in white-key units from the layout's low key. */
  x: number;
  /** Width in white-key units. */
  width: number;
}

export interface KeyboardLayout {
  lowMidi: number;
  highMidi: number;
  whiteCount: number;
  keys: KeyLayout[];
}

export function isWhiteKey(midi: number): boolean {
  return !isBlackKey(midi);
}

/** Snap a midi down (or up) to the nearest white key. */
export function snapToWhite(midi: number, direction: 1 | -1 = -1): number {
  let out = midi;
  while (isBlackKey(out)) out += direction;
  return out;
}

/** Count white keys in [lowMidi, highMidi] inclusive. */
export function whiteKeyCount(lowMidi: number, highMidi: number): number {
  let count = 0;
  for (let midi = lowMidi; midi <= highMidi; midi += 1) {
    if (isWhiteKey(midi)) count += 1;
  }
  return count;
}

/** Sizing policy for the visible keyboard. */
export const MIN_WHITE_KEY_PX = 38;
// Low enough that a fullscreen 4K window (container ~3740px after the nav
// sidebar and page padding) still fits all 52 whites: 51 * 72 = 3672 < 3740.
export const MAX_WHITE_KEY_PX = 72;
export const MIN_VISIBLE_WHITES = 7;
/** Up to this count, keys stretch to fill the container (phone/tablet/laptop behavior). */
export const STRETCH_MAX_WHITES = 21;
/** Hard cap: every white key of the full A0..C8 piano. */
export const MAX_VISIBLE_WHITES = whiteKeyCount(FULL_RANGE_LOW, FULL_RANGE_HIGH);
/** Fallback while the container is unmeasured (first pre-effect paint). */
export const DEFAULT_VISIBLE_WHITES = 14;

/**
 * How many white keys a container of `widthPx` shows. Narrow containers get
 * as many keys as fit at MIN_WHITE_KEY_PX, stretched to fill; once keys
 * would stretch past MAX_WHITE_KEY_PX more keys appear instead, up to the
 * full piano.
 */
export function computeVisibleWhites(widthPx: number): number {
  if (widthPx <= 0) return DEFAULT_VISIBLE_WHITES;
  const fitAtMin = Math.floor(widthPx / MIN_WHITE_KEY_PX);
  const neededAtMax = Math.ceil(widthPx / MAX_WHITE_KEY_PX);
  const target = Math.min(fitAtMin, Math.max(STRETCH_MAX_WHITES, neededAtMax));
  return Math.min(MAX_VISIBLE_WHITES, Math.max(MIN_VISIBLE_WHITES, target));
}

/**
 * The midi reached by covering `count` white keys (inclusive of a white
 * start) in `direction`. Clamps to the full range.
 */
export function stepWhites(startMidi: number, count: number, direction: 1 | -1): number {
  let midi = startMidi;
  let seen = 0;
  while (seen < count && midi >= FULL_RANGE_LOW && midi <= FULL_RANGE_HIGH) {
    if (isWhiteKey(midi)) seen += 1;
    if (seen === count) break;
    midi += direction;
  }
  return Math.min(FULL_RANGE_HIGH, Math.max(FULL_RANGE_LOW, midi));
}

/** Highest white-key low anchor from which `visibleWhites` whites still fit below C8. */
export function maxLowMidiFor(visibleWhites: number): number {
  return stepWhites(FULL_RANGE_HIGH, visibleWhites, -1);
}

/**
 * Lay out the keys of an inclusive midi range. Both ends are snapped to
 * white keys so the keyboard always starts and ends with a full white key.
 */
export function layoutKeyboard(lowMidiRaw: number, highMidiRaw: number): KeyboardLayout {
  const lowMidi = snapToWhite(Math.max(FULL_RANGE_LOW, lowMidiRaw), 1);
  const highMidi = snapToWhite(Math.min(FULL_RANGE_HIGH, highMidiRaw), -1);

  const keys: KeyLayout[] = [];
  let whiteIndex = 0;
  // The C at or below lowMidi anchors black-key offsets per octave.
  for (let midi = lowMidi; midi <= highMidi; midi += 1) {
    if (isWhiteKey(midi)) {
      keys.push({ midi, isBlack: false, x: whiteIndex, width: 1 });
      whiteIndex += 1;
    } else {
      const pitchClass = midi % 12;
      const octaveC = midi - pitchClass;
      const whitesBeforeOctaveC = whiteKeyCount(lowMidi, octaveC - 1);
      const center = whitesBeforeOctaveC + (BLACK_CENTER_FROM_C[pitchClass] ?? 0);
      keys.push({ midi, isBlack: true, x: center - BLACK_KEY_WIDTH / 2, width: BLACK_KEY_WIDTH });
    }
  }
  return { lowMidi, highMidi, whiteCount: whiteIndex, keys };
}

/**
 * Hit-test a point against the layout. Black keys win over the white keys
 * they overlap. x in white-key units, y as fraction of key height (0=top).
 */
export function hitTestKey(layout: KeyboardLayout, x: number, y: number): number | null {
  if (x < 0 || x >= layout.whiteCount || y < 0 || y > 1) return null;
  if (y <= BLACK_KEY_HEIGHT) {
    for (const key of layout.keys) {
      if (!key.isBlack) continue;
      if (x >= key.x && x <= key.x + key.width) return key.midi;
    }
  }
  const whiteIndex = Math.floor(x);
  let seen = 0;
  for (const key of layout.keys) {
    if (key.isBlack) continue;
    if (seen === whiteIndex) return key.midi;
    seen += 1;
  }
  return null;
}

/**
 * Touch-position velocity: soft near the key top, strong near the bottom,
 * on a musical (non-linear) curve. yFraction 0 = top of key, 1 = bottom.
 */
export function touchVelocity(yFraction: number): number {
  const clamped = Math.min(1, Math.max(0, yFraction));
  return Math.min(1, 0.25 + 0.75 * Math.pow(clamped, 1.4));
}

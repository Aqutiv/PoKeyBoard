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

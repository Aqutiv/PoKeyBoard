/** Lowest supported key: A0. */
export const MIDI_MIN = 21;
/** Highest supported key: C8. */
export const MIDI_MAX = 108;

/** Default visible/playable range: C3 through B5. */
export const DEFAULT_RANGE_LOW = 48;
export const DEFAULT_RANGE_HIGH = 83;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const LETTER_TO_PITCH_CLASS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function isValidMidi(midi: number): boolean {
  return Number.isInteger(midi) && midi >= 0 && midi <= 127;
}

/** MIDI 60 → "C4" (scientific pitch, sharps only — C-major display context). */
export function midiToNoteName(midi: number): string {
  if (!isValidMidi(midi)) {
    throw new RangeError(`Invalid MIDI note: ${midi}`);
  }
  const pitchClass = SHARP_NAMES[midi % 12] as string;
  const octave = Math.floor(midi / 12) - 1;
  return `${pitchClass}${octave}`;
}

/**
 * "C4" → 60, "C#4"/"Db4" → 61. Accidental arithmetic wraps octaves naturally
 * (Cb4 → 59, B#3 → 60). Returns null for unparseable or out-of-range names.
 */
export function noteNameToMidi(name: string): number | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d{1,2})$/.exec(name.trim());
  if (!match) return null;
  const letter = (match[1] as string).toUpperCase();
  const accidental = match[2] as string;
  const octave = Number(match[3]);

  let pitchClass = LETTER_TO_PITCH_CLASS[letter];
  if (pitchClass === undefined) return null;
  if (accidental === '#') pitchClass += 1;
  if (accidental === 'b') pitchClass -= 1;

  const midi = 12 * (octave + 1) + pitchClass;
  return isValidMidi(midi) ? midi : null;
}

export function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Semitone offset of `midi` from `rootMidi`, for playbackRate = 2^(offset/12). */
export function semitoneOffset(midi: number, rootMidi: number): number {
  return midi - rootMidi;
}

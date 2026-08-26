/**
 * What an exercise asks for, as plain serializable data.
 *
 * Specs carry no functions so a chapter is content, not code: they diff
 * readably in review, and the exhaustive switches over `kind` turn "I added an
 * exercise type" into a compile error at every site that has to handle it.
 */

/** 0 = C, 1 = C♯ … 11 = B. */
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/**
 * How "at the same time" is judged.
 *
 * `overlap` is the honest definition and needs no clock. `onsetWindowMs` is
 * ORed in because a desktop mouse is a single pointer — `KeyboardPointerTracker`
 * sounds one key per pointer id, so a mouse user physically cannot hold two
 * keys down and would otherwise be unable to finish the exercise at all.
 * Omitting `together` entirely means simultaneity is not required: presses
 * accumulate for as long as the step is open.
 */
export interface Togetherness {
  overlap: boolean;
  /** Presses this close to the newest one count as one gesture. */
  onsetWindowMs?: number;
}

/** The window that reads as one gesture without feeling like a race. */
export const DEFAULT_ONSET_WINDOW_MS = 400;

export type ExerciseSpec =
  /** Any `count` distinct keys — the unfailable opener. */
  | { kind: 'distinctKeys'; count: number }
  /**
   * Any note, then another at least this far above it. Stated as a minimum
   * rather than as halves of the keyboard so it holds at any width — a phone
   * shows one octave, a desktop shows three.
   */
  | { kind: 'risingLeap'; minSemitoneGap: number }
  /** One named pitch class, optionally in `octaves` different octaves. */
  | { kind: 'pitchClass'; pitchClass: PitchClass; octaves?: number }
  /** Exactly these keys, octave-pinned. */
  | { kind: 'exactKeys'; midis: readonly number[]; together?: Togetherness }
  /**
   * Two notes `semitones` apart. `lowerPitchClass` pins "a C and the next C up"
   * without pinning which octave it happens in.
   */
  | {
      kind: 'interval';
      semitones: number;
      lowerPitchClass?: PitchClass;
      together?: Togetherness;
    }
  /** A whole black-key group: 2 means {C♯,D♯}, 3 means {F♯,G♯,A♯}. */
  | { kind: 'blackKeyGroup'; size: 2 | 3; together?: Togetherness }
  /**
   * These pitch classes, in this order, in any octave. The only ordered kind —
   * everything else counts a set, which cannot express "C then D" or a scale
   * whose first and last note are both C.
   */
  | {
      kind: 'sequence';
      pitchClasses: readonly PitchClass[];
      /** 'up'/'down' require each note to move that way against the previous. */
      direction?: 'up' | 'down' | 'any';
    };

/** Every kind but `sequence`, which is counted by position rather than membership. */
export type UnorderedSpec = Exclude<ExerciseSpec, { kind: 'sequence' }>;

/** Denominator of the "{done} of {total}" readout. */
export function goalTotal(spec: ExerciseSpec): number {
  switch (spec.kind) {
    case 'distinctKeys':
      return spec.count;
    case 'risingLeap':
      return 2;
    case 'pitchClass':
      return spec.octaves ?? 1;
    case 'exactKeys':
      return spec.midis.length;
    case 'interval':
      return 2;
    case 'blackKeyGroup':
      return spec.size;
    case 'sequence':
      return spec.pitchClasses.length;
  }
}

/** Pitch class of a MIDI number. */
export function pitchClassOf(midi: number): number {
  return midi % 12;
}

/**
 * The lowest member of a black-key group of this size, as a pitch class:
 * C♯ starts the group of two, F♯ the group of three.
 */
export function blackGroupRootPitchClass(size: 2 | 3): number {
  return size === 2 ? 1 : 6;
}

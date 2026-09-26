import { momentsOf } from './phrase';
import type { LearnPhrase } from './types';

/**
 * What an exercise asks for, as plain serializable data.
 *
 * Specs carry no functions so a chapter is content, not code: they diff
 * readably in review, and the exhaustive switches over `kind` turn "I added an
 * exercise type" into a compile error at every site that has to handle it.
 */

/** 0 = C, 1 = C♯ … 11 = B. */
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/** Whether a triad's third is the big one (4 half steps) or the small one (3). */
export type ChordQuality = 'major' | 'minor';

/** A named triad: "A minor" is `{ root: 9, quality: 'minor' }`. */
export interface NamedChord {
  root: PitchClass;
  quality: ChordQuality;
}

/**
 * The three notes of a triad in close root position, from `rootMidi`: the root,
 * a third above it — big or small, which is the whole difference — and the
 * fifth, seven half steps up either way.
 */
export function triadMidis(rootMidi: number, quality: ChordQuality): readonly number[] {
  return [rootMidi, rootMidi + (quality === 'major' ? 4 : 3), rootMidi + 7];
}

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

/**
 * How far off the beat still counts as on it.
 *
 * Generous on purpose — at 60bpm this is a quarter of a second either side.
 * Stated in beats rather than milliseconds so it means the same thing at any
 * tempo, the way a musician's sense of "in time" does.
 */
export const DEFAULT_RHYTHM_TOLERANCE_BEATS = 0.25;

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
    }
  /**
   * A written rhythm, judged against the lesson's click. The only kind that
   * grades *when* rather than *what*.
   *
   * `beats` are offsets from a bar line rather than absolute positions, so the
   * pattern matches at any bar and the user can listen for a bar or two before
   * joining in — which is all that counting in ever means.
   *
   * Beats rather than milliseconds because the reducer has to stay pure: the
   * adapter owns the click grid and converts before anything reaches here. A
   * tolerance in beats also survives a tempo change that one in milliseconds
   * would quietly betray.
   */
  | {
      kind: 'rhythm';
      /** Offsets from a bar line, ascending, starting at 0. */
      beats: readonly number[];
      /** Beats per bar. Must equal the click grid's numerator. */
      barBeats: number;
      /** Omitted means any key: the pulse step, where the point is when, not what. */
      midi?: number;
      toleranceBeats?: number;
    }
  /**
   * A written line, played from the page: pitch and order, and — when timed —
   * rhythm too. The kind the whole course has been building towards, and the
   * first that grades *what* and *when* at once.
   *
   * It carries the phrase itself rather than a list of notes derived from it,
   * so the gate, the drawing and the lighting all read one object and cannot
   * disagree. The phrase is plain data; a spec is still content, not code.
   *
   * The line is walked as *moments* — every note that starts on one beat —
   * so a chord is one step of the line, however it is struck.
   */
  | {
      kind: 'playAlong';
      phrase: LearnPhrase;
      /**
       * Graded against the lesson click, bar-anchored exactly like `rhythm`:
       * the line may begin on any bar line. Omitted means order only — the
       * "wait for you" of Play's Training modes.
       */
      timed?: { toleranceBeats?: number };
      /**
       * A moment's notes must be down together, and nothing else with them.
       * Omitted means they accumulate in any order, which is what lets one
       * mouse pointer finish a moment for two hands.
       */
      together?: Togetherness;
      /**
       * Moment indices a wrong note falls back to. `[0]` by default — the
       * `sequence` rule. A timed checkpoint must sit on a bar line, since
       * coming back in means coming in on a downbeat.
       */
      checkpoints?: readonly number[];
      /**
       * Each moment also asks for a fresh press of the sustain pedal once its
       * notes are down — changing the pedal with the harmony. The press has to
       * come *after* the notes: a pedal held straight through a change leaves
       * no new press, which is exactly the blur being taught against. Untimed
       * only — a change is judged by its order, not its beat.
       */
      pedal?: 'changeEach';
    }
  /**
   * A named triad as a block, in close root position, in any octave: "play A
   * minor" is A–C–E anywhere on the keyboard, root at the bottom. The keys down
   * must be exactly those three — a chord with a fourth key in it is a
   * different chord, not a better attempt at this one.
   *
   * Octave-free where `exactKeys` is pinned, because nothing is drawn: the
   * name is the question, and a chord is the same chord in every octave.
   */
  | { kind: 'chord'; chord: NamedChord; together: Togetherness };

/**
 * Every kind counted by membership. `sequence`, `rhythm` and `playAlong` are
 * counted by position instead — through the keyboard, the bar, or the page.
 */
export type UnorderedSpec = Exclude<
  ExerciseSpec,
  { kind: 'sequence' } | { kind: 'rhythm' } | { kind: 'playAlong' } | { kind: 'chord' }
>;

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
    case 'rhythm':
      return spec.beats.length;
    case 'playAlong':
      return momentsOf(spec.phrase).length;
    case 'chord':
      return 3;
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

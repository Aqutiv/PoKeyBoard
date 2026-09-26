import type { NoteStaff, TimeSignature } from '@/domain/takeTypes';
import type { TrackEvent } from '@/features/library/trackBuilder';
import type { ScoreChrome, StaffMode } from '@/features/notation/scoreRenderer';
import type { PlaybackMode } from '@/features/transport/modes';
import type { Messages } from '@/i18n/types';
import type { ExerciseSpec, NamedChord, PitchClass } from './exerciseSpec';
import type { NoteSpelling } from './noteLabel';
import type { LearnLevelId } from './levels';

/**
 * Chapter ids double as message keys, so a chapter added to the catalog
 * without a title and blurb in all four locales fails `tsc` rather than
 * rendering a blank card.
 */
export type LearnChapterId = keyof Messages['learn']['chapterTitles'];

/** The named run of chapters a chapter belongs to inside its level. */
export type LearnPartId = keyof Messages['learn']['partTitles'];

export type LearnStepId = string;

/** Catalog entry: metadata only. Steps arrive through `load`. */
export interface LearnChapterMeta {
  id: LearnChapterId;
  level: LearnLevelId;
  /** 1-based position within its level; drives display order. */
  order: number;
  /** Which part of the level this sits under. Parts are consecutive runs. */
  part: LearnPartId;
  /**
   * `null` until this chapter's steps are authored, which is what renders it
   * as "coming soon". Kept as a thunk so 19 chapters of content never land in
   * the bundle just because the outline is on screen.
   */
  load: (() => Promise<LearnChapter>) | null;
}

export interface LearnChapter {
  id: LearnChapterId;
  steps: readonly LearnStep[];
  /**
   * Where the closing card sends the user: a Library track opened on Play in
   * a Training mode, so the piece just learned is waiting there to practise.
   * Omitted leaves the plain "Try it on Play" onto an empty keyboard.
   *
   * The mode is written to the saved Play setting, which is why the button
   * says it opens in Training rather than switching it behind anyone's back.
   */
  handoff?: LearnHandoff;
}

export interface LearnHandoff {
  trackId: string;
  mode: Exclude<PlaybackMode, 'simple'>;
  /**
   * Play's practice speed to open at — one of `PLAYBACK_SPEEDS`, so the speed
   * menu shows it as chosen. Omitted is the track's own speed.
   */
  speed?: number;
  /**
   * The passage Play's A–B loop repeats, in the track's beats from its start:
   * the bars the chapter practised. Omitted is no loop.
   */
  loopBeats?: readonly [from: number, to: number];
}

export type LearnStep = TheoryStep | ExerciseStep | QuizStep | DrillStep;

interface StepBase {
  /**
   * Stable within the chapter. Progress and prose key off this, never the
   * array index, so inserting a step must not reset anyone's progress.
   */
  id: LearnStepId;
  visual?: LearnVisual;
  /** Notes the Listen button demonstrates. Omitted means no button. */
  listen?: LearnPhrase;
  /** Where the keyboard should park for this step. Omitted leaves it alone. */
  anchorMidi?: number;
  /**
   * A range the keyboard must show whole, however narrow the screen: keys are
   * narrowed to fit it, down to a floor. For a line nobody can pause to shift
   * the keyboard in the middle of — a scale is eight white keys, and a 320px
   * phone shows seven. `lowMidi` should be the step's `anchorMidi`.
   */
  fit?: { lowMidi: number; highMidi: number };
  /**
   * The step needs two hands' worth of keyboard: more white keys than a phone
   * held upright shows at a playable width, and more than the computer
   * keyboard's octave and a half reaches. Such a step is untimed, and its
   * prose says what to play it with — touch, a MIDI keyboard, or the mouse
   * one note at a time. The runner asks a portrait phone to turn sideways.
   */
  wide?: true;
  /**
   * Run the lesson click through this step.
   *
   * Only ever needed to turn the click on *early* — a `rhythm` exercise brings
   * its own, since a step judged against a click it never started would be
   * unwinnable. This is what lets a theory card introduce the pulse before
   * anything is asked of the reader.
   */
  click?: true;
  /**
   * The click's tempo on this step, in quarter-note beats per minute. 60
   * unless stated, and stated only where a click runs. A timed line and a
   * Listen phrase on the step are written at this tempo, so the demo, the
   * click and the grading all keep the same beat.
   */
  tempo?: number;
}

export interface TheoryStep extends StepBase {
  kind: 'theory';
}

export interface ExerciseStep extends StepBase {
  kind: 'exercise';
  spec: ExerciseSpec;
}

/**
 * Recognition rather than production: the app shows something and the user
 * names it. Playing a note and knowing what it is called are different skills,
 * and an exercise can only ever test the first.
 */
export interface QuizStep extends StepBase {
  kind: 'quiz';
  /** Correct answers needed before the step is satisfied. */
  rounds: number;
  question: QuizQuestion;
}

/**
 * The mirror of a quiz: the app names something and the user plays it, over
 * several rounds. A quiz tests that you can name a key; only a drill tests that
 * you can find it.
 *
 * Not an `ExerciseSpec` kind — rounds cannot live in a spec, since the matcher
 * is a pure reducer with no notion of them and `goalTotal` would become
 * ambiguous between notes and rounds. A drill is a *sequencer over* specs, and
 * reuses the matcher untouched.
 */
export interface DrillStep extends StepBase {
  kind: 'drill';
  /** Rounds that must be played before the step is satisfied. */
  rounds: number;
  /** What each round asks for; cycled deterministically. */
  drill: DrillPool;
}

export type DrillPool =
  | {
      /**
       * The round names a triad — "Play A minor." — and the user plays it as a
       * block, in close root position, in any octave. Nothing is drawn: the
       * name is the question.
       */
      kind: 'namedChord';
      chords: readonly NamedChord[];
    }
  | {
      /**
       * The round names a degree of a major scale — "play degree 5" — and the
       * user plays it, in any octave. Knowing a scale is knowing where each of
       * its steps lives, not only reciting them in order.
       */
      kind: 'scaleDegree';
      /** Degree 1: the scale's home note. */
      tonic: PitchClass;
      /** The degrees asked for, 1–7, in the shared stride order. */
      degrees: readonly number[];
    }
  | {
      kind: 'namedKey';
      pitchClasses: readonly PitchClass[];
      /** Which name each round asks under. Defaults to sharps. */
      spelling?: NoteSpelling;
    }
  | {
      /** The round shows a note on a staff and the user plays it. */
      kind: 'readNote';
      pitchClasses: readonly PitchClass[];
      /** Octave the notes are drawn in, as a midi offset. C4 by default. */
      baseMidi?: number;
      /**
       * Which staff to write the note on, and to draw. Treble by default.
       *
       * Stated rather than derived from `baseMidi`, because the note the
       * derivation would get wrong is the one the bass chapter is *about*:
       * middle C is exactly `TREBLE_SPLIT_MIDI`, and it is legitimately
       * written on either staff. A second splitting rule living beside
       * `midiToStaffPosition` could only ever disagree with it.
       */
      staff?: NoteStaff;
    };

export type QuizQuestion =
  | {
      /**
       * A triad is heard, never seen, and the answer is its quality: major or
       * minor. The only question the course asks of the ear alone — the third
       * decides the mood, and the mood is something you hear.
       */
      kind: 'chordQuality';
      /** Drawn from in the shared stride order. */
      chords: readonly NamedChord[];
    }
  | {
      kind: 'nameTheKey';
      /** Drawn from in a fixed order; also the order the answer buttons appear in. */
      pitchClasses: readonly PitchClass[];
      /** Which name the answer buttons offer. Defaults to sharps. */
      spelling?: NoteSpelling;
    }
  | {
      /** The question is a note on a staff; the answers are still letters. */
      kind: 'readNote';
      pitchClasses: readonly PitchClass[];
      spelling?: NoteSpelling;
      /**
       * Octave the notes are drawn in, as a midi offset. C4 by default, which
       * is where every note of the first reading chapter lives.
       */
      baseMidi?: number;
      /** Which staff to write the note on, and to draw. See `DrillPool`. */
      staff?: NoteStaff;
    };

export type LearnVisual =
  | {
      kind: 'keyboard';
      lowMidi: number;
      highMidi: number;
      /** Tinted with the accent colour. */
      highlight?: readonly number[];
      /** A second tint, for showing two groups apart from each other. */
      highlightSecondary?: readonly number[];
      /** Keys to print a name on. */
      labels?: readonly number[];
      /** Which name a labelled black key gets. White keys read the same either way. */
      spelling?: NoteSpelling;
      /** Arbitrary text per key — finger numbers, degrees — over `labels`. */
      labelText?: Readonly<Record<number, string>>;
    }
  | {
      kind: 'staff';
      phrase: LearnPhrase;
      /**
       * Which staves the picture draws. Treble by default.
       *
       * Stated rather than derived from the notes, so that the catalog test
       * asserting the two agree has something to compare. Making the
       * disagreement unrepresentable would also make the renderer bug it
       * guards against impossible to catch.
       */
      staves?: StaffMode;
      /** Draw the rests the engraver derived. See `StaffSnippet`. */
      rests?: boolean;
      /** Bar furniture; 'bare' unless the lesson is about the bar itself. */
      chrome?: ScoreChrome;
    };

/**
 * A short musical example, in the library's authoring format — so one written
 * phrase serves both the Listen demo and the engraved snippet.
 */
export interface LearnPhrase {
  bpm: number;
  timeSignature: TimeSignature;
  events: readonly TrackEvent[];
}

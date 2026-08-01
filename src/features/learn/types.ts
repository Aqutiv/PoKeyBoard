import type { TimeSignature } from '@/domain/takeTypes';
import type { TrackEvent } from '@/features/library/trackBuilder';
import type { Messages } from '@/i18n/types';
import type { ExerciseSpec, PitchClass } from './exerciseSpec';
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
}

export type LearnStep = TheoryStep | ExerciseStep | QuizStep;

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

export type QuizQuestion = {
  kind: 'nameTheKey';
  /** Drawn from in a fixed order; also the order the answer buttons appear in. */
  pitchClasses: readonly PitchClass[];
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
      /** Keys to print a letter name on. */
      labels?: readonly number[];
    }
  | { kind: 'staff'; phrase: LearnPhrase };

/**
 * A short musical example, in the library's authoring format — so one written
 * phrase serves both the Listen demo and the engraved snippet.
 */
export interface LearnPhrase {
  bpm: number;
  timeSignature: TimeSignature;
  events: readonly TrackEvent[];
}

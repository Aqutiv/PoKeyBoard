import type { LearnStepId } from '../types';

export interface StepProse {
  heading: string;
  body: readonly string[];
  /** Exercise steps only: the imperative that sits under the prose. */
  prompt?: string;
}

/** A chapter's writing, keyed by step id rather than position. */
export type ChapterProse = Record<LearnStepId, StepProse>;

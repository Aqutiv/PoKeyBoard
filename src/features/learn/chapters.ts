import type { LearnLevelId } from './levels';
import type { LearnChapterId, LearnChapterMeta } from './types';

/**
 * The curriculum, in order.
 *
 * Every chapter uses only what earlier chapters established, and each one ends
 * with something the user can actually play. A `load` of `null` means the
 * steps are not authored yet: the card still shows, because the outline is how
 * a newcomer sees where this goes.
 *
 * Availability is stated here rather than derived from progress. While most of
 * the course is unwritten, "finish chapter N to unlock N+1" would be a lie —
 * flipping an entry to a real `load` is the single edit that ships a chapter.
 */
export const LEARN_CHAPTERS: readonly LearnChapterMeta[] = [
  // ---- Beginner: from never having touched a piano to hands together -------
  {
    id: 'meetTheKeyboard',
    level: 'beginner',
    order: 1,
    load: () => import('./chapters/meetTheKeyboard').then((m) => m.MEET_THE_KEYBOARD),
  },
  { id: 'musicalAlphabet', level: 'beginner', order: 2, load: null },
  { id: 'halfStepsWholeSteps', level: 'beginner', order: 3, load: null },
  { id: 'trebleStaff', level: 'beginner', order: 4, load: null },
  { id: 'bassAndGrandStaff', level: 'beginner', order: 5, load: null },
  { id: 'rhythmAndBeat', level: 'beginner', order: 6, load: null },
  { id: 'firstMelody', level: 'beginner', order: 7, load: null },
  { id: 'cMajorScale', level: 'beginner', order: 8, load: null },
  { id: 'triads', level: 'beginner', order: 9, load: null },
  { id: 'chordsPedalAndHands', level: 'beginner', order: 10, load: null },

  // ---- Advanced: musicianship, ending in improvisation --------------------
  { id: 'keySignatures', level: 'advanced', order: 1, load: null },
  { id: 'minorKeys', level: 'advanced', order: 2, load: null },
  { id: 'intervals', level: 'advanced', order: 3, load: null },
  { id: 'inversions', level: 'advanced', order: 4, load: null },
  { id: 'seventhChords', level: 'advanced', order: 5, load: null },
  { id: 'rhythmBeyondFourFour', level: 'advanced', order: 6, load: null },
  { id: 'dynamicsAndArticulation', level: 'advanced', order: 7, load: null },
  { id: 'accompanimentPatterns', level: 'advanced', order: 8, load: null },
  { id: 'improvising', level: 'advanced', order: 9, load: null },
];

function inLevel(level: LearnLevelId): readonly LearnChapterMeta[] {
  return LEARN_CHAPTERS.filter((chapter) => chapter.level === level).sort(
    (a, b) => a.order - b.order,
  );
}

/** Chapters per level, computed once — the page never filters on render. */
export const LEARN_CHAPTERS_BY_LEVEL: Record<LearnLevelId, readonly LearnChapterMeta[]> = {
  beginner: inLevel('beginner'),
  advanced: inLevel('advanced'),
};

export function findLearnChapter(id: LearnChapterId): LearnChapterMeta | undefined {
  return LEARN_CHAPTERS.find((chapter) => chapter.id === id);
}

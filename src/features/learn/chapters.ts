import type { LearnLevelId } from './levels';
import type { LearnChapterId, LearnChapterMeta, LearnPartId } from './types';

/**
 * The curriculum, in order: three levels of ten, each in three named parts.
 *
 * Every chapter uses only what earlier chapters established, and each one ends
 * with something the user can actually play. A `load` of `null` means the
 * steps are not authored yet: the card still shows, because the outline is how
 * a newcomer sees where this goes.
 *
 * Availability is stated here rather than derived from progress. While most of
 * the course is unwritten, "finish chapter N to unlock N+1" would be a lie —
 * flipping an entry to a real `load` is the single edit that ships a chapter.
 *
 * Ids are permanent. Chapters have already moved between levels once, and
 * progress is keyed by id, so re-levelling must never cost anyone their place.
 */
export const LEARN_CHAPTERS: readonly LearnChapterMeta[] = [
  // ---- Beginner: never touched a piano → a simple piece, hands together ----
  {
    id: 'meetTheKeyboard',
    level: 'beginner',
    order: 1,
    part: 'theInstrument',
    load: () => import('./chapters/meetTheKeyboard').then((m) => m.MEET_THE_KEYBOARD),
  },
  {
    id: 'musicalAlphabet',
    level: 'beginner',
    order: 2,
    part: 'theInstrument',
    load: () => import('./chapters/musicalAlphabet').then((m) => m.MUSICAL_ALPHABET),
  },
  {
    id: 'halfStepsWholeSteps',
    level: 'beginner',
    order: 3,
    part: 'theInstrument',
    load: () => import('./chapters/halfStepsWholeSteps').then((m) => m.HALF_STEPS_WHOLE_STEPS),
  },
  { id: 'trebleStaff', level: 'beginner', order: 4, part: 'readingMusic', load: null },
  { id: 'bassAndGrandStaff', level: 'beginner', order: 5, part: 'readingMusic', load: null },
  { id: 'rhythmAndBeat', level: 'beginner', order: 6, part: 'readingMusic', load: null },
  { id: 'firstMelody', level: 'beginner', order: 7, part: 'playing', load: null },
  { id: 'cMajorScale', level: 'beginner', order: 8, part: 'playing', load: null },
  { id: 'triads', level: 'beginner', order: 9, part: 'playing', load: null },
  { id: 'chordsPedalAndHands', level: 'beginner', order: 10, part: 'playing', load: null },

  // ---- Intermediate: one piece in C → several keys, real accompaniment ----
  { id: 'howToPractise', level: 'intermediate', order: 1, part: 'gettingSerious', load: null },
  { id: 'keySignatures', level: 'intermediate', order: 2, part: 'gettingSerious', load: null },
  { id: 'scalesBeyondC', level: 'intermediate', order: 3, part: 'gettingSerious', load: null },
  { id: 'minorKeys', level: 'intermediate', order: 4, part: 'harmonyBuildingBlocks', load: null },
  { id: 'intervals', level: 'intermediate', order: 5, part: 'harmonyBuildingBlocks', load: null },
  { id: 'inversions', level: 'intermediate', order: 6, part: 'harmonyBuildingBlocks', load: null },
  {
    id: 'rhythmBeyondFourFour',
    level: 'intermediate',
    order: 7,
    part: 'playingWithStyle',
    load: null,
  },
  { id: 'arpeggios', level: 'intermediate', order: 8, part: 'playingWithStyle', load: null },
  {
    id: 'accompanimentPatterns',
    level: 'intermediate',
    order: 9,
    part: 'playingWithStyle',
    load: null,
  },
  {
    id: 'dynamicsAndArticulation',
    level: 'intermediate',
    order: 10,
    part: 'playingWithStyle',
    load: null,
  },

  // ---- Advanced: playing correctly → playing musically and inventing ------
  { id: 'seventhChords', level: 'advanced', order: 1, part: 'richerHarmony', load: null },
  { id: 'functionalHarmony', level: 'advanced', order: 2, part: 'richerHarmony', load: null },
  { id: 'modes', level: 'advanced', order: 3, part: 'richerHarmony', load: null },
  {
    id: 'twoHandIndependence',
    level: 'advanced',
    order: 4,
    part: 'independenceAndControl',
    load: null,
  },
  { id: 'ornaments', level: 'advanced', order: 5, part: 'independenceAndControl', load: null },
  { id: 'sightReading', level: 'advanced', order: 6, part: 'independenceAndControl', load: null },
  { id: 'playingByEar', level: 'advanced', order: 7, part: 'makingItYourOwn', load: null },
  { id: 'songForm', level: 'advanced', order: 8, part: 'makingItYourOwn', load: null },
  { id: 'leadSheets', level: 'advanced', order: 9, part: 'makingItYourOwn', load: null },
  { id: 'improvising', level: 'advanced', order: 10, part: 'makingItYourOwn', load: null },
];

function inLevel(level: LearnLevelId): readonly LearnChapterMeta[] {
  return LEARN_CHAPTERS.filter((chapter) => chapter.level === level).sort(
    (a, b) => a.order - b.order,
  );
}

/** Chapters per level, computed once — the page never filters on render. */
export const LEARN_CHAPTERS_BY_LEVEL: Record<LearnLevelId, readonly LearnChapterMeta[]> = {
  beginner: inLevel('beginner'),
  intermediate: inLevel('intermediate'),
  advanced: inLevel('advanced'),
};

/** One part heading and the consecutive run of chapters beneath it. */
export interface LearnSection {
  part: LearnPartId;
  chapters: readonly LearnChapterMeta[];
}

/**
 * Split a level into its parts, once at module load.
 *
 * Runs are built by walking the ordered chapters rather than by grouping, so a
 * part that is accidentally split in two shows up as two headings instead of
 * silently reordering the course behind a single one — and a test catches it.
 */
function sectionsIn(level: LearnLevelId): readonly LearnSection[] {
  const sections: LearnSection[] = [];
  for (const chapter of LEARN_CHAPTERS_BY_LEVEL[level]) {
    const current = sections[sections.length - 1];
    if (current && current.part === chapter.part) {
      sections[sections.length - 1] = {
        part: current.part,
        chapters: [...current.chapters, chapter],
      };
    } else {
      sections.push({ part: chapter.part, chapters: [chapter] });
    }
  }
  return sections;
}

export const LEARN_SECTIONS_BY_LEVEL: Record<LearnLevelId, readonly LearnSection[]> = {
  beginner: sectionsIn('beginner'),
  intermediate: sectionsIn('intermediate'),
  advanced: sectionsIn('advanced'),
};

export function findLearnChapter(id: LearnChapterId): LearnChapterMeta | undefined {
  return LEARN_CHAPTERS.find((chapter) => chapter.id === id);
}

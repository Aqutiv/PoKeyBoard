import { describe, expect, it } from 'vitest';
import { MEET_THE_KEYBOARD } from '@/features/learn/chapters/meetTheKeyboard';
import {
  findLearnChapter,
  LEARN_CHAPTERS,
  LEARN_CHAPTERS_BY_LEVEL,
  LEARN_SECTIONS_BY_LEVEL,
} from '@/features/learn/chapters';
import { HALF_STEPS_WHOLE_STEPS } from '@/features/learn/chapters/halfStepsWholeSteps';
import { MUSICAL_ALPHABET } from '@/features/learn/chapters/musicalAlphabet';
import { TREBLE_STAFF } from '@/features/learn/chapters/trebleStaff';
import { BASS_AND_GRAND_STAFF } from '@/features/learn/chapters/bassAndGrandStaff';
import { RHYTHM_AND_BEAT } from '@/features/learn/chapters/rhythmAndBeat';
import { FIRST_MELODY } from '@/features/learn/chapters/firstMelody';
import { C_MAJOR_SCALE } from '@/features/learn/chapters/cMajorScale';
import { TRIADS } from '@/features/learn/chapters/triads';
import { CHORDS_PEDAL_AND_HANDS } from '@/features/learn/chapters/chordsPedalAndHands';
import { HOW_TO_PRACTISE, THEME_TRACK_BEAT } from '@/features/learn/chapters/howToPractise';
import type { LearnPhrase, LearnStep } from '@/features/learn/types';
import { buildLibraryTake } from '@/features/library/trackBuilder';
import { A_BEAUTIFUL_DAY } from '@/features/library/tracks/aBeautifulDay';
import { PLAYBACK_SPEEDS } from '@/features/transport/modes';
import { noteHand } from '@/domain/hands';
import { createTakeTempoMap } from '@/domain/tempoMap';
import { barDurationMs } from '@/utils/timing';
import { MAJOR_SCALE_STEPS } from '@/features/learn/drill';
import { momentsOf } from '@/features/learn/phrase';
import type { LearnChapter } from '@/features/learn/types';
import { LIBRARY_TRACKS } from '@/features/library/catalog';
import { ODE_TO_JOY_EVENTS } from '@/features/library/tracks/odeToJoyFirstSteps';
import { drillRoundAt } from '@/features/learn/drill';
import { phraseToNotes } from '@/features/learn/phrase';
import { layoutScore } from '@/features/notation/notationLayout';
import { midiToStaffPosition, TREBLE_SPLIT_MIDI } from '@/features/notation/staffMapping';
import {
  MIN_FITTED_WHITE_KEY_PX,
  MIN_VISIBLE_WHITES,
  stepWhites,
  whiteKeyCount,
} from '@/features/keyboard/keyboardGeometry';
import { loadChapterProse } from '@/features/learn/content';
import {
  DEFAULT_RHYTHM_TOLERANCE_BEATS,
  goalTotal,
  pitchClassOf,
  triadMidis,
  type NamedChord,
} from '@/features/learn/exerciseSpec';
import { roundEntryAt } from '@/features/learn/rounds';
import { isBlackKey } from '@/utils/midi';
import { LEARN_LEVEL_IDS } from '@/features/learn/levels';
import { catalogs } from '@/i18n';
import { SUPPORTED_LANGUAGES } from '@/i18n/types';

describe('learn catalog', () => {
  it('ships thirty chapters, ten per level', () => {
    expect(LEARN_CHAPTERS).toHaveLength(30);
    for (const level of LEARN_LEVEL_IDS) {
      expect(LEARN_CHAPTERS_BY_LEVEL[level], level).toHaveLength(10);
    }
  });

  it('numbers each level contiguously from one', () => {
    for (const level of LEARN_LEVEL_IDS) {
      const orders = LEARN_CHAPTERS_BY_LEVEL[level].map((chapter) => chapter.order);
      expect(orders).toEqual(orders.map((_, index) => index + 1));
    }
  });

  it('uses a unique id per chapter', () => {
    const ids = LEARN_CHAPTERS.map((chapter) => chapter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('titles and blurbs every chapter in every locale', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const { chapterTitles, chapterBlurbs } = catalogs[language].learn;
      for (const chapter of LEARN_CHAPTERS) {
        expect(chapterTitles[chapter.id], `${language}/${chapter.id} title`).toBeTruthy();
        expect(chapterBlurbs[chapter.id], `${language}/${chapter.id} blurb`).toBeTruthy();
      }
    }
  });

  it('marks only the authored chapters as playable', () => {
    const playable = LEARN_CHAPTERS.filter((chapter) => chapter.load !== null);
    // A deliberate ledger of what has shipped: updating it should be a
    // conscious line in the commit that ships a chapter.
    expect(playable.map((chapter) => chapter.id)).toEqual([
      'meetTheKeyboard',
      'musicalAlphabet',
      'halfStepsWholeSteps',
      'trebleStaff',
      'bassAndGrandStaff',
      'rhythmAndBeat',
      'firstMelody',
      'cMajorScale',
      'triads',
      'chordsPedalAndHands',
      'howToPractise',
    ]);
  });

  it('finds a chapter by id', () => {
    expect(findLearnChapter('meetTheKeyboard')?.order).toBe(1);
    expect(findLearnChapter('keySignatures')?.level).toBe('intermediate');
    expect(findLearnChapter('improvising')?.level).toBe('advanced');
  });
});

describe('every authored chapter', () => {
  const AUTHORED = [
    MEET_THE_KEYBOARD,
    MUSICAL_ALPHABET,
    HALF_STEPS_WHOLE_STEPS,
    TREBLE_STAFF,
    BASS_AND_GRAND_STAFF,
    RHYTHM_AND_BEAT,
    FIRST_MELODY,
    C_MAJOR_SCALE,
    TRIADS,
    CHORDS_PEDAL_AND_HANDS,
    HOW_TO_PRACTISE,
  ];

  it('keeps the two tints of a diagram apart', () => {
    // `KeyboardDiagram` checks the first tint first, so a key in both sets
    // shows the first colour and the second is silently never seen.
    for (const chapter of AUTHORED) {
      for (const step of chapter.steps) {
        if (step.visual?.kind !== 'keyboard') continue;
        const first = new Set(step.visual.highlight ?? []);
        const overlap = (step.visual.highlightSecondary ?? []).filter((midi) => first.has(midi));
        expect(overlap, `${chapter.id}/${step.id}`).toEqual([]);
      }
    }
  });
});

describe('learn parts', () => {
  it('splits every level into three parts', () => {
    for (const level of LEARN_LEVEL_IDS) {
      expect(LEARN_SECTIONS_BY_LEVEL[level], level).toHaveLength(3);
    }
  });

  it('covers every chapter exactly once, in order', () => {
    for (const level of LEARN_LEVEL_IDS) {
      const flattened = LEARN_SECTIONS_BY_LEVEL[level].flatMap((section) => section.chapters);
      expect(flattened).toEqual(LEARN_CHAPTERS_BY_LEVEL[level]);
    }
  });

  it('keeps each part a single consecutive run', () => {
    // Sections are built by walking the ordered chapters, so a part split in
    // two would surface here as a repeated heading rather than silently
    // reordering the course.
    for (const level of LEARN_LEVEL_IDS) {
      const parts = LEARN_SECTIONS_BY_LEVEL[level].map((section) => section.part);
      expect(new Set(parts).size, level).toBe(parts.length);
    }
  });

  it('names every part in every locale', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const { partTitles } = catalogs[language].learn;
      for (const chapter of LEARN_CHAPTERS) {
        expect(partTitles[chapter.part], `${language}/${chapter.part}`).toBeTruthy();
      }
    }
  });
});

describe('chapter one', () => {
  it('alternates theory and exercises across eleven steps', () => {
    expect(MEET_THE_KEYBOARD.steps).toHaveLength(11);
    expect(MEET_THE_KEYBOARD.steps.filter((step) => step.kind === 'exercise')).toHaveLength(6);
  });

  it('gives every step a unique id', () => {
    const ids = MEET_THE_KEYBOARD.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of MEET_THE_KEYBOARD.steps) {
      if (step.kind !== 'exercise') continue;
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('lets a mouse finish every simultaneity exercise', () => {
    // A mouse is one pointer and cannot hold two keys, so anything asking for
    // notes at once must also accept a fast roll.
    for (const step of MEET_THE_KEYBOARD.steps) {
      if (step.kind !== 'exercise') continue;
      const { spec } = step;
      if (spec.kind !== 'interval' && spec.kind !== 'blackKeyGroup' && spec.kind !== 'exactKeys') {
        continue;
      }
      expect(spec.together?.onsetWindowMs, step.id).toBeGreaterThan(0);
    }
  });

  it('writes English prose with a prompt for every exercise', async () => {
    const prose = await loadChapterProse('meetTheKeyboard', 'en');
    for (const step of MEET_THE_KEYBOARD.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });

  it('falls back to English for a locale with no translation yet', async () => {
    const french = await loadChapterProse('meetTheKeyboard', 'fr');
    const english = await loadChapterProse('meetTheKeyboard', 'en');
    expect(Object.keys(french)).toEqual(Object.keys(english));
  });

  it('has no prose for an unauthored chapter', async () => {
    expect(await loadChapterProse('improvising', 'en')).toEqual({});
  });
});

describe('chapter two', () => {
  it('mixes theory, exercises and one recognition step', () => {
    const kinds = MUSICAL_ALPHABET.steps.map((step) => step.kind);
    expect(kinds).toHaveLength(10);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(1);
  });

  it('gives every step a unique id', () => {
    const ids = MUSICAL_ALPHABET.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of MUSICAL_ALPHABET.steps) {
      if (step.kind !== 'exercise') continue;
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('asks its scale walks in the right direction', () => {
    const specs = MUSICAL_ALPHABET.steps
      .filter((step) => step.kind === 'exercise')
      .map((step) => step.spec);
    const sequences = specs.filter((spec) => spec.kind === 'sequence');
    expect(sequences).toHaveLength(3);
    expect(sequences[0]).toMatchObject({ direction: 'up' });
    // Walking down starts on the upper C, so the line fits the window a phone
    // shows without the user having to shift the keyboard mid-scale.
    expect(sequences[2]).toMatchObject({ direction: 'down' });
  });

  it('never asks the quiz for more rounds than its pool can name', () => {
    for (const step of MUSICAL_ALPHABET.steps) {
      if (step.kind !== 'quiz') continue;
      expect(step.rounds).toBeGreaterThan(0);
      if (step.question.kind === 'chordQuality') throw new Error('expected a note quiz');
      expect(step.question.pitchClasses.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('writes English prose with a prompt for every exercise', async () => {
    const prose = await loadChapterProse('musicalAlphabet', 'en');
    for (const step of MUSICAL_ALPHABET.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });
});

describe('chapter three', () => {
  it('runs theory, exercises, a quiz and a drill', () => {
    const kinds = HALF_STEPS_WHOLE_STEPS.steps.map((step) => step.kind);
    expect(kinds).toHaveLength(11);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'drill')).toHaveLength(1);
  });

  it('gives every step a unique id', () => {
    const ids = HALF_STEPS_WHOLE_STEPS.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of HALF_STEPS_WHOLE_STEPS.steps) {
      if (step.kind !== 'exercise') continue;
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('leaves the step intervals free of a simultaneity rule', () => {
    // Chapter 1 needs `together` because it asks for notes held at once. These
    // must NOT have it: an interval with no togetherness reads the cumulative
    // candidate set, which is what makes it "any two keys a semitone apart"
    // rather than one pinned pair, and what lets a one-pointer mouse play it.
    const intervals = HALF_STEPS_WHOLE_STEPS.steps
      .filter((step) => step.kind === 'exercise')
      .map((step) => step.spec)
      .filter((spec) => spec.kind === 'interval');
    expect(intervals).toHaveLength(2);
    for (const spec of intervals) expect(spec.together).toBeUndefined();
    expect(intervals.map((spec) => spec.semitones)).toEqual([1, 2]);
  });

  it('anchors the touching-pairs line where a small phone can reach all of it', () => {
    // E4–D5 is the seven white keys a 320px screen shows; anchored at middle C
    // the closing C5 would sit off the edge.
    const step = HALF_STEPS_WHOLE_STEPS.steps.find((s) => s.id === 'playTouchingPairs');
    expect(step?.anchorMidi).toBe(64);
    expect(stepWhites(64, 7, 1)).toBeGreaterThanOrEqual(72);
  });

  it('drills the same five black keys the quiz names, in the other spelling', () => {
    const quiz = HALF_STEPS_WHOLE_STEPS.steps.find((s) => s.kind === 'quiz');
    const drill = HALF_STEPS_WHOLE_STEPS.steps.find((s) => s.kind === 'drill');
    if (quiz?.question.kind !== 'nameTheKey') throw new Error('expected a naming quiz');
    expect(quiz.question.pitchClasses).toEqual([1, 3, 6, 8, 10]);
    if (drill?.drill.kind !== 'namedKey') throw new Error('expected a named-key drill');
    expect(drill.drill.pitchClasses).toEqual([1, 3, 6, 8, 10]);
    if (quiz?.question.kind === 'nameTheKey') expect(quiz.question.spelling).toBe('sharp');
    if (drill?.drill.kind === 'namedKey') expect(drill.drill.spelling).toBe('flat');
    expect(drill?.rounds).toBeGreaterThan(0);
  });

  it('gives the drill no Listen phrase', () => {
    // "Show me" fires the step's `listen`, which would be one fixed phrase
    // against a target that changes every round.
    const drill = HALF_STEPS_WHOLE_STEPS.steps.find((s) => s.kind === 'drill');
    expect(drill?.listen).toBeUndefined();
  });

  it('writes English prose, with a prompt for every exercise (ch3)', async () => {
    const prose = await loadChapterProse('halfStepsWholeSteps', 'en');
    for (const step of HALF_STEPS_WHOLE_STEPS.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      // A drill's prompt is generated from its round, not written per chapter.
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });
});

describe('chapter four', () => {
  it('reads with a quiz and a drill either side of the exercises', () => {
    const kinds = TREBLE_STAFF.steps.map((step) => step.kind);
    expect(kinds).toHaveLength(11);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'drill')).toHaveLength(1);
  });

  it('gives every step a unique id', () => {
    const ids = TREBLE_STAFF.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every note it draws on the treble staff', () => {
    // Below middle C, `midiToStaffPosition` silently moves a note to the bass
    // staff — a staff this chapter has not introduced. One slip would put a
    // note somewhere the lesson never explains.
    for (const step of TREBLE_STAFF.steps) {
      if (step.visual?.kind !== 'staff') continue;
      for (const note of phraseToNotes(step.visual.phrase)) {
        expect(note.midi, `${step.id}: ${note.midi}`).toBeGreaterThanOrEqual(TREBLE_SPLIT_MIDI);
      }
    }
  });

  it('fills every bar, so no rest is engraved beside the note', () => {
    for (const step of TREBLE_STAFF.steps) {
      if (step.visual?.kind !== 'staff') continue;
      for (const note of phraseToNotes(step.visual.phrase)) {
        expect(note.durationMs, step.id).toBe(4000);
      }
    }
  });

  it('asks the quiz and the drill about the same five notes', () => {
    const quiz = TREBLE_STAFF.steps.find((s) => s.kind === 'quiz');
    const drill = TREBLE_STAFF.steps.find((s) => s.kind === 'drill');
    if (quiz?.question.kind !== 'readNote') throw new Error('expected a reading quiz');
    if (drill?.drill.kind !== 'readNote') throw new Error('expected a reading drill');
    expect(quiz.question.pitchClasses).toEqual([0, 2, 4, 5, 7]);
    expect(drill.drill.pitchClasses).toEqual([0, 2, 4, 5, 7]);
  });

  it('asks for the exact middle C the stave draws, not any C', () => {
    // The step right after "middle C hangs below on its ledger line". A
    // pitch class would take C3 or C5 and call it read, with the drawn head
    // still dark — the same reason the reading drill below grades exactly.
    const step = TREBLE_STAFF.steps.find((s) => s.id === 'playMiddleC');
    if (step?.kind !== 'exercise') throw new Error('expected an exercise');
    expect(step.spec).toEqual({ kind: 'exactKeys', midis: [60] });
    expect(step.anchorMidi).toBe(60);
  });

  it('gives a reading round no spoken label, since the staff is the question', () => {
    const drill = TREBLE_STAFF.steps.find((s) => s.kind === 'drill');
    if (drill?.drill.kind !== 'readNote') throw new Error('expected a reading drill');
    for (let round = 0; round < 5; round += 1) {
      const asked = drillRoundAt(drill.drill, round);
      expect(asked?.label).toBe('');
      expect(asked?.phrase).toBeDefined();
    }
  });

  it('grades a reading round on the exact note drawn, not its pitch class', () => {
    // The drawing is octave-pinned and the chapter is about which line a note
    // sits on, so the octave above is a different answer, not a near-miss.
    const drill = TREBLE_STAFF.steps.find((s) => s.kind === 'drill');
    if (drill?.drill.kind !== 'readNote') throw new Error('expected a reading drill');
    for (let round = 0; round < 5; round += 1) {
      const spec = drillRoundAt(drill.drill, round)?.spec;
      expect(spec?.kind).toBe('exactKeys');
      if (spec?.kind !== 'exactKeys') continue;
      expect(spec.midis).toHaveLength(1);
      expect(spec.midis[0]).toBeGreaterThanOrEqual(TREBLE_SPLIT_MIDI);
    }
  });

  it('numbers the fingers rather than naming the keys', () => {
    const step = TREBLE_STAFF.steps.find((s) => s.id === 'fingerNumbers');
    if (step?.visual?.kind !== 'keyboard') throw new Error('expected a keyboard diagram');
    expect(step.visual.labelText).toEqual({ 60: '1', 62: '2', 64: '3', 65: '4', 67: '5' });
  });

  it('writes English prose, with a prompt for every exercise', async () => {
    const prose = await loadChapterProse('trebleStaff', 'en');
    for (const step of TREBLE_STAFF.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });
});

describe('chapter five', () => {
  it('mirrors chapter four, then joins the staves', () => {
    const kinds = BASS_AND_GRAND_STAFF.steps.map((step) => step.kind);
    expect(kinds).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'drill')).toHaveLength(1);
  });

  it('gives every step a unique id', () => {
    const ids = BASS_AND_GRAND_STAFF.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of BASS_AND_GRAND_STAFF.steps) {
      if (step.kind !== 'exercise') continue;
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('draws every note on a staff its snippet actually shows', () => {
    // Chapter four's treble-only check, grown up. A single-staff view collapses
    // `bassTop` onto `trebleTop`, so a note whose resolved staff disagrees with
    // the view is not dropped — it lands on the staff that is drawn, measured
    // from the other clef's reference line. Wrong line, no error.
    for (const step of BASS_AND_GRAND_STAFF.steps) {
      if (step.visual?.kind !== 'staff') continue;
      const staves = step.visual.staves ?? 'treble';
      for (const note of phraseToNotes(step.visual.phrase)) {
        const resolved = midiToStaffPosition(note.midi, note.staff).staff;
        if (staves === 'grand') expect(['treble', 'bass']).toContain(resolved);
        else expect(resolved, `${step.id}: ${note.midi}`).toBe(staves);
      }
    }
  });

  it('names the staff on every note it writes', () => {
    // Never left to `midiToStaffPosition`'s split at middle C: this is the one
    // chapter whose subject is that the split is a choice.
    for (const step of BASS_AND_GRAND_STAFF.steps) {
      if (step.visual?.kind !== 'staff') continue;
      for (const note of phraseToNotes(step.visual.phrase)) {
        expect(note.staff, `${step.id}: ${note.midi}`).toBeDefined();
      }
    }
  });

  it('sounds both staves in every bar of a grand snippet, so neither is left blank', () => {
    // What keeps `StaffSnippet` blanking rests honest: an empty staff with no
    // rest on it reads as an engraving slip rather than a silence, and rests
    // are chapter six.
    for (const step of BASS_AND_GRAND_STAFF.steps) {
      if (step.visual?.kind !== 'staff' || step.visual.staves !== 'grand') continue;
      const byStart = new Map<number, Set<string>>();
      for (const note of phraseToNotes(step.visual.phrase)) {
        const at = byStart.get(note.startMs) ?? new Set<string>();
        at.add(midiToStaffPosition(note.midi, note.staff).staff);
        byStart.set(note.startMs, at);
      }
      expect(byStart.size, step.id).toBeGreaterThan(0);
      for (const [startMs, staves] of byStart) {
        expect([...staves].sort(), `${step.id}@${startMs}`).toEqual(['bass', 'treble']);
      }
    }
  });

  it('fills every bar, so no rest is engraved beside the note', () => {
    for (const step of BASS_AND_GRAND_STAFF.steps) {
      if (step.visual?.kind !== 'staff') continue;
      for (const note of phraseToNotes(step.visual.phrase)) {
        expect(note.durationMs, step.id).toBe(4000);
      }
    }
  });

  it('writes middle C above the bass staff, not below the treble one', () => {
    // The hinge of the chapter, and the one note a split at middle C gets
    // wrong: C4 is exactly TREBLE_SPLIT_MIDI.
    const step = BASS_AND_GRAND_STAFF.steps.find((s) => s.id === 'middleCAbove');
    if (step?.visual?.kind !== 'staff') throw new Error('expected a stave');
    expect(step.visual.staves).toBe('bass');
    const notes = phraseToNotes(step.visual.phrase);
    expect(notes[0]?.midi).toBe(TREBLE_SPLIT_MIDI);
    expect(midiToStaffPosition(notes[0]!.midi, notes[0]!.staff).staff).toBe('bass');
    // Step 0 is the bottom line and 8 the top one, so 10 is the first ledger
    // line above the staff — the mirror of the ledger line chapter four hung
    // the same note below the treble staff on.
    expect(midiToStaffPosition(notes[0]!.midi, notes[0]!.staff).step).toBe(10);
  });

  it('asks the quiz and the drill about the same five bass notes', () => {
    const quiz = BASS_AND_GRAND_STAFF.steps.find((s) => s.kind === 'quiz');
    const drill = BASS_AND_GRAND_STAFF.steps.find((s) => s.kind === 'drill');
    if (quiz?.question.kind !== 'readNote') throw new Error('expected a reading quiz');
    if (drill?.drill.kind !== 'readNote') throw new Error('expected a reading drill');
    expect(quiz.question.pitchClasses).toEqual([0, 2, 4, 5, 7]);
    expect(drill.drill.pitchClasses).toEqual([0, 2, 4, 5, 7]);
    expect(quiz.question.baseMidi).toBe(48);
    expect(drill.drill.baseMidi).toBe(48);
    expect(quiz.question.staff).toBe('bass');
    expect(drill.drill.staff).toBe('bass');
  });

  it('draws each reading round on the bass staff, at the note it grades', () => {
    const drill = BASS_AND_GRAND_STAFF.steps.find((s) => s.kind === 'drill');
    if (drill?.drill.kind !== 'readNote') throw new Error('expected a reading drill');
    for (let round = 0; round < 5; round += 1) {
      const asked = drillRoundAt(drill.drill, round);
      expect(asked?.label).toBe('');
      expect(asked?.staves).toBe('bass');
      const spec = asked?.spec;
      if (spec?.kind !== 'exactKeys') throw new Error('expected exactKeys');
      expect(spec.midis).toHaveLength(1);
      expect(spec.midis[0]).toBeLessThan(TREBLE_SPLIT_MIDI);
      // The picture and the answer are the same note, on the staff drawn.
      const notes = phraseToNotes(asked!.phrase!);
      expect(notes[0]?.midi).toBe(spec.midis[0]);
      expect(midiToStaffPosition(notes[0]!.midi, notes[0]!.staff).staff).toBe('bass');
    }
  });

  it('gives the drill no Listen phrase', () => {
    const drill = BASS_AND_GRAND_STAFF.steps.find((s) => s.kind === 'drill');
    expect(drill?.listen).toBeUndefined();
  });

  it('numbers the left hand down from the little finger', () => {
    const step = BASS_AND_GRAND_STAFF.steps.find((s) => s.id === 'leftHandFingers');
    if (step?.visual?.kind !== 'keyboard') throw new Error('expected a keyboard diagram');
    expect(step.visual.labelText).toEqual({ 48: '5', 50: '4', 52: '3', 53: '2', 55: '1' });
  });

  it('lets a one-pointer mouse finish the hands-together step', () => {
    const step = BASS_AND_GRAND_STAFF.steps.find((s) => s.id === 'handsTogether');
    if (step?.kind !== 'exercise') throw new Error('expected an exercise');
    expect(step.spec).toEqual({
      kind: 'exactKeys',
      midis: [53, 60],
      together: { overlap: true, onsetWindowMs: 400 },
    });
  });

  it('parks every playing step where its notes fit the narrowest phone', () => {
    // `anchorMidi` is the LOW edge, not a centre, and MIN_VISIBLE_WHITES is 7.
    // The default of 60 would leave every bass note off the key bed, and an
    // anchor whose targets outrun seven white keys would strand one off screen
    // with nothing to say so — `needsRangeShift` only fires when *no* target
    // is in range, so one reachable note silences it for the other.
    for (const step of BASS_AND_GRAND_STAFF.steps) {
      if (step.kind !== 'exercise' && step.kind !== 'drill') continue;
      const anchor = step.anchorMidi;
      expect(anchor, step.id).toBeDefined();
      const high = stepWhites(anchor!, MIN_VISIBLE_WHITES, 1);
      const spec = step.kind === 'exercise' ? step.spec : drillRoundAt(step.drill, 0)?.spec;
      if (spec?.kind !== 'exactKeys') continue;
      for (const midi of spec.midis) {
        expect(midi, `${step.id}: ${midi}`).toBeGreaterThanOrEqual(anchor!);
        expect(midi, `${step.id}: ${midi}`).toBeLessThanOrEqual(high);
      }
    }
  });

  it('writes English prose, with a prompt for every exercise (ch5)', async () => {
    const prose = await loadChapterProse('bassAndGrandStaff', 'en');
    for (const step of BASS_AND_GRAND_STAFF.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });
});

describe('chapter six', () => {
  /** The tempo the chapter is written at and the runner clicks at. */
  const BEAT_MS = 1000;
  const BAR_BEATS = 4;

  const rhythmSteps = RHYTHM_AND_BEAT.steps.filter((step) => step.kind === 'exercise');

  it('teaches through production, with no quiz or drill', () => {
    const kinds = RHYTHM_AND_BEAT.steps.map((step) => step.kind);
    expect(kinds).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(4);
    // On a rhythm card the answer is already printed on the staff, so there is
    // nothing a recognition round could ask that the picture does not say.
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(0);
    expect(kinds.filter((kind) => kind === 'drill')).toHaveLength(0);
  });

  it('gives every step a unique id', () => {
    const ids = RHYTHM_AND_BEAT.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of rhythmSteps) {
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('grades only rhythm, and always against a bar of four', () => {
    for (const step of rhythmSteps) {
      expect(step.spec.kind, step.id).toBe('rhythm');
      if (step.spec.kind !== 'rhythm') continue;
      // The bar arithmetic is exact only because this matches the click grid's
      // numerator — the grid's beat 0 is a downbeat by construction.
      expect(step.spec.barBeats, step.id).toBe(BAR_BEATS);
      expect(step.spec.beats[0], step.id).toBe(0);
      for (let i = 1; i < step.spec.beats.length; i += 1) {
        expect(step.spec.beats[i], `${step.id}[${i}]`).toBeGreaterThan(
          step.spec.beats[i - 1] as number,
        );
      }
    }
  });

  it('writes exactly the rhythm it grades', () => {
    // The failure mode of a rhythm chapter, and invisible to every other test:
    // a picture that disagrees with the gate teaches one thing and marks
    // another.
    for (const step of rhythmSteps) {
      if (step.spec.kind !== 'rhythm') continue;
      if (step.visual?.kind !== 'staff') continue;
      const onsets = phraseToNotes(step.visual.phrase).map((note) => note.startMs / BEAT_MS);
      expect(onsets, step.id).toEqual([...step.spec.beats]);
    }
  });

  it('leaves room between targets for the tolerance window', () => {
    // Two windows that overlap would make one press credit either of two
    // targets. Holds exactly at eighth notes; this is the guard against
    // somebody later authoring sixteenths at the same tolerance.
    for (const step of rhythmSteps) {
      if (step.spec.kind !== 'rhythm') continue;
      const tolerance = step.spec.toleranceBeats ?? DEFAULT_RHYTHM_TOLERANCE_BEATS;
      for (let i = 1; i < step.spec.beats.length; i += 1) {
        const gap = (step.spec.beats[i] as number) - (step.spec.beats[i - 1] as number);
        expect(gap, `${step.id}[${i}]`).toBeGreaterThanOrEqual(2 * tolerance);
      }
    }
  });

  it('runs the click through every step that needs one', () => {
    // A rhythm spec brings its own click, so only the steps that want it
    // *early* have to say so. The pulse has to be heard before it is graded.
    const first = RHYTHM_AND_BEAT.steps[0];
    expect(first?.click, 'the chapter opens on the pulse').toBe(true);
    for (const step of RHYTHM_AND_BEAT.steps) {
      if (step.kind !== 'exercise') continue;
      expect(step.spec.kind, step.id).toBe('rhythm');
    }
  });

  it('sounds a note on the final beat of every Listen phrase', () => {
    // `phraseDurationMs` is max(start + duration), so a phrase that ends in a
    // rest re-enables the Listen button early and a second press overlaps the
    // tail still ringing.
    for (const step of RHYTHM_AND_BEAT.steps) {
      if (!step.listen) continue;
      const notes = phraseToNotes(step.listen);
      const end = Math.max(...notes.map((note) => note.startMs + note.durationMs));
      expect(end % (BAR_BEATS * BEAT_MS), step.id).toBe(0);
    }
  });

  it('keeps every note on the treble staff', () => {
    // `deriveRests` fills BOTH staves, so a grand-staff phrase here would
    // sprout a bar of bass whole rests the moment rests are drawn.
    for (const step of RHYTHM_AND_BEAT.steps) {
      if (step.visual?.kind !== 'staff') continue;
      expect(step.visual.staves, step.id).toBe('treble');
      for (const note of phraseToNotes(step.visual.phrase)) {
        expect(midiToStaffPosition(note.midi, note.staff).staff, step.id).toBe('treble');
      }
    }
  });

  it('never carries a note across a bar line', () => {
    // A tie would be the one thing in the chapter `drawTies` has to filter by
    // staff for, and it is not what a first rhythm lesson should introduce.
    for (const step of RHYTHM_AND_BEAT.steps) {
      if (step.visual?.kind !== 'staff') continue;
      const barMs = BAR_BEATS * BEAT_MS;
      for (const note of phraseToNotes(step.visual.phrase)) {
        const startBar = Math.floor(note.startMs / barMs);
        const endBar = Math.ceil((note.startMs + note.durationMs) / barMs) - 1;
        expect(endBar, `${step.id}: ${note.startMs}`).toBe(startBar);
      }
    }
  });

  it('shows the time signature, and shows rests only where they are the point', () => {
    const withRests = RHYTHM_AND_BEAT.steps.filter(
      (step) => step.visual?.kind === 'staff' && step.visual.rests === true,
    );
    expect(withRests.map((step) => step.id)).toEqual(['theRest', 'playWithARest']);
    for (const step of RHYTHM_AND_BEAT.steps) {
      if (step.visual?.kind !== 'staff') continue;
      expect(step.visual.chrome, step.id).toBe('lesson');
    }
  });

  it('parks every playing step where its note fits the narrowest phone', () => {
    for (const step of rhythmSteps) {
      const anchor = step.anchorMidi;
      expect(anchor, step.id).toBeDefined();
      if (step.spec.kind !== 'rhythm' || step.spec.midi === undefined) continue;
      expect(step.spec.midi, step.id).toBeGreaterThanOrEqual(anchor as number);
      expect(step.spec.midi, step.id).toBeLessThanOrEqual(
        stepWhites(anchor as number, MIN_VISIBLE_WHITES, 1),
      );
    }
  });

  it('beams its eighth notes per beat, as the prose describes them', () => {
    // A lesson stave groups eighths by the beat (StaffSnippet turns off the
    // half-bar grouping printed music uses), so a bar of eight eighths engraves
    // as four clean pairs rather than one long smear. The prose says exactly
    // that, and this is what stops the two drifting apart.
    const step = RHYTHM_AND_BEAT.steps.find((s) => s.id === 'quarterAndEighth');
    if (step?.visual?.kind !== 'staff') throw new Error('expected a stave');
    const score = layoutScore(phraseToNotes(step.visual.phrase), {
      bpm: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      quantization: '1/16',
      minMeasures: 1,
      eighthsByHalfBar: false,
    });
    expect(score.beams).toHaveLength(4);
    expect(score.beams.map((beam) => beam.members.length)).toEqual([2, 2, 2, 2]);
  });

  it('writes English prose, with a prompt for every exercise (ch6)', async () => {
    const prose = await loadChapterProse('rhythmAndBeat', 'en');
    for (const step of RHYTHM_AND_BEAT.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });
});

/**
 * The rules every chapter from seven on is held to, whatever it teaches. Each
 * one guards a silent failure somewhere else: a picture that disagrees with
 * its gate, a note no phone or computer keyboard can reach, a Listen button
 * that frees up while the tail still rings.
 */
/** How long one bar of this phrase lasts, at its own tempo. */
const barMsOf = (phrase: LearnPhrase): number => barDurationMs(phrase.bpm, phrase.timeSignature);

/** Whether the lesson click runs through this step. See `ChapterRunner`. */
function clicks(step: LearnStep): boolean {
  if (step.click === true) return true;
  if (step.kind !== 'exercise') return false;
  return step.spec.kind === 'rhythm' || (step.spec.kind === 'playAlong' && !!step.spec.timed);
}

function sharedChapterChecks(chapter: LearnChapter): void {
  /** Every lesson clicks in 4/4 — at 60bpm unless its step says otherwise. */
  const DEFAULT_TEMPO = 60;
  const BAR_BEATS = 4;
  /** The C-snapped computer-keyboard base reaches this far up. */
  const COMPUTER_KEYBOARD_SPAN = 17;
  /** The key bed of a 320px phone, the narrowest screen the course designs for. */
  const NARROWEST_KEY_BED_PX = 288;

  it('gives every step a unique id', () => {
    const ids = chapter.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of chapter.steps) {
      if (step.kind !== 'exercise') continue;
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('draws exactly the line it grades', () => {
    // Identity, not equality: one object is what makes the drawing, the gate
    // and the lit heads agree by construction.
    for (const step of chapter.steps) {
      if (step.kind !== 'exercise' || step.spec.kind !== 'playAlong') continue;
      expect(step.visual?.kind, step.id).toBe('staff');
      if (step.visual?.kind !== 'staff') continue;
      expect(step.visual.phrase, step.id).toBe(step.spec.phrase);
    }
  });

  it('clicks every timed line at its step’s tempo, with room between its moments', () => {
    for (const step of chapter.steps) {
      if (step.kind !== 'exercise' || step.spec.kind !== 'playAlong' || !step.spec.timed) continue;
      const { phrase, timed } = step.spec;
      // The grid is built at the step's tempo; a line written at another would
      // be graded against beats that fall somewhere its notes do not.
      expect(phrase.bpm, step.id).toBe(step.tempo ?? DEFAULT_TEMPO);
      expect(phrase.timeSignature, step.id).toEqual({ numerator: BAR_BEATS, denominator: 4 });
      const tolerance = timed.toleranceBeats ?? DEFAULT_RHYTHM_TOLERANCE_BEATS;
      const moments = momentsOf(phrase);
      expect(moments[0]?.beat, `${step.id} starts on a bar line`).toBe(0);
      for (let i = 1; i < moments.length; i += 1) {
        const gap = (moments[i]?.beat ?? 0) - (moments[i - 1]?.beat ?? 0);
        expect(gap, `${step.id}[${i}]`).toBeGreaterThanOrEqual(2 * tolerance);
      }
      for (const checkpoint of step.spec.checkpoints ?? [0]) {
        expect((moments[checkpoint]?.beat ?? -1) % BAR_BEATS, `${step.id}@${checkpoint}`).toBe(0);
      }
    }
  });

  it('sounds a note on the final beat of every Listen phrase', () => {
    for (const step of chapter.steps) {
      if (!step.listen) continue;
      const notes = phraseToNotes(step.listen);
      const end = Math.max(...notes.map((note) => note.startMs + note.durationMs));
      expect(end % barMsOf(step.listen), step.id).toBe(0);
    }
  });

  it('writes a clicking step’s Listen phrase at the tempo it clicks at', () => {
    // A demo starts on the running click's next bar line: at another tempo it
    // would drift against the very beat it is demonstrating.
    for (const step of chapter.steps) {
      if (!step.listen || !clicks(step)) continue;
      expect(step.listen.bpm, step.id).toBe(step.tempo ?? DEFAULT_TEMPO);
    }
  });

  it('states a tempo only on a step with a click to set it for', () => {
    for (const step of chapter.steps) {
      if (step.tempo === undefined) continue;
      expect(clicks(step), step.id).toBe(true);
    }
  });

  it('parks every playing step where a phone and a computer keyboard both reach it', () => {
    for (const step of chapter.steps) {
      if (step.kind !== 'exercise' || step.spec.kind !== 'playAlong') continue;
      // Two hands' worth of keys: turned sideways, not squeezed. See `wide`.
      if (step.wide) continue;
      const anchor = step.anchorMidi;
      expect(anchor, step.id).toBeDefined();
      // A step that asks for a range gets that range, narrowed to fit;
      // otherwise the seven keys a small phone shows from the anchor.
      const high = step.fit ? step.fit.highMidi : stepWhites(anchor!, MIN_VISIBLE_WHITES, 1);
      const base = Math.floor(anchor! / 12) * 12;
      for (const moment of momentsOf(step.spec.phrase)) {
        for (const midi of moment.midis) {
          expect(midi, `${step.id}: ${midi}`).toBeGreaterThanOrEqual(anchor!);
          expect(midi, `${step.id}: ${midi}`).toBeLessThanOrEqual(high);
          expect(midi - base, `${step.id}: ${midi}`).toBeLessThanOrEqual(COMPUTER_KEYBOARD_SPAN);
        }
      }
    }
  });

  it('asks only for ranges the narrowest phone can show at the fitted key floor', () => {
    for (const step of chapter.steps) {
      if (!step.fit) continue;
      // The keyboard's low edge is the anchor, so a fit starting anywhere else
      // would show a different range from the one asked for.
      expect(step.fit.lowMidi, step.id).toBe(step.anchorMidi);
      if (step.wide) continue;
      const whites = whiteKeyCount(step.fit.lowMidi, step.fit.highMidi);
      expect(whites * MIN_FITTED_WHITE_KEY_PX, step.id).toBeLessThanOrEqual(NARROWEST_KEY_BED_PX);
    }
  });

  it('lets a one-pointer mouse finish everything played together', () => {
    // A mouse is one pointer: anything asking for keys at once must also take
    // a quick roll, or a desktop user without a MIDI keyboard is stuck.
    const MOUSE_FRIENDLY = { overlap: true, onsetWindowMs: 400 };
    for (const step of chapter.steps) {
      if (step.kind === 'exercise' && 'together' in step.spec && step.spec.together) {
        expect(step.spec.together, step.id).toEqual(MOUSE_FRIENDLY);
      }
      if (step.kind === 'drill') {
        const spec = drillRoundAt(step.drill, 0)?.spec;
        if (spec && 'together' in spec && spec.together) {
          expect(spec.together, step.id).toEqual(MOUSE_FRIENDLY);
        }
      }
    }
  });

  it('keeps two-hand and pedal steps untimed, and inside their fit', () => {
    // A wide step is played one column at a time, like Play's Training; a
    // pedal change is judged by its order, not its beat.
    for (const step of chapter.steps) {
      if (step.kind !== 'exercise' || step.spec.kind !== 'playAlong') continue;
      if (!step.wide && !step.spec.pedal) continue;
      expect(step.spec.timed, step.id).toBeUndefined();
      if (!step.wide) continue;
      expect(step.fit, step.id).toBeDefined();
      for (const moment of momentsOf(step.spec.phrase)) {
        for (const midi of moment.midis) {
          expect(midi, `${step.id}: ${midi}`).toBeGreaterThanOrEqual(step.fit!.lowMidi);
          expect(midi, `${step.id}: ${midi}`).toBeLessThanOrEqual(step.fit!.highMidi);
        }
      }
    }
  });

  it('draws every note on a staff its snippet shows', () => {
    for (const step of chapter.steps) {
      if (step.visual?.kind !== 'staff') continue;
      const staves = step.visual.staves ?? 'treble';
      for (const note of phraseToNotes(step.visual.phrase)) {
        const resolved = midiToStaffPosition(note.midi, note.staff).staff;
        if (staves === 'grand') expect(['treble', 'bass']).toContain(resolved);
        else expect(resolved, `${step.id}: ${note.midi}`).toBe(staves);
      }
    }
  });

  it('never carries a note across a bar line', () => {
    for (const step of chapter.steps) {
      if (step.visual?.kind !== 'staff') continue;
      const barMs = barMsOf(step.visual.phrase);
      for (const note of phraseToNotes(step.visual.phrase)) {
        const startBar = Math.floor(note.startMs / barMs);
        const endBar = Math.ceil((note.startMs + note.durationMs) / barMs) - 1;
        expect(endBar, `${step.id}: ${note.startMs}`).toBe(startBar);
      }
    }
  });

  it('writes English prose, with a prompt for every exercise', async () => {
    const prose = await loadChapterProse(chapter.id, 'en');
    for (const step of chapter.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });

  it('hands off only to a Library track that exists, set up as Play could be by hand', () => {
    const { handoff } = chapter;
    if (!handoff) return;
    const def = LIBRARY_TRACKS.find((track) => track.trackId === handoff.trackId);
    expect(def).toBeDefined();
    // One-hand Training decides a note's hand by its staff, and falls back on
    // the split at middle C — which puts any left-hand note above it in the
    // right hand. A track opened for one hand must say which hand plays what.
    if (def && (handoff.mode === 'training-left' || handoff.mode === 'training-right')) {
      const notes = buildLibraryTake(def).notes;
      for (const note of notes) {
        expect(note.staff, `${def.trackId} ${note.id}`).toBeDefined();
      }
      // Nor may the two hands strike one key at one moment: Training accepts
      // the player's note, then the accompaniment plays the same key again.
      const struck = new Map<string, string>();
      for (const note of notes) {
        const key = `${note.midi}@${note.startMs}`;
        const hand = noteHand(note);
        const other = struck.get(key);
        expect(other === undefined || other === hand, `${def.trackId} ${key}`).toBe(true);
        struck.set(key, hand);
      }
    }
    // One of the speed menu's own choices, so the menu shows it as chosen.
    if (handoff.speed !== undefined) {
      expect(PLAYBACK_SPEEDS as readonly number[]).toContain(handoff.speed);
    }
    if (handoff.loopBeats && def) {
      const [from, to] = handoff.loopBeats;
      const beatsPerBar = def.timeSignature.numerator;
      expect(from % beatsPerBar, 'loop starts on a bar line').toBe(0);
      expect(to % beatsPerBar, 'loop ends on a bar line').toBe(0);
      expect(to).toBeGreaterThan(from);
      const take = buildLibraryTake(def);
      const endMs = createTakeTempoMap(take.tempo).msAtBeat(to);
      expect(endMs, 'loop inside the track').toBeLessThanOrEqual(take.durationMs);
    }
  });
}

describe('chapter seven', () => {
  sharedChapterChecks(FIRST_MELODY);

  const exercises = FIRST_MELODY.steps.filter((step) => step.kind === 'exercise');

  it('plays the melody four ways, with no quiz or drill', () => {
    const kinds = FIRST_MELODY.steps.map((step) => step.kind);
    expect(kinds).toHaveLength(10);
    expect(exercises).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'quiz' || kind === 'drill')).toHaveLength(0);
    // Notes first with no clock, then everything in time.
    expect(exercises.map((step) => step.spec.kind === 'playAlong' && !!step.spec.timed)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it('opens on the click, a step before anything is timed', () => {
    expect(FIRST_MELODY.steps[0]?.click).toBe(true);
  });

  it('writes eight bars in the right-hand C position, in quarters and halves', () => {
    const last = exercises.at(-1);
    if (last?.spec.kind !== 'playAlong') throw new Error('expected a playAlong line');
    const notes = phraseToNotes(last.spec.phrase);
    const end = Math.max(...notes.map((note) => note.startMs + note.durationMs));
    expect(end).toBe(8 * 4000);
    for (const note of notes) {
      expect(note.midi).toBeGreaterThanOrEqual(60);
      expect(note.midi).toBeLessThanOrEqual(67);
      expect([1000, 2000]).toContain(note.durationMs);
    }
  });

  it('grades the two phrases apart, then the whole line without a checkpoint', () => {
    const lines = exercises.map((step) => (step.spec.kind === 'playAlong' ? step.spec : null));
    const [, question, answer, whole] = lines;
    expect(question && momentsOf(question.phrase)).toHaveLength(14);
    expect(answer && momentsOf(answer.phrase)).toHaveLength(14);
    expect(whole && momentsOf(whole.phrase)).toHaveLength(28);
    // The join between the phrases is the thing the last step tests.
    expect(whole?.checkpoints).toBeUndefined();
  });

  it('hands off to the same melody it teaches, in right-hand Training', () => {
    expect(FIRST_MELODY.handoff?.mode).toBe('training-right');
    const track = LIBRARY_TRACKS.find((def) => def.trackId === FIRST_MELODY.handoff?.trackId);
    expect(track?.events).toEqual([...ODE_TO_JOY_EVENTS]);
    // Right-hand Training waits only for right-hand notes, and the hands split
    // at middle C: every note has to be at or above it.
    for (const note of phraseToNotes({
      bpm: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      events: track?.events ?? [],
    })) {
      expect(note.midi).toBeGreaterThanOrEqual(TREBLE_SPLIT_MIDI);
    }
  });
});

describe('chapter eight', () => {
  sharedChapterChecks(C_MAJOR_SCALE);

  const step = (id: string) => C_MAJOR_SCALE.steps.find((s) => s.id === id);
  const lineOf = (id: string): readonly number[] => {
    const found = step(id);
    if (found?.kind !== 'exercise' || found.spec.kind !== 'playAlong') {
      throw new Error(`expected a playAlong line at ${id}`);
    }
    return momentsOf(found.spec.phrase).flatMap((moment) => moment.midis);
  };
  const stepsBetween = (midis: readonly number[]): number[] =>
    midis.slice(1).map((midi, i) => midi - (midis[i] as number));

  /** Whole, whole, half, whole, whole, whole, half. */
  const MAJOR_PATTERN = [2, 2, 1, 2, 2, 2, 1];

  it('plays the scale three ways and drills its degrees, with no quiz', () => {
    const kinds = C_MAJOR_SCALE.steps.map((s) => s.kind);
    expect(kinds).toHaveLength(11);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'drill')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(0);
  });

  it('climbs by the major pattern, and comes down by its mirror', () => {
    expect(stepsBetween(lineOf('scaleUp'))).toEqual(MAJOR_PATTERN);
    expect(stepsBetween(lineOf('scaleDown'))).toEqual([...MAJOR_PATTERN].reverse().map((n) => -n));
    // In time: up the octave and straight back, the top C played once.
    expect(stepsBetween(lineOf('scaleInTime'))).toEqual([
      ...MAJOR_PATTERN,
      ...[...MAJOR_PATTERN].reverse().map((n) => -n),
    ]);
    expect(lineOf('scaleUp')[0]).toBe(60);
  });

  it('grades only the scale in time against the click', () => {
    const timedIds = C_MAJOR_SCALE.steps
      .filter((s) => s.kind === 'exercise' && s.spec.kind === 'playAlong' && !!s.spec.timed)
      .map((s) => s.id);
    expect(timedIds).toEqual(['scaleInTime']);
  });

  it('shows the whole octave on every step, so no scale stops for a shift', () => {
    for (const s of C_MAJOR_SCALE.steps) {
      expect(s.fit, s.id).toEqual({ lowMidi: 60, highMidi: 72 });
    }
    // Eight whites — one more than a 320px phone shows unaided.
    expect(whiteKeyCount(60, 72)).toBe(MIN_VISIBLE_WHITES + 1);
  });

  it('asks each degree for its own note of the scale, and never names it', () => {
    const drill = step('playDegrees');
    if (drill?.kind !== 'drill' || drill.drill.kind !== 'scaleDegree') {
      throw new Error('expected a degree drill');
    }
    expect(drill.drill.tonic).toBe(0);
    expect(drill.rounds).toBeLessThanOrEqual(drill.drill.degrees.length);
    const asked = new Set<number>();
    for (let round = 0; round < drill.drill.degrees.length; round += 1) {
      const next = drillRoundAt(drill.drill, round);
      if (next?.spec.kind !== 'pitchClass' || next.degree === undefined) {
        throw new Error('expected a pitch-class round with a degree');
      }
      expect(next.spec.pitchClass).toBe(MAJOR_SCALE_STEPS[next.degree - 1]);
      // The name would be the answer.
      expect(next.label).toBe('');
      asked.add(next.degree);
    }
    // Every degree comes up before any repeats.
    expect([...asked].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('spells the scale from D with sharps, one of each letter', () => {
    const picture = step('whyAllWhite')?.visual;
    if (picture?.kind !== 'keyboard') throw new Error('expected a keyboard diagram');
    expect(picture.spelling).toBe('sharp');
    // The scale is both tints together: the black keys are the second one.
    const scale = [...(picture.highlight ?? []), ...(picture.highlightSecondary ?? [])].sort(
      (a, b) => a - b,
    );
    expect(stepsBetween(scale)).toEqual(MAJOR_PATTERN);
    expect(picture.highlightSecondary).toEqual([66, 73]);
  });

  it('shows the half steps, the tuck and the crossing in the second tint', () => {
    const secondOf = (id: string) => {
      const picture = step(id)?.visual;
      if (picture?.kind !== 'keyboard') throw new Error(`expected a diagram at ${id}`);
      return picture.highlightSecondary;
    };
    expect(secondOf('thePattern')).toEqual([64, 65, 71, 72]);
    expect(secondOf('thumbTuck')).toEqual([65]);
    expect(secondOf('crossingBack')).toEqual([64]);
  });

  it('numbers the fingers of the thumb tuck the same way up and down', () => {
    const up = step('thumbTuck')?.visual;
    const down = step('crossingBack')?.visual;
    if (up?.kind !== 'keyboard' || down?.kind !== 'keyboard') {
      throw new Error('expected keyboard diagrams');
    }
    expect(up.labelText).toEqual({
      60: '1',
      62: '2',
      64: '3',
      65: '1',
      67: '2',
      69: '3',
      71: '4',
      72: '5',
    });
    expect(down.labelText).toEqual(up.labelText);
  });
});

describe('chapter nine', () => {
  sharedChapterChecks(TRIADS);

  const step = (id: string) => TRIADS.steps.find((s) => s.id === id);
  /** The six chords of the chapter, as "root:quality", in any order. */
  const SIX = ['0:major', '5:major', '7:major', '9:minor', '2:minor', '4:minor'].sort();
  const named = (chord: NamedChord) => `${chord.root}:${chord.quality}`;

  it('teaches by hand, by ear and by name', () => {
    const kinds = TRIADS.steps.map((s) => s.kind);
    expect(kinds).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'drill')).toHaveLength(1);
  });

  it('hears and drills the same six white-key chords', () => {
    const quiz = step('hearTheMood');
    const drill = step('playNamedTriads');
    if (quiz?.kind !== 'quiz' || quiz.question.kind !== 'chordQuality') {
      throw new Error('expected an ear quiz');
    }
    if (drill?.kind !== 'drill' || drill.drill.kind !== 'namedChord') {
      throw new Error('expected a named-chord drill');
    }
    expect(quiz.question.chords.map(named).sort()).toEqual(SIX);
    expect(drill.drill.chords.map(named).sort()).toEqual(SIX);
    // Every one of them is all white keys, root position, from middle C up.
    for (const chord of drill.drill.chords) {
      for (const midi of triadMidis(60 + chord.root, chord.quality)) {
        expect(isBlackKey(midi), named(chord)).toBe(false);
      }
    }
  });

  it('asks the ear quiz in no pattern a guesser could follow', () => {
    const quiz = step('hearTheMood');
    if (quiz?.kind !== 'quiz' || quiz.question.kind !== 'chordQuality') {
      throw new Error('expected an ear quiz');
    }
    const order = Array.from({ length: quiz.rounds }, (_, round) =>
      roundEntryAt(quiz.question.kind === 'chordQuality' ? quiz.question.chords : [], round),
    ).map((chord) => chord?.quality);
    // Neither all one answer nor a strict alternation.
    expect(new Set(order).size).toBe(2);
    expect(order.every((quality, i) => i === 0 || quality !== order[i - 1])).toBe(false);
  });

  it('prompts each drill round with exactly the chord it grades', () => {
    const drill = step('playNamedTriads');
    if (drill?.kind !== 'drill' || drill.drill.kind !== 'namedChord') {
      throw new Error('expected a named-chord drill');
    }
    for (let round = 0; round < drill.rounds; round += 1) {
      const asked = drillRoundAt(drill.drill, round);
      if (asked?.spec.kind !== 'chord') throw new Error('expected a chord round');
      expect(asked.chord).toEqual(asked.spec.chord);
      expect(asked.label).toBe('');
    }
    // A minor from middle C's octave tops out at E5: all six fit the fit.
    expect(drill.fit).toEqual({ lowMidi: 60, highMidi: 76 });
  });

  it('moves exactly one note, by a half step, to change the mood', () => {
    for (const id of ['makeItMinor', 'makeItMajor']) {
      const found = step(id);
      if (found?.kind !== 'exercise' || found.spec.kind !== 'playAlong') {
        throw new Error(`expected a playAlong line at ${id}`);
      }
      const [from, to] = momentsOf(found.spec.phrase).map((moment) => moment.midis);
      const moved = from!.filter((midi) => !to!.includes(midi));
      const arrived = to!.filter((midi) => !from!.includes(midi));
      expect(moved, id).toHaveLength(1);
      expect(arrived, id).toHaveLength(1);
      expect(Math.abs(arrived[0]! - moved[0]!), id).toBe(1);
      expect(found.spec.together, id).toBeDefined();
    }
  });

  it('writes the moved third as the flat or sharp that keeps the letters stacked', () => {
    const spelled = (id: string) => {
      const found = step(id);
      if (found?.visual?.kind !== 'staff') throw new Error(`expected a stave at ${id}`);
      return phraseToNotes(found.visual.phrase)
        .filter((note) => note.spelling !== undefined)
        .map((note) => note.spelling);
    };
    // C–E♭–G, not C–D♯–G; D–F♯–A, not D–G♭–A.
    expect(spelled('makeItMinor')).toEqual([{ step: 'E', alter: -1 }]);
    expect(spelled('makeItMajor')).toEqual([{ step: 'F', alter: 1 }]);
  });

  it('draws every triad in root position, root at the bottom', () => {
    for (const s of TRIADS.steps) {
      if (s.visual?.kind !== 'staff') continue;
      for (const moment of momentsOf(s.visual.phrase)) {
        if (moment.midis.length !== 3) continue;
        const [root, third, fifth] = moment.midis as [number, number, number];
        expect([3, 4], s.id).toContain(third - root);
        expect(fifth - root, s.id).toBe(7);
      }
    }
  });
});

describe('chapter ten', () => {
  sharedChapterChecks(CHORDS_PEDAL_AND_HANDS);

  const step = (id: string) => CHORDS_PEDAL_AND_HANDS.steps.find((s) => s.id === id);
  const lineOf = (id: string) => {
    const found = step(id);
    if (found?.kind !== 'exercise' || found.spec.kind !== 'playAlong') {
      throw new Error(`expected a playAlong line at ${id}`);
    }
    return found.spec;
  };

  it('plays five things, with no quiz or drill', () => {
    const kinds = CHORDS_PEDAL_AND_HANDS.steps.map((s) => s.kind);
    expect(kinds).toHaveLength(11);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(5);
    expect(kinds.filter((kind) => kind === 'quiz' || kind === 'drill')).toHaveLength(0);
  });

  it('walks I–V–vi–IV in root position, in either hand', () => {
    for (const id of ['playTheProgression', 'pedalTheProgression', 'leftHandProgression']) {
      const moments = momentsOf(lineOf(id).phrase);
      expect(
        moments.map((moment) => pitchClassOf(moment.midis[0]!)),
        id,
      ).toEqual([0, 7, 9, 5]);
      for (const moment of moments) {
        const [root, third, fifth] = moment.midis as [number, number, number];
        expect([3, 4], id).toContain(third - root);
        expect(fifth - root, id).toBe(7);
      }
    }
  });

  it('asks for a pedal change after every chord of the pedal steps', () => {
    for (const id of ['pressThePedal', 'pedalTheProgression']) {
      const spec = lineOf(id);
      expect(spec.pedal, id).toBe('changeEach');
      expect(spec.together, id).toBeDefined();
    }
    // Everywhere else, the pedal is the player's own business.
    for (const id of ['playTheProgression', 'leftHandProgression', 'playThePiece']) {
      expect(lineOf(id).pedal, id).toBeUndefined();
    }
  });

  it('keeps the chord steps within the computer keyboard, and goes wide only for the low left hand', () => {
    const wide = CHORDS_PEDAL_AND_HANDS.steps.filter((s) => s.wide).map((s) => s.id);
    expect(wide).toEqual([
      'leftHandProgression',
      'readingBothStaves',
      'playThePiece',
      'chapterComplete',
    ]);
  });

  it('writes a piece with both staves sounding in every bar, never sharing a pitch', () => {
    const piece = lineOf('playThePiece').phrase;
    const notes = phraseToNotes(piece);
    for (const note of notes) expect(note.staff, `${note.id}`).toBeDefined();
    for (let bar = 0; bar < 8; bar += 1) {
      const onDownbeat = notes.filter((note) => note.startMs === bar * 4000);
      const staves = new Set(onDownbeat.map((note) => note.staff));
      expect([...staves].sort(), `bar ${bar + 1}`).toEqual(['bass', 'treble']);
    }
    for (const moment of momentsOf(piece)) {
      expect(new Set(moment.midis).size, `beat ${moment.beat}`).toBe(moment.notes.length);
    }
  });

  it('engraves each downbeat as a left-hand chord under a right-hand note', () => {
    // No pitch shared between the hands, so chord grouping never splits a
    // column: one chord of three on the bass staff, one note on the treble.
    const score = layoutScore(phraseToNotes(lineOf('playThePiece').phrase), {
      bpm: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      quantization: '1/16',
      minMeasures: 1,
    });
    for (let bar = 0; bar < 8; bar += 1) {
      const column = score.chords.filter((chord) => chord.displayStartMs === bar * 4000);
      const bass = column.filter((chord) => chord.staff === 'bass');
      const treble = column.filter((chord) => chord.staff === 'treble');
      expect(
        bass.map((chord) => chord.notes.length),
        `bar ${bar + 1}`,
      ).toEqual([3]);
      expect(
        treble.map((chord) => chord.notes.length),
        `bar ${bar + 1}`,
      ).toEqual([1]);
    }
  });

  it('sends a slip back two bars, not eight', () => {
    const spec = lineOf('playThePiece');
    const moments = momentsOf(spec.phrase);
    expect(spec.checkpoints?.map((index) => moments[index]?.beat)).toEqual([0, 8, 16, 24]);
  });

  it('lets the blurred demo ring into the next chord, and the clean one not', () => {
    const demo = step('changeWithTheHarmony')?.listen;
    if (!demo) throw new Error('expected a Listen demo');
    const notes = phraseToNotes(demo);
    const firstEnd = Math.max(
      ...notes.filter((n) => n.startMs === 0).map((n) => n.startMs + n.durationMs),
    );
    expect(firstEnd).toBeGreaterThan(4000);
    for (const bar of [2, 3]) {
      for (const note of notes.filter((n) => n.startMs === bar * 4000)) {
        expect(note.startMs + note.durationMs).toBeLessThanOrEqual((bar + 1) * 4000);
      }
    }
  });

  it('hands off to A Beautiful Day with both hands in Training', () => {
    expect(CHORDS_PEDAL_AND_HANDS.handoff).toEqual({
      trackId: 'a-beautiful-day',
      mode: 'training-both',
    });
  });
});

describe('intermediate chapter one', () => {
  sharedChapterChecks(HOW_TO_PRACTISE);

  const step = (id: string) => HOW_TO_PRACTISE.steps.find((s) => s.id === id);
  const lineOf = (id: string) => {
    const found = step(id);
    if (found?.kind !== 'exercise' || found.spec.kind !== 'playAlong') {
      throw new Error(`expected a playAlong line at ${id}`);
    }
    return found.spec;
  };
  /** [midi, beat] per note: what a line asks for, whatever its tempo. */
  const shape = (phrase: LearnPhrase) =>
    momentsOf(phrase).flatMap((moment) => moment.midis.map((midi) => [midi, moment.beat]));

  it('grades only the chunks and the three tempos, with no quiz or drill', () => {
    const kinds = HOW_TO_PRACTISE.steps.map((s) => s.kind);
    expect(kinds).toHaveLength(13);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(5);
    expect(kinds.filter((kind) => kind === 'quiz' || kind === 'drill')).toHaveLength(0);
  });

  it('plays the same passage at 60, then 80, then 100', () => {
    const tempos = ['atSixty', 'atEighty', 'atHundred'].map((id) => {
      const spec = lineOf(id);
      expect(spec.timed, id).toBeDefined();
      return spec.phrase.bpm;
    });
    expect(tempos).toEqual([60, 80, 100]);
    const first = shape(lineOf('atSixty').phrase);
    expect(shape(lineOf('atEighty').phrase)).toEqual(first);
    expect(shape(lineOf('atHundred').phrase)).toEqual(first);
    // The click steps up with it.
    expect(step('atEighty')?.tempo).toBe(80);
    expect(step('atHundred')?.tempo).toBe(100);
  });

  it('splits the passage into two chunks that join up to exactly the whole', () => {
    const one = shape(lineOf('chunkOne').phrase);
    const two = shape(lineOf('chunkTwo').phrase).map(([midi, beat]) => [
      midi,
      (beat as number) + 8,
    ]);
    expect([...one, ...two]).toEqual(shape(lineOf('atSixty').phrase));
    expect(lineOf('chunkOne').timed).toBeUndefined();
    expect(lineOf('chunkTwo').timed).toBeUndefined();
  });

  it('practises A Beautiful Day’s own tune, note for note', () => {
    // Its left hand's broken chords touch E4 as well, so the tune cannot be
    // picked out by pitch: every note of the passage must instead be found in
    // the track at the same pitch and beat, eight beats in.
    const take = buildLibraryTake(A_BEAUTIFUL_DAY);
    const map = createTakeTempoMap(take.tempo);
    for (const [midi, beat] of shape(lineOf('atSixty').phrase)) {
      const atMs = Math.round(map.msAtBeat((beat as number) + THEME_TRACK_BEAT));
      const found = take.notes.some(
        (note) => note.midi === midi && Math.abs(note.startMs - atMs) <= 1,
      );
      expect(found, `${midi} at beat ${beat}`).toBe(true);
    }
  });

  it('leaves right-hand Training exactly the tune it practised, and nothing of the accompaniment', () => {
    // The left hand's broken chords reach E4 and C4 in these bars; split at
    // middle C they would be waited for as right-hand notes.
    const take = buildLibraryTake(A_BEAUTIFUL_DAY);
    const map = createTakeTempoMap(take.tempo);
    const from = map.msAtBeat(THEME_TRACK_BEAT);
    const to = map.msAtBeat(THEME_TRACK_BEAT + 16);
    const rightHand = take.notes
      .filter((note) => note.startMs >= from - 1 && note.startMs < to - 1)
      .filter((note) => noteHand(note) === 'right')
      .map((note) => [note.midi, Math.round(map.beatAtMs(note.startMs)) - THEME_TRACK_BEAT]);
    expect(rightHand).toEqual(shape(lineOf('atSixty').phrase));
  });

  it('hands off to that tune slowed down and looping, right hand in Training', () => {
    expect(HOW_TO_PRACTISE.handoff).toEqual({
      trackId: 'a-beautiful-day',
      mode: 'training-right',
      speed: 0.6,
      loopBeats: [THEME_TRACK_BEAT, THEME_TRACK_BEAT + 16],
    });
  });
});

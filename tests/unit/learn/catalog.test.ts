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
import { drillRoundAt } from '@/features/learn/drill';
import { phraseToNotes } from '@/features/learn/phrase';
import { layoutScore } from '@/features/notation/notationLayout';
import { midiToStaffPosition, TREBLE_SPLIT_MIDI } from '@/features/notation/staffMapping';
import { MIN_VISIBLE_WHITES, stepWhites } from '@/features/keyboard/keyboardGeometry';
import { loadChapterProse } from '@/features/learn/content';
import { DEFAULT_RHYTHM_TOLERANCE_BEATS, goalTotal } from '@/features/learn/exerciseSpec';
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
    ]);
  });

  it('finds a chapter by id', () => {
    expect(findLearnChapter('meetTheKeyboard')?.order).toBe(1);
    expect(findLearnChapter('keySignatures')?.level).toBe('intermediate');
    expect(findLearnChapter('improvising')?.level).toBe('advanced');
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
    expect(quiz?.question.kind).toBe('nameTheKey');
    expect(quiz?.question.pitchClasses).toEqual([1, 3, 6, 8, 10]);
    expect(drill?.drill.kind).toBe('namedKey');
    expect(drill?.drill.pitchClasses).toEqual([1, 3, 6, 8, 10]);
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
    expect(quiz?.question.kind).toBe('readNote');
    expect(drill?.drill.kind).toBe('readNote');
    expect(quiz?.question.pitchClasses).toEqual([0, 2, 4, 5, 7]);
    expect(drill?.drill.pitchClasses).toEqual([0, 2, 4, 5, 7]);
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
    // `buildBeamGroups` groups by the beat in simple meter, so a bar of eight
    // eighths engraves as four clean pairs rather than one long smear. The
    // prose says exactly that, and this is what stops the two drifting apart.
    const step = RHYTHM_AND_BEAT.steps.find((s) => s.id === 'quarterAndEighth');
    if (step?.visual?.kind !== 'staff') throw new Error('expected a stave');
    const score = layoutScore(phraseToNotes(step.visual.phrase), {
      bpm: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      quantization: '1/16',
      minMeasures: 1,
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

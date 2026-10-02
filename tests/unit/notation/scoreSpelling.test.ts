import { describe, expect, it } from 'vitest';
import { createEmptyTake, writtenNotes } from '@/domain/noteEvents';
import type { NoteEvent, Take } from '@/domain/takeTypes';
import { buildLibraryTake } from '@/features/library/trackBuilder';
import { FUR_ELISE } from '@/features/library/tracks/furElise';
import { detectFifths } from '@/features/notation/keyDetection';
import { normalizeFifths, type Spelling } from '@/features/notation/keySignature';
import { layoutScore } from '@/features/notation/notationLayout';
import { scoreSpellings, spellingName } from '@/features/notation/scoreSpelling';
import { buildGoldenStudyTake } from './goldenTakes';

/**
 * Each note the score lays out, spelled as it draws it: a note's letter is its
 * diatonic steps above its clef's bottom line, E4 under the treble clef and
 * G2 under the bass, and the score says how it is altered.
 */
const BOTTOM_LETTER = { treble: 2, bass: 4 } as const;

function spelledByTheScore(take: Take): Map<string, Spelling> {
  const { tempo } = take;
  const layout = layoutScore(take.notes, {
    bpm: tempo.bpm,
    timeSignature: tempo.timeSignature,
    tempoChanges: tempo.changes,
    quantization: 'off',
    // As MusicScore reads the key: the take's own, or the one its notes are in.
    keySignature:
      tempo.keySignature !== undefined
        ? normalizeFifths(tempo.keySignature)
        : detectFifths(writtenNotes(take.notes)),
    pedals: take.pedalEvents,
  });
  const byId = new Map<string, Spelling>();
  for (const chord of layout.chords) {
    for (const note of chord.notes) {
      const letter = (((BOTTOM_LETTER[note.clef] + note.step) % 7) + 7) % 7;
      byId.set(note.id, { letter, alter: note.alter });
    }
  }
  return byId;
}

describe('scoreSpellings', () => {
  it.each([
    ['the golden study take', buildGoldenStudyTake()],
    ['Für Elise', buildLibraryTake(FUR_ELISE)],
  ])('spells %s note for note as its score does', (_, take) => {
    const ours = scoreSpellings(take.notes, take.tempo, take.pedalEvents);
    const theirs = spelledByTheScore(take);
    expect(theirs.size).toBeGreaterThan(20);
    for (const [id, spelling] of theirs) expect([id, ours.get(id)]).toEqual([id, spelling]);
  });

  it('spells a hidden note by its source’s own spelling, or else by its key', () => {
    const note = (id: string, midi: number, extra: Partial<NoteEvent> = {}): NoteEvent => ({
      id,
      midi,
      startMs: 0,
      durationMs: 400,
      velocity: 0.6,
      ...extra,
    });
    // In F major: a hidden B♭ the source spelled A♯, and one it left unspelled.
    const take = createEmptyTake({
      notes: [
        note('f', 65),
        note('hinted', 70, { hidden: true, spelling: { step: 'A', alter: 1 } }),
        note('plain', 70, { hidden: true }),
      ],
      durationMs: 1000,
    });
    take.tempo = { ...take.tempo, keySignature: -1 };
    const spellings = scoreSpellings(take.notes, take.tempo, []);
    expect(spellingName(spellings.get('hinted') as Spelling)).toBe('A♯');
    expect(spellingName(spellings.get('plain') as Spelling)).toBe('B♭');
  });
});

describe('spellingName', () => {
  it('names a letter and its accidentals, doubled where they are, without the octave', () => {
    expect(spellingName({ letter: 0, alter: 0 })).toBe('C');
    expect(spellingName({ letter: 3, alter: 1 })).toBe('F♯');
    expect(spellingName({ letter: 6, alter: -1 })).toBe('B♭');
    expect(spellingName({ letter: 4, alter: 2 })).toBe('G♯♯');
    expect(spellingName({ letter: 1, alter: -2 })).toBe('D♭♭');
  });
});

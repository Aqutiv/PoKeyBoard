import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { detectMode } from '@/features/notation/keyDetection';
import type { Spelling } from '@/features/notation/keySignature';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  linePosition,
  spellingAt,
  spellInKey,
  spellNotes,
  type SpellingKey,
} from '@/features/notation/pitchSpelling';

const C_MAJOR: SpellingKey = { fifths: 0, mode: 'major' };

const LETTERS = 'CDEFGAB';
const SIGNS: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: 'x' };

function name(spelling: Spelling): string {
  return `${LETTERS[spelling.letter]}${SIGNS[spelling.alter]}`;
}

function note(id: string, midi: number, startMs: number, durationMs = 250): NoteEvent {
  return { id, midi, startMs, durationMs, velocity: 0.6 };
}

/** One note after another, a quarter of a second apart. */
function line(midis: readonly number[]): NoteEvent[] {
  return midis.map((midi, i) => note(`n${i}`, midi, i * 250));
}

/** All of them at once. */
function chord(midis: readonly number[], startMs = 0): NoteEvent[] {
  return midis.map((midi, i) => note(`c${startMs}-${i}`, midi, startMs, 1000));
}

function spell(notes: readonly NoteEvent[], key: SpellingKey = C_MAJOR): string[] {
  return spellNotes(notes, key).map(name);
}

describe('the line of fifths', () => {
  it('places every spelling and reads it back', () => {
    for (let position = -15; position <= 19; position += 1) {
      expect(linePosition(spellingAt(position))).toBe(position);
    }
    expect(name(spellingAt(-2))).toBe('Bb');
    expect(name(spellingAt(6))).toBe('F#');
    expect(name(spellingAt(12))).toBe('B#');
    expect(name(spellingAt(13))).toBe('Fx');
    expect(name(spellingAt(-9))).toBe('Bbb');
  });
});

describe('spelling in a key', () => {
  it('writes C major’s colours the way the music uses them', () => {
    // Lone notes: the secondary dominants' leading tones sharp, the blues'
    // flat third and seventh flat.
    expect(['C#', 'Eb', 'F#', 'G#', 'Bb']).toEqual(
      [61, 63, 66, 68, 70].map((midi) => name(spellInKey(midi, C_MAJOR))),
    );
  });

  it('writes a minor key’s colours leaning to its dominant', () => {
    const aMinor: SpellingKey = { fifths: 0, mode: 'minor' };
    // C♯ and D♯ lead to D and E; B♭ is the Neapolitan.
    expect(['C#', 'D#', 'Bb']).toEqual([61, 63, 70].map((midi) => name(spellInKey(midi, aMinor))));
    // E minor's A♯ leads to its dominant, B.
    expect(name(spellInKey(70, { fifths: 1, mode: 'minor' }))).toBe('A#');
  });

  it('spells a minor key’s leading tone as one next to anything', () => {
    // B minor: A♯ against D is a diminished fourth, not a compact third, and
    // still the leading tone.
    expect(spell(chord([70, 74]), { fifths: 2, mode: 'minor' })).toEqual(['A#', 'D']);
  });

  it('writes a minor key’s leading tone on the letter below its tonic', () => {
    expect(name(spellInKey(61, { fifths: -1, mode: 'minor' }))).toBe('C#'); // D minor
    expect(name(spellInKey(66, { fifths: -2, mode: 'minor' }))).toBe('F#'); // G minor
    expect(name(spellInKey(65, { fifths: 3, mode: 'minor' }))).toBe('E#'); // F♯ minor
    expect(name(spellInKey(60, { fifths: 4, mode: 'minor' }))).toBe('B#'); // C♯ minor
    expect(name(spellInKey(67, { fifths: 5, mode: 'minor' }))).toBe('Fx'); // G♯ minor
  });

  it('keeps the old answers for the key’s own notes', () => {
    // Everything diatonic is spelled from the signature, as it always was.
    expect(spell(line([63, 65, 67, 68, 70, 72, 74]), { fifths: -3, mode: 'major' })).toEqual([
      'Eb',
      'F',
      'G',
      'Ab',
      'Bb',
      'C',
      'D',
    ]);
    expect(spell(line([66, 68, 70, 71, 73, 75, 77]), { fifths: 6, mode: 'major' })).toEqual([
      'F#',
      'G#',
      'A#',
      'B',
      'C#',
      'D#',
      'E#',
    ]);
  });
});

describe('chords', () => {
  it('spells C7 with a B flat, not an A sharp', () => {
    expect(spell(chord([60, 64, 67, 70]))).toEqual(['C', 'E', 'G', 'Bb']);
  });

  it('spells E7 in C major with a G sharp', () => {
    expect(spell(chord([64, 68, 71, 74]))).toEqual(['E', 'G#', 'B', 'D']);
  });

  it('spells the borrowed minor iv with an A flat', () => {
    expect(spell(chord([65, 68, 72]))).toEqual(['F', 'Ab', 'C']);
  });

  it('counts a note still held beneath the chord', () => {
    // A bass E held while G♯ and B arrive above it: still E major, still G♯.
    const notes = [note('bass', 52, 0, 2000), note('g', 68, 500, 500), note('b', 71, 500, 500)];
    expect(spell(notes)).toEqual(['E', 'G#', 'B']);
  });

  it('counts a key held down however long ago it was struck', () => {
    // A C held for ten seconds, and a note 3.1 s in: still C–A♭, not a lone G♯.
    const notes = [note('c', 60, 0, 10_000), note('a', 68, 3100, 400)];
    expect(spell(notes)).toEqual(['C', 'Ab']);
  });

  it('spells a doubled note the same in every octave', () => {
    expect(spell(chord([56, 64, 68, 71]))).toEqual(['G#', 'E', 'G#', 'B']);
  });

  it('keeps a chord tone when the melody leaves it by a semitone', () => {
    // D7 then G7, voiced so the F♯4 falls straight to F4: a lone line would
    // write that G♭–F, but inside D7 it is an F♯.
    const notes = [...chord([62, 66, 69, 72], 0), ...chord([65, 67, 71, 74], 1000)];
    expect(spell(notes)).toEqual(['D', 'F#', 'A', 'C', 'F', 'G', 'B', 'D']);
  });
});

describe('chromatic lines', () => {
  it('writes a rising chromatic scale in sharps', () => {
    expect(spell(line([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]))).toEqual([
      'C',
      'C#',
      'D',
      'D#',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B',
      'C',
    ]);
  });

  it('writes a falling chromatic scale in flats', () => {
    expect(spell(line([72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60]))).toEqual([
      'C',
      'B',
      'Bb',
      'A',
      'Ab',
      'G',
      'Gb',
      'F',
      'E',
      'Eb',
      'D',
      'Db',
      'C',
    ]);
  });

  it('writes a lower neighbour a letter below the note it returns to', () => {
    expect(spell(line([64, 63, 64]))).toEqual(['E', 'D#', 'E']);
  });

  it('cancels back to the key with a natural, never an F flat', () => {
    // E flat major: E natural falling back to the key's own E flat.
    expect(spell(line([64, 63]), { fifths: -3, mode: 'major' })).toEqual(['E', 'Eb']);
  });

  it('never reaches for a double sharp to make a line resolve', () => {
    // A major: G natural rising to the key's G sharp stays G natural.
    expect(spell(line([67, 68, 69]), { fifths: 3, mode: 'major' })).toEqual(['G', 'G#', 'A']);
  });

  it('resolves within one hand, not across to the other', () => {
    // The same two notes, once in one hand and once split between the hands:
    // only the first is a line, so only there is 70 an A♯ rising to B.
    const oneHand = [
      { ...note('a', 70, 0, 200), staff: 'bass' as const },
      { ...note('b', 71, 250), staff: 'bass' as const },
    ];
    const twoHands = [
      { ...note('a', 70, 0, 200), staff: 'bass' as const },
      { ...note('b', 71, 250), staff: 'treble' as const },
    ];
    expect(spell(oneHand)).toEqual(['A#', 'B']);
    expect(spell(twoHands)).toEqual(['Bb', 'B']);
  });
});

describe('a written spelling', () => {
  it('wins over anything the context would say', () => {
    // C7's seventh, written by its source as an A♯.
    const notes = chord([60, 64, 67, 70]);
    notes[3] = { ...notes[3]!, spelling: { step: 'A', alter: 1 } };
    expect(spell(notes)).toEqual(['C', 'E', 'G', 'A#']);
  });

  it('is context for the notes around it', () => {
    // A written A♭ under an unmarked 68 an octave up: one chord, one spelling.
    const notes = chord([56, 68]);
    notes[0] = { ...notes[0]!, spelling: { step: 'A', alter: -1 } };
    expect(spell(notes)).toEqual(['Ab', 'Ab']);
  });
});

describe('context', () => {
  // Two bars of C major, then E major broken chords — no two notes struck
  // together, so nothing but what is sounding and what came before can say
  // that 68 is a G♯ here.
  const cMajor = line([60, 64, 67, 72, 67, 64, 60, 64]);
  const eMajor = [64, 68, 71, 76, 71, 68, 64, 68, 71, 68, 66, 68].map((midi, i) =>
    note(`e${i}`, midi, 2000 + i * 250),
  );
  const gSharpsIn = (spelled: string[]): string[] =>
    spelled.slice(cMajor.length).filter((_, i) => eMajor[i]!.midi % 12 === 8);

  it('hears a pedalled arpeggio as the chord it is', () => {
    const pedals = [{ fromMs: 2000, toMs: 5000 }];
    const spelled = spellNotes([...cMajor, ...eMajor], C_MAJOR, pedals).map(name);
    expect(gSharpsIn(spelled).every((s) => s === 'G#')).toBe(true);
  });

  it('hears a bass note held under the arpeggio', () => {
    const bass = note('bass', 40, 2000, 3000); // E2, held
    const spelled = spell([...cMajor, bass, ...eMajor]);
    const gSharps = spelled.slice(cMajor.length + 1).filter((_, i) => eMajor[i]!.midi % 12 === 8);
    expect(gSharps.every((s) => s === 'G#')).toBe(true);
  });
});

describe('cost', () => {
  it('stays linear under a pedal that is never let up', () => {
    // Twenty thousand notes, every one of them still sounding at the end:
    // spelling each chord against all of them would be quadratic.
    const notes = Array.from({ length: 20_000 }, (_, i) =>
      note(`p${i}`, 48 + ((i * 7) % 36), i * 50, 40),
    );
    const started = performance.now();
    spellNotes(notes, C_MAJOR, [{ fromMs: 0, toMs: Number.POSITIVE_INFINITY }]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('detectMode', () => {
  function repeated(midis: readonly number[]): NoteEvent[] {
    return [...midis, ...midis].map((midi, i) => note(`m${i}`, midi, i * 250));
  }

  it('reads C sharp minor from four sharps', () => {
    // C♯ minor: tonic triads, the leading tone B♯, down to the tonic.
    const notes = repeated([61, 64, 68, 73, 72, 73, 68, 64, 61, 60, 61, 56]);
    expect(detectMode(notes, 4)).toBe('minor');
  });

  it('reads E major from the same four sharps', () => {
    const notes = repeated([64, 68, 71, 76, 75, 76, 71, 68, 64, 66, 68, 64]);
    expect(detectMode(notes, 4)).toBe('major');
  });

  it('says major when there is too little to go on', () => {
    expect(detectMode(line([61, 64, 68]), 4)).toBe('major');
  });
});

describe('in the score', () => {
  const OPTS = {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    quantization: '1/16' as const,
  };

  it('writes D minor’s leading tone as C sharp, on C’s line', () => {
    // D minor, enough of it to read the mode: the C♯ is marked with a sharp,
    // and sits on the line C natural would.
    const phrase = line([62, 65, 69, 74, 73, 74, 69, 65, 62, 61, 62, 57, 62, 65, 69, 73]);
    const layout = layoutScore(phrase, { ...OPTS, keySignature: -1 });
    expect(layout.keyMode).toBe('minor');
    const cSharp = layout.chords.flatMap((c) => c.notes).find((n) => n.id === 'n4')!;
    const c = layoutScore([note('c', 72, 0)], { ...OPTS, keySignature: -1 }).chords[0]!.notes[0]!;
    expect(cSharp.accidental).toBe('#');
    expect(cSharp.step).toBe(c.step);
  });

  it('prints a double sharp where the key needs one', () => {
    // G♯ minor's leading tone is F double sharp.
    const phrase = line([68, 71, 75, 80, 79, 80, 75, 71, 68, 67, 68, 63, 68, 71, 75, 79]);
    const layout = layoutScore(phrase, { ...OPTS, keySignature: 5 });
    const fDoubleSharp = layout.chords.flatMap((c) => c.notes).find((n) => n.id === 'n4')!;
    expect(fDoubleSharp.accidental).toBe('x');
    expect(fDoubleSharp.alter).toBe(2);
  });
});

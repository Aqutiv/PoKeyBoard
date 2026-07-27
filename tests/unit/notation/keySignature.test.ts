import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { detectFifths } from '@/features/notation/keyDetection';
import {
  keyAlterations,
  majorTonicName,
  normalizeFifths,
  signatureAccidental,
  signatureSteps,
} from '@/features/notation/keySignature';
import { layoutScore } from '@/features/notation/notationLayout';
import { midiToStaffPosition } from '@/features/notation/staffMapping';

describe('key signatures', () => {
  it('alters the letters in the order a signature writes them', () => {
    // Two sharps is F sharp then C sharp — D major.
    expect(keyAlterations(2)).toEqual([1, 0, 0, 1, 0, 0, 0]);
    // Three flats is B, E, A — E flat major.
    expect(keyAlterations(-3)).toEqual([0, 0, -1, 0, 0, -1, -1]);
    expect(keyAlterations(0)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('puts the accidentals where each clef reads them', () => {
    // One flat is B flat: the middle line in treble, the second line in bass.
    expect(signatureSteps(-1, 'treble')).toEqual([4]);
    expect(signatureSteps(-1, 'bass')).toEqual([2]);
    // One sharp is F sharp: the top line in treble, the fourth line in bass.
    expect(signatureSteps(1, 'treble')).toEqual([8]);
    expect(signatureSteps(1, 'bass')).toEqual([6]);
    expect(signatureSteps(0, 'treble')).toEqual([]);
    expect(signatureAccidental(-1)).toBe('b');
    expect(signatureAccidental(3)).toBe('#');
  });

  it('coerces a nonsense key to a real one', () => {
    expect(normalizeFifths(99)).toBe(7);
    expect(normalizeFifths(-99)).toBe(-7);
    expect(normalizeFifths('flat')).toBe(0);
    expect(normalizeFifths(undefined)).toBe(0);
  });

  it('names the major key each signature belongs to', () => {
    expect(majorTonicName(0)).toBe('C');
    expect(majorTonicName(-3)).toBe('E♭');
    expect(majorTonicName(2)).toBe('D');
  });
});

describe('spelling', () => {
  it('spells black keys as sharps with no key given, as it always did', () => {
    expect(midiToStaffPosition(61).accidental).toBe('#');
    expect(midiToStaffPosition(61).step).toBe(midiToStaffPosition(60).step);
    expect(midiToStaffPosition(66).accidental).toBe('#');
  });

  it('spells a flat key with flats, on the letter above', () => {
    // E flat major. E flat sits on E's line and prints nothing: the signature
    // has already said it.
    const eFlat = midiToStaffPosition(63, undefined, undefined, -3);
    expect(eFlat.accidental).toBeNull();
    expect(eFlat.alter).toBe(-1);
    expect(eFlat.step).toBe(midiToStaffPosition(64).step); // E's own line
    // And a pitch outside the key still leans flat.
    expect(midiToStaffPosition(61, undefined, undefined, -3).accidental).toBe('b');
  });

  it('cancels a signature accidental with a natural, not a wrong letter', () => {
    // A played E in E flat major is E natural — never F flat.
    const e = midiToStaffPosition(64, undefined, undefined, -3);
    expect(e.accidental).toBe('natural');
    expect(e.alter).toBe(0);
    expect(e.step).toBe(midiToStaffPosition(64).step);
  });

  it('prints nothing for a note the sharp key already covers', () => {
    // F sharp in D major (two sharps).
    const fSharp = midiToStaffPosition(66, undefined, undefined, 2);
    expect(fSharp.accidental).toBeNull();
    expect(fSharp.alter).toBe(1);
    // And F natural has to say so.
    expect(midiToStaffPosition(65, undefined, undefined, 2).accidental).toBe('natural');
  });
});

const OPTS = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/16' as const,
};

function note(partial: Partial<NoteEvent>): NoteEvent {
  return { id: 'n', midi: 60, startMs: 0, durationMs: 500, velocity: 0.5, ...partial };
}

describe('accidentals within a measure', () => {
  it('marks a repeated accidental once and lets the bar line forget it', () => {
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 61, startMs: 0 }),
        note({ id: 'b', midi: 61, startMs: 500 }),
        note({ id: 'c', midi: 61, startMs: 1000 }),
        // Next bar: the memory is gone, so it is marked again.
        note({ id: 'd', midi: 61, startMs: 2000 }),
      ],
      OPTS,
    );
    expect(layout.chords.map((chord) => chord.notes[0]!.accidental)).toEqual([
      '#',
      null,
      null,
      '#',
    ]);
  });

  it('needs a natural to take an accidental back inside the bar', () => {
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 61, startMs: 0 }), // C sharp
        note({ id: 'b', midi: 60, startMs: 500 }), // C natural, same line
      ],
      OPTS,
    );
    expect(layout.chords.map((chord) => chord.notes[0]!.accidental)).toEqual(['#', 'natural']);
  });

  it('keeps each line or space to its own memory', () => {
    // A sharp on one line says nothing about a different one.
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 61, startMs: 0 }), // C sharp
        note({ id: 'b', midi: 66, startMs: 500 }), // F sharp, elsewhere
      ],
      OPTS,
    );
    expect(layout.chords.map((chord) => chord.notes[0]!.accidental)).toEqual(['#', '#']);
  });

  it('leaves the key signature to speak for notes inside the key', () => {
    // E flat major: three E flats in a bar print no accidentals at all.
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 63, startMs: 0 }),
        note({ id: 'b', midi: 63, startMs: 500 }),
        note({ id: 'c', midi: 63, startMs: 1000 }),
      ],
      { ...OPTS, keySignature: -3 },
    );
    expect(layout.chords.map((chord) => chord.notes[0]!.accidental)).toEqual([null, null, null]);
  });

  it('goes back to the key after a natural has interrupted it', () => {
    // E flat major: E natural, then E flat again — the flat has to return.
    const layout = layoutScore(
      [note({ id: 'a', midi: 64, startMs: 0 }), note({ id: 'b', midi: 63, startMs: 500 })],
      { ...OPTS, keySignature: -3 },
    );
    expect(layout.chords.map((chord) => chord.notes[0]!.accidental)).toEqual(['natural', 'b']);
  });
});

describe('detectFifths', () => {
  function scale(midis: number[]): NoteEvent[] {
    return midis.map((midi, i) => note({ id: `n${i}`, midi, startMs: i * 500 }));
  }

  it('reads C major from its own scale', () => {
    expect(detectFifths(scale([60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60, 67]))).toBe(0);
  });

  it('reads a flat key from a flat scale', () => {
    // E flat major, twice over so there is enough to go on.
    const notes = [63, 65, 67, 68, 70, 72, 74, 75];
    expect(detectFifths(scale([...notes, ...notes]))).toBe(-3);
  });

  it('reads a sharp key from a sharp scale', () => {
    const notes = [62, 64, 66, 67, 69, 71, 73, 74]; // D major
    expect(detectFifths(scale([...notes, ...notes]))).toBe(2);
  });

  it('says C major when there is too little to go on', () => {
    expect(detectFifths([])).toBe(0);
    expect(detectFifths(scale([63, 68, 70]))).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isBlackKey,
  isValidMidi,
  midiToFrequency,
  midiToNoteName,
  noteNameToMidi,
} from '@/utils/midi';

describe('midiToNoteName', () => {
  it('converts reference pitches', () => {
    expect(midiToNoteName(60)).toBe('C4');
    expect(midiToNoteName(69)).toBe('A4');
    expect(midiToNoteName(21)).toBe('A0');
    expect(midiToNoteName(108)).toBe('C8');
    expect(midiToNoteName(61)).toBe('C#4');
    expect(midiToNoteName(59)).toBe('B3');
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(() => midiToNoteName(-1)).toThrow(RangeError);
    expect(() => midiToNoteName(128)).toThrow(RangeError);
    expect(() => midiToNoteName(60.5)).toThrow(RangeError);
    expect(() => midiToNoteName(Number.NaN)).toThrow(RangeError);
  });
});

describe('noteNameToMidi', () => {
  it('parses natural, sharp, and flat spellings', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('C#4')).toBe(61);
    expect(noteNameToMidi('Db4')).toBe(61);
    expect(noteNameToMidi('a4')).toBe(69);
    expect(noteNameToMidi(' G3 ')).toBe(55);
  });

  it('wraps octave-crossing accidentals correctly', () => {
    expect(noteNameToMidi('Cb4')).toBe(59); // = B3
    expect(noteNameToMidi('B#3')).toBe(60); // = C4
    expect(noteNameToMidi('Fb4')).toBe(64); // = E4
    expect(noteNameToMidi('E#4')).toBe(65); // = F4
  });

  it('round-trips every valid MIDI note', () => {
    for (let midi = 0; midi <= 127; midi += 1) {
      expect(noteNameToMidi(midiToNoteName(midi))).toBe(midi);
    }
  });

  it('returns null for junk', () => {
    expect(noteNameToMidi('')).toBeNull();
    expect(noteNameToMidi('H2')).toBeNull();
    expect(noteNameToMidi('C##4')).toBeNull();
    expect(noteNameToMidi('C')).toBeNull();
    expect(noteNameToMidi('C99')).toBeNull();
  });
});

describe('isBlackKey', () => {
  it('identifies the five black pitch classes', () => {
    const blackInOctave4 = [61, 63, 66, 68, 70];
    for (let midi = 60; midi < 72; midi += 1) {
      expect(isBlackKey(midi)).toBe(blackInOctave4.includes(midi));
    }
  });
});

describe('midiToFrequency', () => {
  it('anchors A4 at 440 Hz with octave doubling', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(midiToFrequency(81)).toBeCloseTo(880);
    expect(midiToFrequency(60)).toBeCloseTo(261.626, 2);
  });
});

describe('isValidMidi', () => {
  it('accepts 0-127 integers only', () => {
    expect(isValidMidi(0)).toBe(true);
    expect(isValidMidi(127)).toBe(true);
    expect(isValidMidi(128)).toBe(false);
    expect(isValidMidi(-1)).toBe(false);
    expect(isValidMidi(1.5)).toBe(false);
  });
});

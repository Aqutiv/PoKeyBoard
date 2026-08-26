import { describe, expect, it } from 'vitest';
import { noteLabel } from '@/features/learn/noteLabel';

const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

const all = (spelling: 'sharp' | 'flat') =>
  Array.from({ length: 12 }, (_, pitchClass) => noteLabel(pitchClass, spelling));

describe('noteLabel', () => {
  // The load-bearing test: these names come out of the notation engine's key
  // spelling tables, so a change to its rules must not quietly rename the keys
  // a lesson teaches.
  it('spells every pitch class with sharps', () => {
    expect(all('sharp')).toEqual(SHARPS);
  });

  it('spells every pitch class with flats', () => {
    expect(all('flat')).toEqual(FLATS);
  });

  it('leaves the white keys bare in both spellings', () => {
    for (const pitchClass of [0, 2, 4, 5, 7, 9, 11]) {
      expect(noteLabel(pitchClass, 'sharp'), String(pitchClass)).toHaveLength(1);
      expect(noteLabel(pitchClass, 'flat'), String(pitchClass)).toHaveLength(1);
    }
  });

  it('gives every black key exactly one accidental, and a different name each way', () => {
    for (const pitchClass of [1, 3, 6, 8, 10]) {
      const sharp = noteLabel(pitchClass, 'sharp');
      const flat = noteLabel(pitchClass, 'flat');
      expect(sharp, String(pitchClass)).toHaveLength(2);
      expect(flat, String(pitchClass)).toHaveLength(2);
      expect(sharp).not.toBe(flat);
    }
  });

  it('defaults to sharps', () => {
    expect(noteLabel(1)).toBe('C♯');
  });

  it('accepts a midi number as readily as a pitch class', () => {
    expect(noteLabel(60)).toBe('C');
    expect(noteLabel(61)).toBe('C♯');
    expect(noteLabel(61, 'flat')).toBe('D♭');
    // Octave never leaks into the label.
    expect(noteLabel(72)).toBe(noteLabel(60));
  });
});

import { describe, expect, it } from 'vitest';
import { durationToSymbol, quantizeGridBeats } from '@/features/notation/quantization';

// At 120 BPM a whole note is 2000ms.
const BPM = 120;

describe('quantizeGridBeats', () => {
  it('derives the grid from the whole note, in beats', () => {
    expect(quantizeGridBeats('1/8', 4)).toBe(0.5); // 4/4: an eighth is half a beat
    expect(quantizeGridBeats('1/16', 4)).toBe(0.25);
    expect(quantizeGridBeats('off', 4)).toBeNull();
  });

  it('counts the time signature’s own beat', () => {
    // In 6/8 the beat is an eighth, so a sixteenth is half of one.
    expect(quantizeGridBeats('1/16', 8)).toBe(0.5);
    expect(quantizeGridBeats('1/8', 8)).toBe(1);
    // Alla breve counts halves: a sixteenth is an eighth of a beat.
    expect(quantizeGridBeats('1/16', 2)).toBe(0.125);
  });
});

describe('durationToSymbol', () => {
  it('maps standard durations', () => {
    expect(durationToSymbol(2000, BPM)).toEqual({ base: 'whole', dotted: false });
    expect(durationToSymbol(1000, BPM)).toEqual({ base: 'half', dotted: false });
    expect(durationToSymbol(500, BPM)).toEqual({ base: 'quarter', dotted: false });
    expect(durationToSymbol(250, BPM)).toEqual({ base: 'eighth', dotted: false });
    expect(durationToSymbol(125, BPM)).toEqual({ base: 'sixteenth', dotted: false });
  });

  it('maps dotted durations', () => {
    expect(durationToSymbol(1500, BPM)).toEqual({ base: 'half', dotted: true });
    expect(durationToSymbol(750, BPM)).toEqual({ base: 'quarter', dotted: true });
    expect(durationToSymbol(375, BPM)).toEqual({ base: 'eighth', dotted: true });
  });

  it('picks the nearest symbol for messy performed durations', () => {
    expect(durationToSymbol(520, BPM)).toEqual({ base: 'quarter', dotted: false });
    expect(durationToSymbol(230, BPM)).toEqual({ base: 'eighth', dotted: false });
    expect(durationToSymbol(60, BPM)).toEqual({ base: 'sixteenth', dotted: false });
    expect(durationToSymbol(30_000, BPM)).toEqual({ base: 'whole', dotted: false });
  });
});

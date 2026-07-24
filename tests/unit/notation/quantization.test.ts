import { describe, expect, it } from 'vitest';
import { quantizeGridBeats, symbolForBeats } from '@/features/notation/quantization';

/** In 4/4 a whole note spans four beats. */
const FOUR = 4;

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

describe('symbolForBeats', () => {
  it('maps standard lengths', () => {
    expect(symbolForBeats(4, FOUR)).toEqual({ base: 'whole', dotted: false });
    expect(symbolForBeats(2, FOUR)).toEqual({ base: 'half', dotted: false });
    expect(symbolForBeats(1, FOUR)).toEqual({ base: 'quarter', dotted: false });
    expect(symbolForBeats(0.5, FOUR)).toEqual({ base: 'eighth', dotted: false });
    expect(symbolForBeats(0.25, FOUR)).toEqual({ base: 'sixteenth', dotted: false });
  });

  it('maps dotted lengths', () => {
    expect(symbolForBeats(3, FOUR)).toEqual({ base: 'half', dotted: true });
    expect(symbolForBeats(1.5, FOUR)).toEqual({ base: 'quarter', dotted: true });
    expect(symbolForBeats(0.75, FOUR)).toEqual({ base: 'eighth', dotted: true });
  });

  it('picks the nearest symbol for messy performed lengths', () => {
    expect(symbolForBeats(1.04, FOUR)).toEqual({ base: 'quarter', dotted: false });
    expect(symbolForBeats(0.46, FOUR)).toEqual({ base: 'eighth', dotted: false });
    expect(symbolForBeats(0.12, FOUR)).toEqual({ base: 'sixteenth', dotted: false });
    expect(symbolForBeats(60, FOUR)).toEqual({ base: 'whole', dotted: false });
    expect(symbolForBeats(0, FOUR)).toEqual({ base: 'sixteenth', dotted: false });
  });

  it('reads the whole note off the time signature', () => {
    // 6/8 counts eighths: one beat is an eighth note, six of them a whole plus.
    expect(symbolForBeats(1, 8)).toEqual({ base: 'eighth', dotted: false });
    expect(symbolForBeats(3, 8)).toEqual({ base: 'quarter', dotted: true });
    // 2/2 counts halves.
    expect(symbolForBeats(1, 2)).toEqual({ base: 'half', dotted: false });
    expect(symbolForBeats(2, 2)).toEqual({ base: 'whole', dotted: false });
  });
});

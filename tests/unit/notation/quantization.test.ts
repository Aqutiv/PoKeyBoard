import { describe, expect, it } from 'vitest';
import {
  beamCountFor,
  beatsForSymbol,
  quantizeGridBeats,
  symbolForBeats,
} from '@/features/notation/quantization';

/** In 4/4 a whole note spans four beats. */
const FOUR = 4;

describe('quantizeGridBeats', () => {
  it('derives the grid from the whole note, in beats', () => {
    expect(quantizeGridBeats('1/8', 4)).toBe(0.5); // 4/4: an eighth is half a beat
    expect(quantizeGridBeats('1/16', 4)).toBe(0.25);
    expect(quantizeGridBeats('1/32', 4)).toBe(0.125);
    expect(quantizeGridBeats('1/64', 4)).toBe(0.0625);
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

describe('beamCountFor', () => {
  it('gives one beam per flag, and none to the values drawn without', () => {
    expect(beamCountFor('eighth')).toBe(1);
    expect(beamCountFor('sixteenth')).toBe(2);
    expect(beamCountFor('32nd')).toBe(3);
    expect(beamCountFor('64th')).toBe(4);
    expect(beamCountFor('quarter')).toBe(0);
    expect(beamCountFor('whole')).toBe(0);
  });
});

describe('beatsForSymbol', () => {
  it('keeps the short values whole in units, dots included', () => {
    // The unit foundation is 384ths of a whole note, so every written value —
    // a dotted 64th included, which is what 384 rather than 192 buys — is a
    // whole number of them.
    for (const base of ['32nd', '64th'] as const) {
      for (const dotted of [false, true]) {
        const units = beatsForSymbol({ base, dotted }, 384);
        expect(Number.isInteger(units)).toBe(true);
      }
    }
    expect(beatsForSymbol({ base: '64th', dotted: true }, 384)).toBe(9);
    expect(beatsForSymbol({ base: '32nd', dotted: false }, 384)).toBe(12);
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
    expect(symbolForBeats(0.24, FOUR)).toEqual({ base: 'sixteenth', dotted: false });
    expect(symbolForBeats(60, FOUR)).toEqual({ base: 'whole', dotted: false });
    // Nothing is shorter than a 64th, so that is where a length of none lands.
    expect(symbolForBeats(0, FOUR)).toEqual({ base: '64th', dotted: false });
  });

  it('maps the short values the corpus actually uses', () => {
    expect(symbolForBeats(0.125, FOUR)).toEqual({ base: '32nd', dotted: false });
    expect(symbolForBeats(0.0625, FOUR)).toEqual({ base: '64th', dotted: false });
    expect(symbolForBeats(0.1875, FOUR)).toEqual({ base: '32nd', dotted: true });
    expect(symbolForBeats(0.09375, FOUR)).toEqual({ base: '64th', dotted: true });
    // A 32nd run played a shade unevenly is still a run of 32nds.
    expect(symbolForBeats(0.13, FOUR)).toEqual({ base: '32nd', dotted: false });
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

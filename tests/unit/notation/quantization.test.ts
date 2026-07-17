import { describe, expect, it } from 'vitest';
import {
  durationToSymbol,
  quantizeGridMs,
  quantizeStartMs,
} from '@/features/notation/quantization';

// At 120 BPM a whole note is 2000ms.
const BPM = 120;

describe('quantizeGridMs', () => {
  it('derives the grid from the whole note', () => {
    expect(quantizeGridMs('1/8', BPM)).toBe(250);
    expect(quantizeGridMs('1/16', BPM)).toBe(125);
    expect(quantizeGridMs('off', BPM)).toBeNull();
  });
});

describe('quantizeStartMs', () => {
  it('snaps to the nearest grid point', () => {
    expect(quantizeStartMs(130, '1/16', BPM)).toBe(125);
    expect(quantizeStartMs(190, '1/16', BPM)).toBe(250); // 190 → nearest of 125/250
    expect(quantizeStartMs(310, '1/8', BPM)).toBe(250);
    expect(quantizeStartMs(380, '1/8', BPM)).toBe(500);
  });

  it('is the identity when off', () => {
    expect(quantizeStartMs(137, 'off', BPM)).toBe(137);
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

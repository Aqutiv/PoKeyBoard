import { describe, expect, it } from 'vitest';
import {
  beamSpanFor,
  beamYAt,
  BEAM_SLANT_MAX_G,
  MIN_BEAM_STEM_G,
  STEM_LENGTH_G,
} from '@/features/notation/beamGeometry';

const GAP = 10;
/** Staff y grows downward, so an up-stem beam sits at a smaller y than its head. */
const UP = false;
const DOWN = true;

describe('beamSpanFor', () => {
  it('hangs a level run a full stem above its heads', () => {
    const span = beamSpanFor([0, 20, 40], [50, 50, 50], UP, GAP);
    expect(span.y1).toBeCloseTo(50 - STEM_LENGTH_G * GAP);
    expect(span.y2).toBeCloseTo(span.y1); // level heads, level beam
  });

  it('hangs a down-stem run below instead', () => {
    const span = beamSpanFor([0, 20], [50, 50], DOWN, GAP);
    expect(span.y1).toBeCloseTo(50 + STEM_LENGTH_G * GAP);
  });

  it('tilts with the outer notes of the run', () => {
    // Rising line (y falls): the beam rises with it.
    const span = beamSpanFor([0, 20], [60, 55], UP, GAP);
    expect(span.y2 - span.y1).toBeCloseTo(-5);
  });

  it('never tilts further than the slant limit, however wide the leap', () => {
    const limit = BEAM_SLANT_MAX_G * GAP;
    for (const drop of [40, 200, -40, -200]) {
      const span = beamSpanFor([0, 30], [60, 60 + drop], UP, GAP);
      expect(Math.abs(span.y2 - span.y1)).toBeLessThanOrEqual(limit + 1e-9);
    }
  });

  it('lifts the whole beam clear so the shortest stem still counts', () => {
    // A high note in the middle of a low run would otherwise poke through.
    const anchors = [60, 20, 60];
    const span = beamSpanFor([0, 20, 40], anchors, UP, GAP);
    for (let i = 0; i < anchors.length; i += 1) {
      const lineY = beamYAt(span, 0, 40, i * 20);
      const stem = (anchors[i] as number) - lineY; // up-stem: head below the beam
      expect(stem).toBeGreaterThanOrEqual(MIN_BEAM_STEM_G * GAP - 1e-9);
    }
  });

  it('keeps the minimum stem for a down-stem run too', () => {
    const anchors = [20, 60, 20];
    const span = beamSpanFor([0, 20, 40], anchors, DOWN, GAP);
    for (let i = 0; i < anchors.length; i += 1) {
      const lineY = beamYAt(span, 0, 40, i * 20);
      const stem = lineY - (anchors[i] as number);
      expect(stem).toBeGreaterThanOrEqual(MIN_BEAM_STEM_G * GAP - 1e-9);
    }
  });

  it('survives a run whose stems land on one x', () => {
    // Degenerate, but a zero spread must not divide by zero.
    const span = beamSpanFor([10, 10], [50, 50], UP, GAP);
    expect(Number.isFinite(span.y1)).toBe(true);
    expect(Number.isFinite(span.y2)).toBe(true);
  });

  it('scales with the staff space it is given', () => {
    const small = beamSpanFor([0, 20], [50, 50], UP, 5);
    const large = beamSpanFor([0, 20], [50, 50], UP, 10);
    expect(50 - small.y1).toBeCloseTo(STEM_LENGTH_G * 5);
    expect(50 - large.y1).toBeCloseTo(STEM_LENGTH_G * 10);
  });
});

describe('beamYAt', () => {
  it('reads the line at either end and in between', () => {
    const span = { y1: 10, y2: 30 };
    expect(beamYAt(span, 0, 100, 0)).toBeCloseTo(10);
    expect(beamYAt(span, 0, 100, 100)).toBeCloseTo(30);
    expect(beamYAt(span, 0, 100, 50)).toBeCloseTo(20);
  });

  it('reads a zero-width line as flat', () => {
    expect(beamYAt({ y1: 10, y2: 30 }, 5, 5, 5)).toBe(10);
  });
});

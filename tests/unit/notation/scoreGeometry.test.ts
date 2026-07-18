import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  BASS_TOP,
  computeScoreGeometry,
  GAP,
  SCORE_MIN_HEIGHT,
  STAFF_H,
  STAFF_SPACING,
  TREBLE_TOP,
} from '@/features/notation/scoreRenderer';
import { midiToStaffPosition } from '@/features/notation/staffMapping';

const LAYOUT_OPTS = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: 'off',
} as const;

function note(midi: number, startMs: number): NoteEvent {
  return { id: `n-${midi}-${startMs}`, midi, startMs, durationMs: 400, velocity: 0.7 };
}

function geometryFor(midis: number[]) {
  const notes = midis.map((midi, i) => note(midi, i * 500));
  return computeScoreGeometry(layoutScore(notes, LAYOUT_OPTS).chords);
}

describe('computeScoreGeometry', () => {
  it('returns the default constants for an empty take', () => {
    expect(computeScoreGeometry([])).toEqual({
      trebleTop: TREBLE_TOP,
      bassTop: BASS_TOP,
      minHeight: SCORE_MIN_HEIGHT,
    });
  });

  it('keeps the default layout for the normal range', () => {
    expect(geometryFor([48, 60, 72, 84])).toEqual({
      trebleTop: TREBLE_TOP,
      bassTop: BASS_TOP,
      minHeight: SCORE_MIN_HEIGHT,
    });
  });

  it('adds headroom so a C8 head is fully visible', () => {
    const geometry = geometryFor([60, 108]);
    const { step } = midiToStaffPosition(108);
    const headTop = geometry.trebleTop + STAFF_H - (step * GAP) / 2 - GAP * 0.5;
    expect(geometry.trebleTop).toBeGreaterThan(TREBLE_TOP);
    expect(headTop).toBeGreaterThanOrEqual(0);
  });

  it('adds footroom so an A0 head fits inside minHeight', () => {
    const geometry = geometryFor([21, 60]);
    const { step } = midiToStaffPosition(21);
    const headBottom = geometry.bassTop + STAFF_H - (step * GAP) / 2 + GAP * 0.5;
    expect(geometry.minHeight).toBeGreaterThan(SCORE_MIN_HEIGHT);
    expect(headBottom).toBeLessThanOrEqual(geometry.minHeight);
  });

  it('handles both extremes and preserves the staff spacing', () => {
    const geometry = geometryFor([21, 108]);
    expect(geometry.bassTop - geometry.trebleTop).toBe(STAFF_H + STAFF_SPACING);
    const high = midiToStaffPosition(108);
    const low = midiToStaffPosition(21);
    expect(geometry.trebleTop + STAFF_H - (high.step * GAP) / 2 - GAP * 0.5).toBeGreaterThanOrEqual(
      0,
    );
    expect(geometry.bassTop + STAFF_H - (low.step * GAP) / 2 + GAP * 0.5).toBeLessThanOrEqual(
      geometry.minHeight,
    );
  });

  it('uses defaults for a staff with no notes', () => {
    expect(geometryFor([108]).minHeight).toBe(geometryFor([108]).bassTop + STAFF_H + 38);
    expect(geometryFor([21]).trebleTop).toBe(TREBLE_TOP);
  });
});

import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { beamSpanFor, BEAM_THICKNESS_G } from '@/features/notation/beamGeometry';
import { layoutScore, type ScoreLayout } from '@/features/notation/notationLayout';
import {
  BASS_TOP,
  computeScoreGeometry,
  DYNAMICS_ROW_PX,
  GAP,
  SCORE_MIN_HEIGHT,
  STAFF_H,
  STAFF_SPACING,
  TREBLE_TOP,
  type ScoreGeometry,
} from '@/features/notation/scoreRenderer';
import { midiToStaffPosition } from '@/features/notation/staffMapping';

const LAYOUT_OPTS = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: 'off',
} as const;

function note(midi: number, startMs: number, durationMs = 400): NoteEvent {
  return { id: `n-${midi}-${startMs}`, midi, startMs, durationMs, velocity: 0.7 };
}

function geometryFor(midis: number[]) {
  const notes = midis.map((midi, i) => note(midi, i * 500));
  return computeScoreGeometry(layoutScore(notes, LAYOUT_OPTS));
}

/** A beamed run of sixteenths on one beat, in the order given. */
function sixteenthRun(midis: number[]): ScoreLayout {
  const notes = midis.map((midi, i) => note(midi, i * 125, 125));
  return layoutScore(notes, LAYOUT_OPTS);
}

/**
 * Where a beam is actually drawn, in the same absolute pixels the geometry
 * has to fit — mirroring `computeBeamLines` in the renderer.
 */
function beamEdges(layout: ScoreLayout, geometry: ScoreGeometry, index: number) {
  const beam = layout.beams[index]!;
  const staffTop = beam.staff === 'treble' ? geometry.trebleTop : geometry.bassTop;
  const anchors = beam.members.map((chord) => {
    const held = chord.stemDown ? chord.notes[0]! : chord.notes[chord.notes.length - 1]!;
    return staffTop + STAFF_H - (held.step * GAP) / 2;
  });
  const span = beamSpanFor(
    beam.members.map((chord) => chord.displayStartMs),
    anchors,
    beam.stemDown,
    GAP,
  );
  const half = (BEAM_THICKNESS_G * GAP) / 2;
  return { top: Math.min(span.y1, span.y2) - half, bottom: Math.max(span.y1, span.y2) + half };
}

/** The pedal row a take in the ordinary range gets: the foot of its margin. */
const DEFAULT_PEDAL_ROW = SCORE_MIN_HEIGHT - 9;
/** With no dynamics the staves keep their usual spacing, so the row sits in it. */
const DEFAULT_DYNAMICS_ROW = BASS_TOP - STAFF_SPACING * 0.3;

/**
 * Every take with notes in it reads out at least an opening dynamic, so the
 * gap between the staves opens for the mark. Only an empty take keeps the
 * bare constants — these are the "unchanged by pitch" figures for the rest.
 */
const VOICED_SPACING = STAFF_SPACING + DYNAMICS_ROW_PX;
const VOICED_BASS_TOP = TREBLE_TOP + STAFF_H + VOICED_SPACING;
const VOICED_MIN_HEIGHT = VOICED_BASS_TOP + STAFF_H + (SCORE_MIN_HEIGHT - BASS_TOP - STAFF_H);

describe('computeScoreGeometry', () => {
  it('returns the default constants for an empty take', () => {
    expect(computeScoreGeometry(layoutScore([], LAYOUT_OPTS))).toEqual({
      trebleTop: TREBLE_TOP,
      bassTop: BASS_TOP,
      minHeight: SCORE_MIN_HEIGHT,
      pedalRow: DEFAULT_PEDAL_ROW,
      dynamicsRow: DEFAULT_DYNAMICS_ROW,
    });
  });

  it('keeps the default layout for the normal range', () => {
    expect(geometryFor([48, 60, 72, 84])).toEqual({
      trebleTop: TREBLE_TOP,
      bassTop: VOICED_BASS_TOP,
      minHeight: VOICED_MIN_HEIGHT,
      pedalRow: VOICED_MIN_HEIGHT - 9,
      dynamicsRow: VOICED_BASS_TOP - VOICED_SPACING * 0.3,
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
    expect(geometry.bassTop - geometry.trebleTop).toBe(STAFF_H + VOICED_SPACING);
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

  // A run that mostly sits low stems up as a whole, so its one high note
  // carries the beam far above the staff — much further than the head alone
  // asked for. Reserving only head clearance sheared the beam off the top.
  it('fits a beam carried up over a high note in the run', () => {
    const layout = sixteenthRun([64, 67, 69, 84]); // E4 G4 A4 C6
    const beam = layout.beams[0];
    expect(beam?.staff).toBe('treble');
    expect(beam?.stemDown).toBe(false);

    const geometry = computeScoreGeometry(layout);
    expect(geometry.trebleTop).toBeGreaterThan(TREBLE_TOP);
    expect(beamEdges(layout, geometry, 0).top).toBeGreaterThanOrEqual(0);
  });

  it('fits a beam carried down under a low note in the run', () => {
    const layout = sixteenthRun([50, 53, 57, 21]); // D3 F3 A3 A0
    const beam = layout.beams[0];
    expect(beam?.staff).toBe('bass');
    expect(beam?.stemDown).toBe(true);

    const geometry = computeScoreGeometry(layout);
    expect(geometry.minHeight).toBeGreaterThan(SCORE_MIN_HEIGHT);
    expect(beamEdges(layout, geometry, 0).bottom).toBeLessThanOrEqual(geometry.minHeight);
  });

  // An unbeamed stem is shorter than a beam's reach but still four times the
  // head clearance, and the top voice of a two-voice stack always stems up.
  it('fits the stem of a lone high note that stems away from the staff', () => {
    const high = midiToStaffPosition(88); // E6, well above the staff
    const layout = layoutScore([note(88, 0, 250)], LAYOUT_OPTS);
    const chord = layout.chords[0];
    expect(chord?.beamId).toBe(null);

    const geometry = computeScoreGeometry(layout);
    const headY = geometry.trebleTop + STAFF_H - (high.step * GAP) / 2;
    const stemTip = chord?.stemDown === false ? headY - GAP * 3.5 : headY - GAP * 0.5;
    expect(stemTip).toBeGreaterThanOrEqual(0);
  });
});

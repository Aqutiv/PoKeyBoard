import type { TimeSignature } from '@/domain/takeTypes';
import { drawAccidentalGlyph } from './accidentalGlyph';
import {
  beamPieceXs,
  beamSpanFor,
  beamYAt,
  BEAM_SPACING_G,
  BEAM_THICKNESS_G,
  type BeamPiece,
  type BeamSpan,
} from './beamGeometry';
import { drawGlyph } from './glyphs/drawGlyph';
import {
  ACCIDENTAL_GLYPHS,
  clefGlyphFor,
  digitGlyphsFor,
  drawDigitRun,
  DYNAMIC_GLYPHS,
  dynamicInkG,
  dynamicOpticalCentre,
  flagAnchorYG,
  flagGlyphFor,
  flaggedStemG,
  flaggedStemReachG,
  glyphCentre,
  glyphWidth,
  noteheadGlyphFor,
  noteheadHalfWidth,
  restInkG,
  runAdvance,
  STEM_ANCHOR_RISE_G,
} from './glyphs/engravingGlyphs';
import {
  MUSIC_GLYPH_METRICS,
  MUSIC_GLYPH_NAMES,
  type MusicGlyphName,
} from './glyphs/musicGlyphMetrics';
import {
  normalizeFifths,
  signatureAccidental,
  signatureSteps,
  type AccidentalKind,
} from './keySignature';
import {
  firstChordIndexAt,
  measureIndexAt,
  type BeamGroup,
  type ChordGroup,
  type MeasureInfo,
  type LaidOutNote,
  type LaidOutRest,
  type OctaveSpan,
  type ScoreLayout,
} from './notationLayout';
import { spellInKey } from './pitchSpelling';
import { beamCountFor, type BeamCount, type DurationSymbol } from './quantization';
import { drawRestGlyph } from './restGlyph';
import { restStep } from './rests';
import {
  defaultClefFor,
  ledgerLineSteps,
  midiToStaffPosition,
  type ClefKind,
  type StaffKind,
  type StaffPosition,
} from './staffMapping';

/** Staff geometry (CSS pixels; the canvas is DPR-scaled by the component). */
export const GAP = 9;
export const STAFF_H = GAP * 4;
export const TREBLE_TOP = 34;
export const STAFF_SPACING = 48;
export const BASS_TOP = TREBLE_TOP + STAFF_H + STAFF_SPACING;
export const SCORE_MIN_HEIGHT = BASS_TOP + STAFF_H + 38;
/**
 * Gutter: system line, clefs, key signature and time signature; notes scroll beneath
 * it. `GUTTER` is what it takes in C major, and a key signature widens it —
 * seven accidentals need somewhere to go, and the alternative is drawing them
 * over the music.
 */
export const GUTTER = 58;
/** Horizontal pitch of the accidentals in the gutter's key signature. */
const KEY_ACCIDENTAL_PX = GAP * 1.05;
/** The line joining a system's staves at its left edge. */
const SYSTEM_LINE_X = 4.5;

export function gutterWidthFor(fifths: number): number {
  const count = Math.abs(normalizeFifths(fifths));
  return count === 0 ? GUTTER : GUTTER + count * KEY_ACCIDENTAL_PX + GAP * 0.6;
}

// Every music symbol on the score is a glyph of the music font (`glyphs/`),
// drawn to a staff space of `GAP` pixels. What depends on a glyph's shape —
// how wide a head is, how far a flag swings out, where a dynamic's middle is
// — is read from the font's metrics, never written down here.

type DurationBase = DurationSymbol['base'];

/** Half a notehead's width, from its centre to its edge: the font's own head for `base`. */
function headHalfPx(base: DurationBase): number {
  return noteheadHalfWidth(base) * GAP;
}

/** A stem's width: heavier than the font's own, to read at screen size. */
const STEM_W_PX = 1.6;
/** Clear space between an accidental's ink and the head it stands before, as on paper. */
const ACCIDENTAL_GAP_PX = GAP * 0.25;
/** Horizontal pitch of stacked accidental columns, left of the chord. */
const ACCIDENTAL_COLUMN_PX = GAP * 1.4;
/** Clear space between the rightmost head and its dot, as on paper. */
const DOT_GAP_PX = GAP * 0.4;

/**
 * Clear space a bar line keeps before the first ink of the bar it opens: the
 * downbeat's head, or the accidental in front of it.
 */
const BAR_LINE_LEAD_PX = GAP * 0.6;
/** The least clear space it keeps after the last ink of the bar it closes. */
const BAR_LINE_TRAIL_PX = GAP * 0.3;
/**
 * A chord drawn this close to a bar's time belongs to the bar it opens. The
 * layout rounds a chord's display time to the millisecond; a bar's start,
 * under a tempo map, need not be a whole one.
 */
const ON_THE_BAR_MS = 1;

/**
 * Clear space between the gutter and the music standing at `scrollMs`.
 *
 * The gutter is painted last, over everything, so that the music can scroll
 * away underneath it. At the top of a take there is nothing earlier to scroll
 * under it, and a note sitting flush against its edge loses the left half of
 * its head — and all of its accidental — to that overpaint. It is also about
 * what an engraver leaves after a time signature before the first note.
 *
 * It clears any one accidental in the first column — a sharp, the widest,
 * reaches 16.5 px back from its head's centre — but not a double flat, which
 * reaches 22.4: on a take's very first chord that one tucks 2.6 px of its ink
 * under the gutter, as a second column of accidentals there always has.
 */
export const SCORE_LEAD_IN = GAP * 2.2;

// Beam proportions come from `beamGeometry`, so a run groups and slants the
// same way on screen as it does on paper — only the unit differs.
const BEAM_THICKNESS_PX = GAP * BEAM_THICKNESS_G;
const BEAM_SPACING_PX = GAP * BEAM_SPACING_G;
/**
 * Room kept for the numeral over a tuplet's beam: the size it was once set in
 * type, which the font's tuplet digits, at `TUPLET_SPACE`, fit well inside.
 */
const TUPLET_ROOM_PX = GAP * 1.7;
/** Staff space the tuplet numeral is set at, as on paper: small beside the notes. */
const TUPLET_SPACE = GAP * 0.8;
/** Clear space between a tuplet's beam and its numeral. */
const TUPLET_GAP_PX = GAP * 0.6;
/** The tallest of the tuplet digits, above its origin, in staff spaces. */
const TUPLET_DIGIT_TOP_G = Math.max(
  ...MUSIC_GLYPH_NAMES.filter((name) => name.startsWith('tuplet')).map(
    (name) => MUSIC_GLYPH_METRICS[name].bbox[3],
  ),
);

/** One beam's line across the view, in pixels; keyed by `ChordGroup.beamId`. */
interface BeamLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stemDown: boolean;
  beamCount: BeamCount;
  tupletCount: number | null;
  /** Each member's stem x, which the beams after the first are measured from. */
  xs: number[];
  secondary: BeamPiece[][];
}
type BeamLines = Map<number, BeamLine>;

/** What a bar of silence takes, whatever the meter is. */
const WHOLE_REST: DurationSymbol = { base: 'whole', dotted: false };
const WHOLE_REST_STEP = restStep(WHOLE_REST);

/** Padding kept past the furthest ink the music reaches, above and below. */
const INK_CLEARANCE = 6;
/** How far a notehead's ink reaches above or below its line: the tallest of the font's heads. */
const HEAD_REACH_PX =
  Math.max(
    ...(['noteheadBlack', 'noteheadHalf', 'noteheadWhole'] as const).map((name) => {
      const [, bottom, , top] = MUSIC_GLYPH_METRICS[name].bbox;
      return Math.max(top, -bottom);
    }),
  ) * GAP;
/** Clearance above/below an extreme note head: its reach plus padding. */
const HEAD_CLEARANCE = HEAD_REACH_PX + INK_CLEARANCE;
/** Least room the pedal bracket keeps under the bass staff. */
const PEDAL_ROW_PX = 15;
/** Extra room between the staves when the take carries dynamics. */
export const DYNAMICS_ROW_PX = 14;
/** Half-height of a hairpin's open end. */
const HAIRPIN_MOUTH_PX = GAP * 0.55;
/** Bottom margin below the bass staff at the default geometry. */
const BOTTOM_MARGIN = SCORE_MIN_HEIGHT - BASS_TOP - STAFF_H;

/** How much bar furniture a view carries. See `ScoreView.chrome`. */
export type ScoreChrome = 'full' | 'bare' | 'lesson';

/**
 * A view's chrome, defaulted.
 *
 * Normalized in one place rather than compared inline, because `chrome` is
 * optional and the Play page passes nothing at all: written as `=== 'full'`
 * against a raw `view.chrome`, every furniture check would silently turn off
 * for the live score.
 */
function chromeOf(view: ScoreView): ScoreChrome {
  return view.chrome ?? 'full';
}

/** 'grand' is both staves; the others draw one, in the treble slot. */
export type StaffMode = 'grand' | 'treble' | 'bass';

export interface ScoreGeometryOptions {
  /** Which staves the height has to fit. Defaults to the grand staff. */
  staves?: StaffMode;
  /**
   * The furniture the view draws, which the room above the music has to fit:
   * an octave line clears the measure numbers wherever there are any. Defaults
   * to 'full', as `ScoreView.chrome` does.
   */
  chrome?: ScoreChrome;
}

export interface ScoreGeometry {
  trebleTop: number;
  bassTop: number;
  /** Container min-height that fits every note head plus margins. */
  minHeight: number;
  /** y of the pedal row, under everything the bass staff reaches down to. */
  pedalRow: number;
  /** Baseline of the dynamics row, in the gap between the staves. */
  dynamicsRow: number;
}

/** y of a step relative to its own staff's top, mirroring `yForStep`. */
function yRel(step: number): number {
  return STAFF_H - (step * GAP) / 2;
}

/**
 * How far a tie arcs off its head, on the side away from the stem.
 *
 * `drawTies` starts the arc `GAP * 0.85` off the head and `drawTieArc` pulls
 * it a further half of its deepest control offset — a quadratic reaches half
 * way to its control point.
 */
const TIE_REACH_PX = GAP * 0.85 + (GAP * 1.1) / 2;

/**
 * How far a chord's own stem and flag reach past its heads, relative to its
 * staff.
 *
 * Only unbeamed chords answer here — a beamed one hangs from the beam, which
 * is measured whole. A flag hangs from the tip back toward the head, but a
 * 32nd's and a 64th's stack up past a normal stem's end, so the reach is the
 * stem or the flag's ink, whichever runs further (`flaggedStemReachG`).
 */
function stemExtentRel(chord: ChordGroup): number | null {
  if (chord.symbol.base === 'whole' || chord.beamId !== null) return null;
  const anchor = chord.stemDown ? chord.notes[0] : chord.notes[chord.notes.length - 1];
  if (!anchor) return null;
  const reach = flaggedStemReachG(beamCountFor(chord.symbol.base), chord.stemDown) * GAP;
  return yRel(anchor.step) + (chord.stemDown ? 1 : -1) * reach;
}

/**
 * A beam's line relative to its staff, from its first chord's time to its
 * last's.
 *
 * This is the line the renderer will actually draw, not an upper bound: the
 * span depends on the stem positions only through where each one falls along
 * the run, and x is affine in ms, so the chords' display times stand in for
 * their pixels. Every member shares a stem direction, so the stem inset is a
 * constant that cancels. Measured with the run's beam count, as it is drawn:
 * a third or fourth beam lengthens the stems and carries the whole line
 * further out, and the beams after the first stack inside it, toward the heads.
 */
function beamLineRel(beam: BeamGroup): { span: BeamSpan; fromMs: number; toMs: number } | null {
  if (beam.members.length === 0) return null;
  const xs = beam.members.map((chord) => chord.displayStartMs);
  const anchors = beam.members.map((chord) => {
    const note = chord.stemDown ? chord.notes[0] : chord.notes[chord.notes.length - 1];
    return note ? yRel(note.step) : yRel(0);
  });
  return {
    span: beamSpanFor(xs, anchors, beam.stemDown, GAP, beam.beamCount),
    fromMs: xs[0] as number,
    toMs: xs[xs.length - 1] as number,
  };
}

/** The band a beam claims, relative to its staff; see `beamLineRel`. */
function beamExtentRel(beam: BeamGroup): { top: number; bottom: number } | null {
  const line = beamLineRel(beam);
  if (!line) return null;
  const { span } = line;
  const half = BEAM_THICKNESS_PX / 2;
  let top = Math.min(span.y1, span.y2) - half;
  let bottom = Math.max(span.y1, span.y2) + half;
  // The tuplet numeral sits outside the beam, on the side away from the heads.
  if (beam.tupletCount !== null) {
    if (beam.stemDown) bottom += GAP * 1.5 + TUPLET_ROOM_PX * 0.25;
    else top -= GAP * 0.8 + TUPLET_ROOM_PX * 0.8;
  }
  return { top, bottom };
}

/** The type measure numbers are set in, and a tempo mark's number. */
const MARK_FONT_PX = 10;
const MARK_FONT = `${MARK_FONT_PX}px system-ui, sans-serif`;
/** How far above the top staff a measure number's baseline stands. */
const MEASURE_NUMBER_RISE_PX = 8;
/**
 * How far a numeral's ink rises above its baseline. Figures stand about as
 * tall as capitals, which the interface fonts `system-ui` resolves to draw at
 * 0.7 of their size or a little over; the canvas cannot be asked from here.
 */
const NUMERAL_HEIGHT_PX = MARK_FONT_PX * 0.75;

/** Staff space the tempo mark's note is set at: small, beside the measure number. */
const TEMPO_NOTE_SPACE = GAP * 0.4;
/** How far above the top staff a tempo mark's baseline stands, where nothing is in its way. */
const TEMPO_MARK_RISE_PX = 20;
/** How far a tempo mark's ink rises above its baseline: its note, which stands a pixel up. */
const TEMPO_MARK_HEIGHT_PX =
  1 +
  (MUSIC_GLYPH_METRICS.metNoteQuarterUp.bbox[3] - MUSIC_GLYPH_METRICS.metNoteQuarterUp.bbox[1]) *
    TEMPO_NOTE_SPACE;

/** Staff space the 8va and 8vb labels are set at. */
const OCTAVE_LABEL_SPACE = GAP * 0.6;
/** How far an octave line stands off its staff where nothing under it reaches that far. */
const OCTAVE_LINE_OFFSET_PX = GAP * 2.4;
/**
 * How far an octave line's mark reaches either side of the line. Its label is
 * the tallest part of it, its ink centred on the line; the hook at the far end
 * turns in no further. So the whole mark keeps to one band this far each side
 * of the line, and that band is what has to clear what lies under it.
 */
const OCTAVE_BAND_HALF_PX = Math.max(
  ...(['ottavaAlta', 'ottavaBassaVb'] as const).map((name) => {
    const [, bottom, , top] = MUSIC_GLYPH_METRICS[name].bbox;
    return ((top - bottom) / 2) * OCTAVE_LABEL_SPACE;
  }),
);
/** Clear space an octave line's band keeps from the music under it, and from the bar numbers. */
const OCTAVE_CLEAR_PX = GAP * 0.5;

/**
 * How far a chord's own ink reaches above its staff (`up`) or below it,
 * relative to the staff's top: its heads — and the ledger lines through them —
 * accidentals and dots, a stem and its flags, and a tie arcing that way. A
 * beamed chord's stem runs to its beam, which is measured whole instead
 * (`beamExtentRel`).
 */
function chordInkRel(chord: ChordGroup, up: boolean): number {
  const toward = up ? -1 : 1;
  const outer = up ? chord.notes[chord.notes.length - 1] : chord.notes[0];
  let ink = outer
    ? yRel(outer.step) + toward * HEAD_REACH_PX
    : up
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;
  const reach = (y: number): void => {
    ink = up ? Math.min(ink, y) : Math.max(ink, y);
  };
  /** How far a glyph set on `y` reaches that way: its box's top, or its bottom. */
  const edge = (name: MusicGlyphName, y: number): number => {
    const [, bottom, , top] = MUSIC_GLYPH_METRICS[name].bbox;
    return y - (up ? top : bottom) * GAP;
  };
  for (const note of chord.notes) {
    const y = yRel(note.step);
    if (note.accidental) reach(edge(ACCIDENTAL_GLYPHS[note.accidental], y));
    // A dot sits in a space, so a line note's goes up half a space (see `drawChord`).
    if (chord.symbol.dotted) {
      reach(edge('augmentationDot', y - (note.step % 2 === 0 ? GAP / 2 : 0)));
    }
    // A tie arcs on the side away from the stem.
    if ((note.tiedFromPrev || note.tiedToNext) && chord.stemDown === up) {
      reach(y + toward * TIE_REACH_PX);
    }
  }
  const stem = stemExtentRel(chord);
  if (stem !== null && chord.stemDown !== up) reach(stem);
  return ink;
}

/**
 * Where a beam's outer edge stands over one of its chords, relative to its
 * staff's top: at that chord's stem, rather than at the beam's extreme.
 */
function beamEdgeRel(beam: BeamGroup, chord: ChordGroup): number | null {
  const line = beamLineRel(beam);
  if (!line) return null;
  const y = beamYAt(line.span, line.fromMs, line.toMs, chord.displayStartMs);
  return y + ((beam.stemDown ? 1 : -1) * BEAM_THICKNESS_PX) / 2;
}

/**
 * The furthest the music under an octave line reaches toward it, relative to
 * the top of its staff, or null for a line over nothing: the chords it covers,
 * and the ones either side of them. Its label starts over the first head, where
 * the flag or dot of the chord before can reach, and its hook stands past the
 * last, over where the chord after begins — its accidentals hang back that far.
 */
function coveredInkRel(layout: ScoreLayout, span: OctaveSpan): number | null {
  let ink = span.up ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const further = (y: number): void => {
    ink = span.up ? Math.min(ink, y) : Math.max(ink, y);
  };
  const { chords, beams } = layout;
  const covers = (chord: ChordGroup, whole: boolean): void => {
    further(chordInkRel(chord, span.up));
    const beam = chord.beamId === null ? undefined : beams[chord.beamId];
    if (!beam || beam.stemDown === span.up) return;
    // A beam under the line is measured whole; one reaching in from beside it,
    // only where it meets the chord beside the line.
    if (whole) {
      const extent = beamExtentRel(beam);
      if (extent) further(span.up ? extent.top : extent.bottom);
      return;
    }
    const edge = beamEdgeRel(beam, chord);
    if (edge !== null) further(edge);
  };
  /** Every chord of the span's staff at the onset nearest `from`, stepping by `step`. */
  const beside = (from: number, step: 1 | -1): void => {
    let onset: number | null = null;
    for (let i = from; i >= 0 && i < chords.length; i += step) {
      const chord = chords[i] as ChordGroup;
      if (onset !== null && chord.displayStartMs !== onset) return;
      if (chord.staff !== span.staff) continue;
      onset = chord.displayStartMs;
      covers(chord, false);
    }
  };
  const first = firstChordIndexAt(chords, span.fromMs);
  beside(first - 1, -1);
  let i = first;
  for (; i < chords.length; i += 1) {
    const chord = chords[i] as ChordGroup;
    if (chord.displayStartMs > span.toMs) break;
    if (chord.staff === span.staff) covers(chord, true);
  }
  beside(i, 1);
  return Number.isFinite(ink) ? ink : null;
}

/**
 * Where an octave line stands, relative to the top of its staff.
 *
 * Its usual distance off the staff, unless something under it reaches
 * further. Then it moves out until its band (`OCTAVE_BAND_HALF_PX`) clears, by
 * `OCTAVE_CLEAR_PX`, the furthest ink of the music it covers: a head on its
 * ledger lines, an accidental, a stem and its flag, a beam. And where the view
 * numbers its bars, an 8va takes the row above the numbers as well — every bar
 * carries one, and a line across a bar line would hang its label or its hook
 * on it. Stacked as an engraver stacks them: the music, then the measure
 * numbers, then the octave line, and a tempo mark outside them all
 * (`tempoMarkRise`).
 */
function octaveLineRel(layout: ScoreLayout, span: OctaveSpan, numbered: boolean): number {
  const clearance = OCTAVE_CLEAR_PX + OCTAVE_BAND_HALF_PX;
  const ink = coveredInkRel(layout, span);
  if (!span.up) {
    const line = STAFF_H + OCTAVE_LINE_OFFSET_PX;
    return ink === null ? line : Math.max(line, ink + clearance);
  }
  let line = -OCTAVE_LINE_OFFSET_PX;
  if (ink !== null) line = Math.min(line, ink - clearance);
  if (numbered) line = Math.min(line, -(MEASURE_NUMBER_RISE_PX + NUMERAL_HEIGHT_PX) - clearance);
  return line;
}

/**
 * Every octave line's place (`octaveLineRel`), by index into `layout.octaves`.
 * Built once per layout, which is immutable, for views that number their bars
 * and for those that do not.
 */
const octaveLines = new WeakMap<ScoreLayout, { numbered?: number[]; plain?: number[] }>();

function octaveLinesFor(layout: ScoreLayout, numbered: boolean): readonly number[] {
  let cached = octaveLines.get(layout);
  if (!cached) {
    cached = {};
    octaveLines.set(layout, cached);
  }
  const key = numbered ? 'numbered' : 'plain';
  return (cached[key] ??= layout.octaves.map((span) => octaveLineRel(layout, span, numbered)));
}

/**
 * How far above the top staff a tempo mark's baseline stands: where it always
 * has, unless an 8va runs over its bar. Then it stands above the line's band,
 * clear of it, as a tempo mark stands outside everything else on paper.
 * `lines` is `octaveLinesFor` the view.
 */
function tempoMarkRise(
  layout: ScoreLayout,
  measure: MeasureInfo,
  lines: readonly number[],
): number {
  let rise = TEMPO_MARK_RISE_PX;
  layout.octaves.forEach((span, i) => {
    if (!span.up) return;
    if (span.fromMs >= measure.endMs - ON_THE_BAR_MS) return;
    if (span.toMs < measure.startMs - ON_THE_BAR_MS) return;
    rise = Math.max(rise, OCTAVE_BAND_HALF_PX + OCTAVE_CLEAR_PX - (lines[i] as number));
  });
  return rise;
}

/**
 * Content-aware vertical geometry: the staves shift down and the view grows
 * only when the take reaches far enough beyond the staves that the default
 * margins would clip the music. Heads set the clearance where stems point
 * back toward the staff, but a beamed run commits every member to one
 * direction, so the top voice can stem *away* from the staff however high it
 * sits — the stems and beams are measured too, or they get sheared off.
 * Takes in the normal range get exactly the default constants.
 */
export function computeScoreGeometry(
  layout: ScoreLayout,
  options: ScoreGeometryOptions = {},
): ScoreGeometry {
  const hasDynamics = layout.dynamics.length + layout.hairpins.length > 0;
  // On the grand staff the gap between the staves absorbs whatever a treble
  // chord hangs down or a bass chord throws up, so each margin has exactly one
  // staff pressing on it. With a single staff there is no gap, and that one
  // staff has to answer for both.
  const single = options.staves && options.staves !== 'grand' ? options.staves : null;
  const upStaff: StaffKind = single ?? 'treble';
  const downStaff: StaffKind = single ?? 'bass';
  // Relative to each staff's own top: above the treble staff is negative,
  // below the bass staff is greater than STAFF_H.
  let trebleReach = Number.POSITIVE_INFINITY;
  let bassReach = Number.NEGATIVE_INFINITY;
  const reachUp = (value: number) => {
    trebleReach = Math.min(trebleReach, value);
  };
  const reachDown = (value: number) => {
    bassReach = Math.max(bassReach, value);
  };

  // Two independent `if`s rather than if/else: on the grand staff a chord is
  // either treble or bass so this is a no-op, and with one staff the same
  // chord legitimately presses on both margins.
  for (const chord of layout.chords) {
    const top = chord.notes[chord.notes.length - 1];
    const bottom = chord.notes[0];
    if (chord.staff === upStaff && top) reachUp(yRel(top.step) - HEAD_CLEARANCE);
    if (chord.staff === downStaff && bottom) reachDown(yRel(bottom.step) + HEAD_CLEARANCE);
    // A tie arcs on the side the stem is not, so it can clear the head by
    // more than the head clearance allows for.
    for (const note of chord.notes) {
      if (!note.tiedFromPrev && !note.tiedToNext) continue;
      if (chord.staff === upStaff && chord.stemDown) {
        reachUp(yRel(note.step) - TIE_REACH_PX - INK_CLEARANCE);
      }
      if (chord.staff === downStaff && !chord.stemDown) {
        reachDown(yRel(note.step) + TIE_REACH_PX + INK_CLEARANCE);
      }
    }
    const stem = stemExtentRel(chord);
    if (stem === null) continue;
    if (chord.staff === upStaff && !chord.stemDown) reachUp(stem - INK_CLEARANCE);
    if (chord.staff === downStaff && chord.stemDown) reachDown(stem + INK_CLEARANCE);
  }

  for (const beam of layout.beams) {
    const extent = beamExtentRel(beam);
    if (!extent) continue;
    if (beam.staff === upStaff && !beam.stemDown) reachUp(extent.top - INK_CLEARANCE);
    if (beam.staff === downStaff && beam.stemDown) reachDown(extent.bottom + INK_CLEARANCE);
  }

  // An octave line stands outside the music it covers, so its band is the
  // furthest thing out on its side — except the pedal row, which goes under an
  // 8vb it runs beneath, and a tempo mark, which goes over an 8va on its bar.
  const lines = octaveLinesFor(layout, (options.chrome ?? 'full') === 'full');
  layout.octaves.forEach((span, i) => {
    const line = lines[i] as number;
    if (span.up && span.staff === upStaff) {
      reachUp(line - OCTAVE_BAND_HALF_PX - INK_CLEARANCE);
    }
    if (!span.up && span.staff === downStaff) {
      const band = line + OCTAVE_BAND_HALF_PX;
      reachDown(band + INK_CLEARANCE);
      const pedalled = layout.pedals.some(
        (pedal) => pedal.fromMs <= span.toMs && pedal.toMs >= span.fromMs,
      );
      // Room for the bracket, hooks and all, clear under the band; see `pedalRow`.
      if (pedalled) reachDown(band + OCTAVE_CLEAR_PX + PEDAL_HOOK_PX + PEDAL_ROW_PX * 0.6);
    }
  });
  if (upStaff === 'treble') {
    layout.measures.forEach((measure, i) => {
      if (i === 0 || (layout.measures[i - 1] as MeasureInfo).bpm === measure.bpm) return;
      const rise = tempoMarkRise(layout, measure, lines);
      if (rise > TEMPO_MARK_RISE_PX) reachUp(-(rise + TEMPO_MARK_HEIGHT_PX) - INK_CLEARANCE);
    });
  }

  const topExtent = trebleReach === Number.POSITIVE_INFINITY ? 0 : -trebleReach;
  const trebleTop = Math.max(TREBLE_TOP, Math.ceil(topExtent));

  if (single) {
    // One staff, so there is no gap to open for dynamics: the mark goes under
    // the staff and the bottom margin grows for it instead.
    const dynamicsPad = hasDynamics ? DYNAMICS_ROW_PX : 0;
    const floor = BOTTOM_MARGIN + dynamicsPad;
    const bottomExtent =
      bassReach === Number.NEGATIVE_INFINITY
        ? floor
        : Math.max(floor, Math.ceil(bassReach - STAFF_H) + dynamicsPad);
    const staffBottom = trebleTop + STAFF_H;
    return {
      trebleTop,
      // Collapsed onto the one staff. Drawing goes through `staffTops` and
      // `systemBottom`, so nothing should read this — but if something slips
      // past a guard it lands on the staff, visibly wrong, rather than off the
      // canvas or as NaN.
      bassTop: trebleTop,
      minHeight: staffBottom + bottomExtent,
      pedalRow: staffBottom + Math.max(PEDAL_ROW_PX, bottomExtent - PEDAL_ROW_PX * 0.6),
      dynamicsRow: staffBottom + GAP * 1.8,
    };
  }

  // Nothing else reserves the gap between the staves, so a take with dynamics
  // opens it up for them; one without keeps the geometry it always had.
  const staffSpacing = STAFF_SPACING + (hasDynamics ? DYNAMICS_ROW_PX : 0);
  const bassTop = trebleTop + STAFF_H + staffSpacing;
  const bottomExtent =
    bassReach === Number.NEGATIVE_INFINITY
      ? BOTTOM_MARGIN
      : Math.max(BOTTOM_MARGIN, Math.ceil(bassReach - STAFF_H));
  return {
    trebleTop,
    bassTop,
    minHeight: bassTop + STAFF_H + bottomExtent,
    // The pedal row goes at the foot of the space the bass staff has claimed,
    // so it clears the low notes hanging under it instead of running through
    // them. On a take that stays in range that is the default bottom margin.
    pedalRow: bassTop + STAFF_H + Math.max(PEDAL_ROW_PX, bottomExtent - PEDAL_ROW_PX * 0.6),
    // Marks sit low in the gap, nearer the bass staff — where a pianist looks
    // for them, and where the treble's own stems are not.
    dynamicsRow: bassTop - staffSpacing * 0.3,
  };
}

/** Colors for the live score canvas. The canvas can't read CSS custom
 * properties at draw time, so each theme's palette is duplicated here —
 * keep in sync with src/themes.css (gutterBg tracks --surface-1). */
export interface ScorePalette {
  staffLine: string;
  barLine: string;
  note: string;
  noteDim: string;
  highlight: string;
  record: string;
  recordWash: string;
  ghost: string;
  playhead: string;
  /** The passage playback repeats: a wash over it, and a line at each end. */
  loopWash: string;
  loopEdge: string;
  gutterBg: string;
  measureNumber: string;
  rest: string;
}

export const SCORE_PALETTES: Record<'dark' | 'light', ScorePalette> = {
  dark: {
    staffLine: '#544d3d',
    barLine: '#6d6154',
    note: '#f2ecdf',
    noteDim: '#b3a996',
    highlight: '#f0b954',
    record: '#e5484d',
    recordWash: 'rgba(229, 72, 77, 0.28)',
    ghost: 'rgba(242, 236, 223, 0.4)',
    playhead: '#f0b954',
    loopWash: 'rgba(240, 185, 84, 0.1)',
    loopEdge: 'rgba(240, 185, 84, 0.55)',
    gutterBg: 'rgba(29, 25, 22, 0.96)',
    measureNumber: '#b3a996',
    rest: '#9c9280',
  },
  light: {
    staffLine: '#b5a98e',
    barLine: '#8f8468',
    note: '#211d15',
    noteDim: '#6b6353',
    highlight: '#8a6410',
    record: '#c73e3e',
    recordWash: 'rgba(199, 62, 62, 0.22)',
    ghost: 'rgba(33, 29, 21, 0.35)',
    playhead: '#8a6410',
    loopWash: 'rgba(138, 100, 16, 0.08)',
    loopEdge: 'rgba(138, 100, 16, 0.5)',
    gutterBg: 'rgba(255, 253, 248, 0.96)',
    measureNumber: '#6b6353',
    rest: '#857c68',
  },
};

export interface ScoreView {
  widthPx: number;
  heightPx: number;
  pxPerMs: number;
  /** Take time at the left edge of the scrolling region (after the gutter). */
  scrollMs: number;
  /** Vertical staff origins, from computeScoreGeometry. */
  trebleTop: number;
  bassTop: number;
  /** y of the pedal row; see `ScoreGeometry.pedalRow`. */
  pedalRow: number;
  /** y of the dynamics row; see `ScoreGeometry.dynamicsRow`. */
  dynamicsRow: number;
  /** Width of the fixed prefix; `gutterWidthFor` the take's key signature. */
  gutterPx: number;
  /**
   * Which staves to draw. Defaults to 'grand' — the Play page's.
   *
   * Must match what `computeScoreGeometry` was given: the staff origins and
   * the height both come from there, and disagreeing draws one staff into a
   * canvas sized for two, gutter fill and all.
   */
  staves?: StaffMode;
  /**
   * How much furniture the bar carries.
   *
   * 'bare' drops everything that describes a *bar* rather than a note, which is
   * noise when the whole picture is one note being read. 'lesson' sits between:
   * it keeps the time signature, for the chapter whose subject the time
   * signature is, but still leaves off the measure number and the empty spill
   * bar. Defaults to 'full' — see `chromeOf`.
   */
  chrome?: ScoreChrome;
  /**
   * Where the music breaks onto another view — the next system of a lesson's
   * line. The view closes there on a plain bar line, whatever its layout holds
   * past it: a note held across the break is laid out on into the next bar.
   * Without it the closing line is the final one, where the music ends.
   */
  systemBreakMs?: number;
}

export interface GhostNote {
  midi: number;
  /** 0..1 remaining life; drawn with matching alpha. */
  life: number;
}

export interface OpenRecordingNote {
  midi: number;
  startMs: number;
  durationMs: number;
}

export interface ScoreRenderInput {
  layout: ScoreLayout;
  timeSignature: TimeSignature;
  /** Sharps (positive) or flats (negative) the gutter prints. */
  keySignature: number;
  playheadMs: number;
  recording: boolean;
  openNotes: readonly OpenRecordingNote[];
  ghosts: readonly GhostNote[];
  /**
   * Notes to draw lit because the user is holding that key right now —
   * independent of the playhead, which is the other reason a head lights.
   * Learn uses it so a lesson's stave and the keyboard under it agree.
   */
  litMidis?: ReadonlySet<number>;
  /**
   * Notes to draw lit by *which note* they are rather than by pitch. When
   * given, it replaces `litMidis`: a lesson walking a written line lights the
   * heads already played, and a tune with six Es would otherwise light all six
   * the moment one E is held.
   */
  litNoteIds?: ReadonlySet<string>;
  /** The passage playback repeats, shaded behind the music. */
  loop?: { startMs: number; endMs: number } | null;
}

function staffTopFor(view: ScoreView, staff: StaffKind): number {
  return staff === 'treble' ? view.trebleTop : view.bassTop;
}

const GRAND_STAVES = ['treble', 'bass'] as const;
const TREBLE_ONLY = ['treble'] as const;
const BASS_ONLY = ['bass'] as const;

function isGrand(view: ScoreView): boolean {
  return view.staves === undefined || view.staves === 'grand';
}

/** The kinds of staff this view draws, top to bottom. */
function stavesOf(view: ScoreView): readonly StaffKind[] {
  if (isGrand(view)) return GRAND_STAVES;
  return view.staves === 'bass' ? BASS_ONLY : TREBLE_ONLY;
}

/**
 * The staff origins this view draws. A single staff takes the treble slot
 * whichever clef it carries, so the collapsed geometry has only one y to give.
 */
function staffTops(view: ScoreView): readonly number[] {
  return isGrand(view) ? [view.trebleTop, view.bassTop] : [view.trebleTop];
}

/** Whether this view draws `staff` at all. */
function drawsStaff(view: ScoreView, staff: StaffKind): boolean {
  return isGrand(view) || view.staves === staff;
}

/** Bottom line of the lowest staff — where a system ends. */
function systemBottom(view: ScoreView): number {
  return (isGrand(view) ? view.bassTop : view.trebleTop) + STAFF_H;
}

function yForStep(view: ScoreView, staff: StaffKind, step: number): number {
  return staffTopFor(view, staff) + STAFF_H - (step * GAP) / 2;
}

/**
 * First index of `items`, sorted ascending by `at`, whose `at` is at least
 * `value`. Every pass below starts from here rather than walking the take from
 * its first bar each frame: the view is a few seconds wide, the take may be
 * twenty minutes long.
 */
export function firstAtOrAfter<T>(
  items: readonly T[],
  value: number,
  at: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (at(items[mid] as T) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The beams in order of where they start, with the longest one's length.
 * `layout.beams` is in bar order but not time order within a bar — a staff's
 * runs are collected one voice after another — so it cannot be searched as
 * it stands. Built once per layout, which is immutable.
 */
interface BeamIndex {
  ids: number[];
  starts: number[];
  longestMs: number;
}

const beamIndexes = new WeakMap<ScoreLayout, BeamIndex>();

function beamIndexFor(layout: ScoreLayout): BeamIndex {
  const cached = beamIndexes.get(layout);
  if (cached) return cached;
  const startOf = (id: number) =>
    ((layout.beams[id] as BeamGroup).members[0] as ChordGroup).displayStartMs;
  const ids = layout.beams.map((_, id) => id).sort((a, b) => startOf(a) - startOf(b));
  let longestMs = 0;
  for (const beam of layout.beams) {
    const first = beam.members[0] as ChordGroup;
    const last = beam.members[beam.members.length - 1] as ChordGroup;
    longestMs = Math.max(longestMs, last.displayStartMs - first.displayStartMs);
  }
  const index = { ids, starts: ids.map(startOf), longestMs };
  beamIndexes.set(layout, index);
  return index;
}

function xForMs(view: ScoreView, ms: number): number {
  return view.gutterPx + SCORE_LEAD_IN + (ms - view.scrollMs) * view.pxPerMs;
}

/**
 * Where the music drawn under `chrome` ends — where its closing bar line
 * stands, and the span a view fitting the whole of it has to hold.
 *
 * A note that exactly fills its bar spills an empty bar into the layout. The
 * Play page draws it: it is the room a recording carries on into. A lesson view
 * draws the music and not the silence after it, so it ends with the last bar
 * anything is written in.
 */
export function scoreEndMs(layout: ScoreLayout, chrome: ScoreChrome = 'full'): number {
  if (chrome === 'full') return layout.totalMs;
  for (let i = layout.measures.length - 1; i >= 0; i -= 1) {
    const measure = layout.measures[i] as MeasureInfo;
    if (!measure.empty) return measure.endMs;
  }
  return layout.totalMs;
}

/** Half the width of a chord's heads. */
function headHalfWidth(chord: ChordGroup): number {
  return headHalfPx(chord.symbol.base);
}

/**
 * How far a head moves to clear a second. Heads either side of a stem both
 * overlap it, so they sit a head's width less the stem apart; a whole note has
 * no stem, and its heads sit edge to edge.
 */
function secondShiftPx(base: DurationBase): number {
  const width = 2 * headHalfPx(base);
  return base === 'whole' ? width : width - STEM_W_PX;
}

/** How far a stem stands off its head's centre: on the head's edge, just inside it. */
function stemInsetPx(base: DurationBase): number {
  return headHalfPx(base) - STEM_W_PX / 2;
}

/**
 * Where a note's accidental ink ends, left of its chord's leftmost head centre
 * `half` wide. Right-aligned, as on paper, so accidentals of different widths
 * line up on the chord, a column pitch apart.
 */
function accidentalRightPx(note: LaidOutNote, half: number): number {
  return half + ACCIDENTAL_GAP_PX + note.accidentalColumn * ACCIDENTAL_COLUMN_PX;
}

/** How far a note's accidental reaches left of its chord's leftmost head centre. */
function accidentalReachPx(note: LaidOutNote, kind: AccidentalKind, half: number): number {
  return accidentalRightPx(note, half) + glyphWidth(ACCIDENTAL_GLYPHS[kind]) * GAP;
}

/** How far a dot's ink runs right of where it is set: the font's dot. */
const DOT_REACH_PX = MUSIC_GLYPH_METRICS.augmentationDot.bbox[2] * GAP;

/** How far a flag's ink swings out right of its stem's centre line. */
function flagReachPx(count: BeamCount, stemDown: boolean): number {
  const [, , right] = MUSIC_GLYPH_METRICS[flagGlyphFor(count, stemDown)].bbox;
  return right * GAP - STEM_W_PX / 2;
}

/** How far a rest's ink reaches either side of its onset. */
function restReachPx(symbol: DurationSymbol): { left: number; right: number } {
  const { left, right } = restInkG(symbol);
  return { left: left * GAP, right: right * GAP };
}

/** How far a chord's heads reach left of its onset, a displaced one included. */
function headsReachLeft(chord: ChordGroup): number {
  const shift = secondShiftPx(chord.symbol.base);
  return headHalfWidth(chord) - Math.min(...chord.notes.map((note) => note.headShift)) * shift;
}

/** How far a chord's heads reach right of its onset, a displaced one included. */
function headsReachRight(chord: ChordGroup): number {
  const shift = secondShiftPx(chord.symbol.base);
  return Math.max(...chord.notes.map((note) => note.headShift)) * shift + headHalfWidth(chord);
}

/** How far a chord's ink reaches left of its onset: heads, then accidentals. */
function chordReachLeft(chord: ChordGroup): number {
  const half = headHalfWidth(chord);
  const shift = secondShiftPx(chord.symbol.base);
  const leftEdge = Math.min(...chord.notes.map((note) => note.headShift)) * shift;
  let reach = headsReachLeft(chord);
  for (const note of chord.notes) {
    if (!note.accidental) continue;
    reach = Math.max(reach, accidentalReachPx(note, note.accidental, half) - leftEdge);
  }
  return reach;
}

/** How far a chord's ink reaches right of its onset: heads, dots, a flag. */
function chordReachRight(chord: ChordGroup): number {
  const { base } = chord.symbol;
  const rightEdge = Math.max(...chord.notes.map((note) => note.headShift)) * secondShiftPx(base);
  let reach = headsReachRight(chord);
  if (chord.symbol.dotted) {
    reach = Math.max(reach, rightEdge + headHalfPx(base) + DOT_GAP_PX + DOT_REACH_PX);
  }
  const flags = beamCountFor(base);
  if (chord.beamId === null && flags !== 0) {
    const stemX = (chord.stemDown ? -1 : 1) * stemInsetPx(base);
    reach = Math.max(reach, stemX + flagReachPx(flags, chord.stemDown));
  }
  return reach;
}

/**
 * How far each chord's ink reaches left and right of its onset, by index into
 * `layout.chords`: all of it (`chordReachLeft`, `chordReachRight`), and its
 * heads alone. Built once per layout, which is immutable: the rests are placed
 * against it again whenever the spacing changes.
 */
interface ChordReaches {
  left: Float64Array;
  right: Float64Array;
  headLeft: Float64Array;
  headRight: Float64Array;
}

const chordReaches = new WeakMap<ScoreLayout, ChordReaches>();

function chordReachesFor(layout: ScoreLayout): ChordReaches {
  const cached = chordReaches.get(layout);
  if (cached) return cached;
  const reaches = {
    left: Float64Array.from(layout.chords, (chord) => chordReachLeft(chord)),
    right: Float64Array.from(layout.chords, (chord) => chordReachRight(chord)),
    headLeft: Float64Array.from(layout.chords, (chord) => headsReachLeft(chord)),
    headRight: Float64Array.from(layout.chords, (chord) => headsReachRight(chord)),
  };
  chordReaches.set(layout, reaches);
  return reaches;
}

/**
 * The furthest any ink in `layout` reaches from its onset, either way — how far
 * `dividerX` has to look. Accidentals stack into as many columns as a chord
 * needs, so no fixed bound covers them all. Built once per layout, which is
 * immutable.
 */
const widestReaches = new WeakMap<ScoreLayout, number>();

function widestReachPx(layout: ScoreLayout): number {
  const cached = widestReaches.get(layout);
  if (cached !== undefined) return cached;
  let widest = 0;
  const { left, right } = chordReachesFor(layout);
  for (let i = 0; i < left.length; i += 1) {
    widest = Math.max(widest, left[i] as number, right[i] as number);
  }
  for (const rest of layout.rests) {
    const ink = restReachPx(rest.symbol);
    widest = Math.max(widest, ink.left, ink.right);
  }
  widestReaches.set(layout, widest);
  return widest;
}

/** Clear space a rest keeps from the ink either side of it, as an accidental keeps from its head. */
const REST_CLEAR_PX = GAP * 0.25;

/**
 * Where the rests are drawn at one spacing: each one's shift off its onset, in
 * pixels, by index into `layout.rests`, and the largest either way.
 */
interface RestPlacement {
  pxPerMs: number;
  shifts: Float64Array;
  widest: number;
}

const restPlacements = new WeakMap<ScoreLayout, RestPlacement>();

/** How far a rest's ink reaches either side of where it is centred; see `restReachPx`. */
interface RestInk {
  left: number;
  right: number;
}

/** Where a run of rests may stand: after ink ending at `from`, before ink starting at `to`. */
interface Gap {
  from: number;
  to: number;
}

/**
 * A run of rests set in `gap`, each as near its onset as it can stand
 * `REST_CLEAR_PX` clear of the gap's ends and of the rest beside it. A run the
 * gap cannot hold that way is set as close as it goes, in the middle of it, and
 * does not `fit`.
 */
function packRests(
  onsets: readonly number[],
  inks: readonly RestInk[],
  gap: Gap,
): { at: number[]; fits: boolean } {
  const at = [...onsets];
  // Pushed on past the ink before, each rest clear of the last...
  let wall = gap.from + REST_CLEAR_PX;
  at.forEach((x, k) => {
    const ink = inks[k] as RestInk;
    at[k] = Math.max(x, wall + ink.left);
    wall = (at[k] as number) + ink.right + REST_CLEAR_PX;
  });
  // ...then back off the ink after.
  wall = gap.to - REST_CLEAR_PX;
  for (let k = at.length - 1; k >= 0; k -= 1) {
    const ink = inks[k] as RestInk;
    at[k] = Math.min(at[k] as number, wall - ink.right);
    wall = (at[k] as number) - ink.left - REST_CLEAR_PX;
  }
  // Pushed back past where the ink before ends: there is no room.
  if (wall >= gap.from - 1e-9) return { at, fits: true };
  const width = inks.reduce(
    (sum, ink) => sum + ink.left + ink.right + REST_CLEAR_PX,
    -REST_CLEAR_PX,
  );
  let x = (gap.from + gap.to - width) / 2;
  inks.forEach((ink, k) => {
    at[k] = x + ink.left;
    x += ink.left + ink.right + REST_CLEAR_PX;
  });
  return { at, fits: false };
}

/**
 * Where the rests stand at `pxPerMs`.
 *
 * A rest is drawn on its onset, as a note is, wherever the music leaves it
 * `REST_CLEAR_PX` clear of the ink either side: the flag of the note before it,
 * which swings out right past its head, the accidental of the note after it,
 * which hangs back, and the rest beside it. Where the music is packed tighter
 * than that — a fast passage, or any passage zoomed far enough out — the rest
 * moves off its onset, as little as it must. It can: a rest says where the
 * music is not, and nothing reads its x as a time, as the playhead, beams and
 * ties read a note's.
 *
 * Where there is no room at all, the rests go in the middle of what gap there
 * is, and come as near the ink either side alike. Unless that puts one over a
 * head: a rest crossed by a flag or an accidental still reads, and one tucked
 * under a head (the notes are drawn over the rests) does not, so the heads
 * decide, as they do for a bar line in `dividerX`.
 *
 * Only a staff's own music counts. A rest stands where nothing on its staff is
 * sounding, so the notes either side of it on that staff are what it can run
 * into. Built again only when the spacing changes.
 */
function restPlacementFor(layout: ScoreLayout, pxPerMs: number): RestPlacement {
  const cached = restPlacements.get(layout);
  if (cached?.pxPerMs === pxPerMs) return cached;
  const { chords, rests } = layout;
  const reaches = chordReachesFor(layout);
  const shifts = new Float64Array(rests.length);

  /** Place the run of rests `run`: between all the ink either side, or between its heads. */
  const place = (run: readonly number[], ink: Gap, heads: Gap): void => {
    const onsets = run.map((i) => (rests[i] as LaidOutRest).displayStartMs * pxPerMs);
    const inks = run.map((i) => restReachPx((rests[i] as LaidOutRest).symbol));
    const packed = packRests(onsets, inks, ink);
    let { at } = packed;
    if (!packed.fits) {
      // Off whichever head it would cover, where the heads leave the room.
      const least = heads.from - ((at[0] as number) - (inks[0] as RestInk).left);
      const most =
        heads.to - ((at[at.length - 1] as number) + (inks[inks.length - 1] as RestInk).right);
      if (least <= most) {
        const shift = Math.min(Math.max(0, least), most);
        at = at.map((x) => x + shift);
      } else {
        ({ at } = packRests(onsets, inks, heads));
      }
    }
    run.forEach((i, k) => {
      shifts[i] = (at[k] as number) - (onsets[k] as number);
    });
  };

  for (const staff of ['treble', 'bass'] as const) {
    const own = chords.flatMap((chord, i) => (chord.staff === staff ? [i] : []));
    const ownRests = rests.flatMap((rest, i) => (rest.staff === staff ? [i] : []));
    // Where the ink of this staff's chords starts, and their heads, from each
    // one on: a later chord's accidentals can reach back past an earlier one's.
    const inkFrom = new Float64Array(own.length + 1).fill(Number.POSITIVE_INFINITY);
    const headFrom = new Float64Array(own.length + 1).fill(Number.POSITIVE_INFINITY);
    for (let j = own.length - 1; j >= 0; j -= 1) {
      const i = own[j] as number;
      const x = (chords[i] as ChordGroup).displayStartMs * pxPerMs;
      inkFrom[j] = Math.min(inkFrom[j + 1] as number, x - (reaches.left[i] as number));
      headFrom[j] = Math.min(headFrom[j + 1] as number, x - (reaches.headLeft[i] as number));
    }
    let next = 0;
    const until = { ink: Number.NEGATIVE_INFINITY, heads: Number.NEGATIVE_INFINITY };
    for (let r = 0; r < ownRests.length;) {
      const onset = (rests[ownRests[r] as number] as LaidOutRest).displayStartMs;
      for (; next < own.length; next += 1) {
        const i = own[next] as number;
        const ms = (chords[i] as ChordGroup).displayStartMs;
        if (ms >= onset) break;
        until.ink = Math.max(until.ink, ms * pxPerMs + (reaches.right[i] as number));
        until.heads = Math.max(until.heads, ms * pxPerMs + (reaches.headRight[i] as number));
      }
      // The run: every rest before the next chord.
      const nextMs =
        next < own.length ? (chords[own[next] as number] as ChordGroup).displayStartMs : Infinity;
      let end = r + 1;
      while (
        end < ownRests.length &&
        (rests[ownRests[end] as number] as LaidOutRest).displayStartMs < nextMs
      ) {
        end += 1;
      }
      place(
        ownRests.slice(r, end),
        { from: until.ink, to: inkFrom[next] as number },
        { from: until.heads, to: headFrom[next] as number },
      );
      r = end;
    }
  }

  let widest = 0;
  for (const shift of shifts) widest = Math.max(widest, Math.abs(shift));
  const placement = { pxPerMs, shifts, widest };
  restPlacements.set(layout, placement);
  return placement;
}

/**
 * Where a line standing before the music at `ms` is drawn: a bar line, or the
 * edge of a loop.
 *
 * Printed music sets a bar line before the downbeat, with the downbeat's head
 * — and any accidental in front of it — clear to its right. This view is
 * time-proportional, so the downbeat is centred on the bar's own time, and a
 * line drawn there runs through it. The notes keep their onsets, because the
 * playhead, beams, ties, scrubbing and zoom all read x as time; the line moves
 * instead, to the point nearest its time that is clear of the ink on both
 * sides. Nothing on the downbeat, and that is the time itself.
 *
 * Music packed too tightly to leave any clear point gets the middle of what gap
 * there is. Where there is none — a flag swinging out over the downbeat's head
 * — the note heads alone decide: a line through a flag, a dot, an accidental
 * or a rest still reads, and one through a head does not.
 */
function dividerX(view: ScoreView, layout: ScoreLayout, ms: number): number {
  const nominal = xForMs(view, ms);
  // A clef the bar changes to stands just before its line, and needs room.
  const room = clefChangesAt(view, layout, ms) ? INLINE_CLEF_ROOM : 0;
  // The line can stand a reach plus its lead and room off its time, and ink a
  // further reach off that can still touch it; nothing further out can. A rest
  // is measured where it is drawn, which can be off its onset.
  const widest = widestReachPx(layout);
  const rested = restPlacementFor(layout, view.pxPerMs);
  const searchMs =
    (widest * 2 + rested.widest + BAR_LINE_LEAD_PX + BAR_LINE_TRAIL_PX + room) / view.pxPerMs;
  const opens = ms - ON_THE_BAR_MS;
  /**
   * The rightmost ink of what starts before `ms` and the leftmost of the rest:
   * all of it, and the note heads alone.
   */
  const ink = { before: Number.NEGATIVE_INFINITY, after: Number.POSITIVE_INFINITY };
  const heads = { ...ink };
  const reach = (
    startMs: number,
    left: number,
    right: number,
    head?: [number, number],
    shift = 0,
  ) => {
    const x = xForMs(view, startMs) + shift;
    if (startMs < opens) {
      ink.before = Math.max(ink.before, x + right);
      if (head) heads.before = Math.max(heads.before, x + head[1]);
    } else {
      ink.after = Math.min(ink.after, x - left);
      if (head) heads.after = Math.min(heads.after, x - head[0]);
    }
  };

  const { chords, rests } = layout;
  for (let i = firstChordIndexAt(chords, ms - searchMs); i < chords.length; i += 1) {
    const chord = chords[i] as ChordGroup;
    if (chord.displayStartMs > ms + searchMs) break;
    if (!drawsStaff(view, chord.staff)) continue;
    reach(chord.displayStartMs, chordReachLeft(chord), chordReachRight(chord), [
      headsReachLeft(chord),
      headsReachRight(chord),
    ]);
  }
  for (
    let i = firstAtOrAfter(rests, ms - searchMs, (rest) => rest.displayStartMs);
    i < rests.length;
    i += 1
  ) {
    const rest = rests[i] as LaidOutRest;
    if (rest.displayStartMs > ms + searchMs) break;
    if (!drawsStaff(view, rest.staff)) continue;
    // Ink, but not a head: packed tight, a line through a rest still reads.
    const ink = restReachPx(rest.symbol);
    reach(rest.displayStartMs, ink.left, ink.right, undefined, rested.shifts[i] as number);
  }

  // Room for the clef first, where the music leaves it: clear of all the ink,
  // or of the heads at least. Where it does not, the line is placed as any
  // other, and the clef's wash lies under the notes it reaches.
  if (room > 0) {
    for (const { before, after } of [ink, heads]) {
      const lowest = before + BAR_LINE_TRAIL_PX + room;
      const highest = after - BAR_LINE_LEAD_PX;
      if (lowest <= highest) return Math.min(Math.max(nominal, lowest), highest);
    }
  }
  for (const { before, after } of [ink, heads]) {
    const lowest = before + BAR_LINE_TRAIL_PX;
    const highest = after - BAR_LINE_LEAD_PX;
    if (lowest <= highest) return Math.min(Math.max(nominal, lowest), highest);
    if (before < after) return (before + after) / 2;
  }
  return (heads.before + heads.after) / 2;
}

/** Whether a staff this view draws changes clef on a bar starting at `ms`. */
function clefChangesAt(view: ScoreView, layout: ScoreLayout, ms: number): boolean {
  // Looked up a hair late, so a bar whose start is not a whole millisecond is
  // still found from its rounded time.
  const index = measureIndexAt(layout.measures, ms + ON_THE_BAR_MS);
  if (index === null || index === 0) return false;
  const measure = layout.measures[index] as MeasureInfo;
  const previous = layout.measures[index - 1] as MeasureInfo;
  if (Math.abs(measure.startMs - ms) > ON_THE_BAR_MS) return false;
  return stavesOf(view).some((staff) => previous.clefs[staff] !== measure.clefs[staff]);
}

export function drawScore(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  input: ScoreRenderInput,
  palette: ScorePalette,
): void {
  ctx.clearRect(0, 0, view.widthPx, view.heightPx);
  if (input.loop) drawLoop(ctx, view, input.layout, input.loop, palette);
  drawStaffLines(ctx, view, palette);
  drawMeasures(ctx, view, input.layout, palette);
  // A clef change's wash goes under the music: it clears the staff lines
  // behind the clef, and a note it reaches is drawn over it, not erased.
  drawClefChanges(ctx, view, input.layout, palette, 'wash');
  drawRests(ctx, view, input.layout, palette);
  drawPedals(ctx, view, input.layout, palette);
  drawOctaves(ctx, view, input.layout, palette);
  drawDynamics(ctx, view, input.layout, palette);
  drawTies(ctx, view, input.layout, palette);
  // Beams before the chords that hang from them: a stem has to know where its
  // beam ended up before it can reach for it.
  const beamLines = computeBeamLines(view, input.layout);
  drawBeams(ctx, beamLines, palette);
  drawChords(ctx, view, input, palette, beamLines);
  drawOpenNotes(ctx, view, input, palette);
  drawGhosts(ctx, view, input, palette);
  // Clefs go on last: this view is time-proportional, so there is not always
  // room for one, and a clef that gets painted over is worse than one drawn
  // across a note head for a moment.
  drawClefChanges(ctx, view, input.layout, palette, 'clef');
  drawPlayhead(ctx, view, input.playheadMs, palette);
  drawGutter(ctx, view, input, palette);
}

function drawStaffLines(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  palette: ScorePalette,
  fromX = 0,
  toX = view.widthPx,
): void {
  ctx.strokeStyle = palette.staffLine;
  ctx.lineWidth = 1;
  for (const top of staffTops(view)) {
    for (let line = 0; line < 5; line += 1) {
      const y = top + line * GAP + 0.5;
      ctx.beginPath();
      ctx.moveTo(fromX, y);
      ctx.lineTo(toX, y);
      ctx.stroke();
    }
  }
}

function drawMeasures(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  palette: ScorePalette,
): void {
  const fromMs = view.scrollMs - 200;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs + 200;
  ctx.strokeStyle = palette.barLine;
  ctx.fillStyle = palette.measureNumber;
  ctx.font = MARK_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Where the octave lines stand, for a tempo mark to clear; see `tempoMarkRise`.
  const lines = drawsStaff(view, 'treble')
    ? octaveLinesFor(layout, chromeOf(view) === 'full')
    : null;

  const { measures } = layout;
  for (
    let i = firstAtOrAfter(measures, fromMs, (measure) => measure.endMs);
    i < measures.length;
    i += 1
  ) {
    const measure = measures[i] as MeasureInfo;
    if (measure.startMs > toMs) break;
    // A note that exactly fills its bar spills a second, empty measure into the
    // layout — and that measure brings a bar line and a whole rest with it. A
    // bare view draws the music, not the silence around it.
    if (chromeOf(view) !== 'full' && measure.empty) continue;
    const x = Math.round(dividerX(view, layout, measure.startMs)) + 0.5;
    const onset = Math.round(xForMs(view, measure.startMs)) + 0.5;
    // The first bar opens on the clef and time signature, as a printed system
    // does. A line there as well would only stand between them and the first
    // note.
    if (measure.index > 0 && x >= view.gutterPx - 8) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const top of staffTops(view)) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + STAFF_H);
      }
      ctx.stroke();
    }
    // A measure number describes the bar, not the notes — noise when the whole
    // picture is one note being read. It stands at the bar's line, and the
    // first bar, which has none, keeps it over its downbeat: its line's place
    // can fall back into the gutter behind an opening chord's accidentals.
    const numberX = measure.index > 0 ? x : onset;
    if (chromeOf(view) === 'full' && numberX >= view.gutterPx - 8) {
      ctx.fillText(String(measure.index + 1), numberX + 3, view.trebleTop - MEASURE_NUMBER_RISE_PX);
    }
    // A new tempo is announced where it takes over, as on paper: from the
    // downbeat, clear of its head — not from the line, which stands off it.
    // So it shows for as long as the downbeat does, even once the line has
    // gone under the gutter.
    const previous = layout.measures[measure.index - 1];
    if (previous && previous.bpm !== measure.bpm && onset >= view.gutterPx - 8) {
      const rise = lines ? tempoMarkRise(layout, measure, lines) : TEMPO_MARK_RISE_PX;
      drawTempoMark(ctx, onset + 16, view.trebleTop - rise, measure.bpm, palette);
    }
    if (measure.empty) {
      const cx = xForMs(view, (measure.startMs + measure.endMs) / 2);
      if (cx > view.gutterPx && cx < view.widthPx) {
        ctx.fillStyle = palette.rest;
        for (const top of staffTops(view)) {
          drawRestGlyph(ctx, WHOLE_REST, cx, top, WHOLE_REST_STEP, GAP);
        }

        ctx.fillStyle = palette.measureNumber;
      }
    }
  }
  // The closing bar line: the final one where the music ends, a plain one where
  // it only breaks onto the next system.
  const { systemBreakMs } = view;
  const endMs = systemBreakMs ?? scoreEndMs(layout, chromeOf(view));
  const endX = Math.round(dividerX(view, layout, endMs)) + 0.5;
  if (endX > view.gutterPx && endX < view.widthPx + 4) {
    ctx.lineWidth = systemBreakMs === undefined ? 2 : 1;
    ctx.beginPath();
    for (const top of staffTops(view)) {
      ctx.moveTo(endX, top);
      ctx.lineTo(endX, top + STAFF_H);
    }
    ctx.stroke();
  }
}

/**
 * "♩ = bpm" where the tempo changes: the music font's metronome-mark quarter
 * note, its head centred on `x` and its foot a pixel above the baseline, then
 * the number in the measure numbers' type.
 */
function drawTempoMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  bpm: number,
  palette: ScorePalette,
): void {
  ctx.fillStyle = palette.measureNumber;
  const [, bottom] = MUSIC_GLYPH_METRICS.metNoteQuarterUp.bbox;
  drawGlyph(
    ctx,
    'metNoteQuarterUp',
    x - glyphCentre('metNoteQuarterUp') * TEMPO_NOTE_SPACE,
    baseline - 1 + bottom * TEMPO_NOTE_SPACE,
    TEMPO_NOTE_SPACE,
  );
  ctx.fillText(`= ${Math.round(bpm)}`, x + 6, baseline);
}

/**
 * Rests go under the notes, in the dimmer rest ink: they say where the music
 * is not, and a head that happens to land on one should win the pixel. Each
 * stands on its onset where the music leaves it room; see `restPlacementFor`.
 */
function drawRests(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  palette: ScorePalette,
): void {
  const fromMs = view.scrollMs - 400;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs + 400;
  ctx.fillStyle = palette.rest;
  const { rests } = layout;
  const { shifts } = restPlacementFor(layout, view.pxPerMs);
  for (let i = firstAtOrAfter(rests, fromMs, (rest) => rest.displayStartMs); ; i += 1) {
    const rest = rests[i];
    if (!rest || rest.displayStartMs > toMs) break; // sorted by display start
    const x = xForMs(view, rest.displayStartMs) + (shifts[i] as number);
    if (x < view.gutterPx) continue;
    // A rest for a staff this view is not drawing would otherwise land on the
    // one it *is*, measured from the wrong clef.
    if (!drawsStaff(view, rest.staff)) continue;
    drawRestGlyph(ctx, rest.symbol, x, staffTopFor(view, rest.staff), rest.step, GAP);
  }
}

const PEDAL_HOOK_PX = GAP * 0.7;

/**
 * The sustain pedal as a hooked bracket under the bass staff. Recorded takes
 * carry pedal events and imported scores declare them, and until now neither
 * reached the page — for a piano score that is half the performance missing.
 *
 * This view is time-proportional, so a bracket lands exactly under the notes it
 * was held through, and it is clipped to the scrolling region rather than
 * broken across systems.
 */
function drawPedals(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  palette: ScorePalette,
): void {
  if (layout.pedals.length === 0) return;
  const fromMs = view.scrollMs;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs;
  const y = view.pedalRow;
  ctx.strokeStyle = palette.rest;
  ctx.lineWidth = 1.2;

  const { pedals } = layout;
  // Sorted and never overlapping, so their ends are in order too.
  for (let i = firstAtOrAfter(pedals, fromMs, (pedal) => pedal.toMs); ; i += 1) {
    const pedal = pedals[i];
    if (!pedal || pedal.fromMs >= toMs) break; // sorted by start
    if (pedal.toMs <= fromMs) continue;
    const openLeft = pedal.fromMs < fromMs;
    const openRight = pedal.toMs > toMs;
    const x1 = openLeft ? view.gutterPx : xForMs(view, pedal.fromMs);
    const x2 = openRight ? view.widthPx : xForMs(view, pedal.toMs);
    if (x2 <= x1) continue;
    ctx.beginPath();
    if (openLeft) ctx.moveTo(x1, y);
    else {
      ctx.moveTo(x1, y - PEDAL_HOOK_PX);
      ctx.lineTo(x1, y);
    }
    ctx.lineTo(x2, y);
    if (!openRight) ctx.lineTo(x2, y - PEDAL_HOOK_PX);
    ctx.stroke();
  }
}

/**
 * 8va and 8vb lines, above the treble staff and below the bass.
 *
 * A piano reaches far enough past both staves that the alternative is a ladder
 * of ledger lines nobody can count at speed, so the notes are drawn an octave
 * in and the line says to play them an octave away. Each stands clear of what
 * it covers; see `octaveLineRel`.
 */
function drawOctaves(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  palette: ScorePalette,
): void {
  if (layout.octaves.length === 0) return;
  const fromMs = view.scrollMs;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs;
  const lines = octaveLinesFor(layout, chromeOf(view) === 'full');

  ctx.strokeStyle = palette.noteDim;
  ctx.fillStyle = palette.noteDim;

  const { octaves } = layout;
  for (let i = 0; i < octaves.length; i += 1) {
    const octave = octaves[i] as OctaveSpan;
    if (octave.toMs < fromMs) continue;
    if (octave.fromMs >= toMs) break; // sorted by time
    const openLeft = octave.fromMs < fromMs;
    const openRight = octave.toMs > toMs;
    // From the left edge of the first head it covers.
    const x1 = openLeft ? view.gutterPx : xForMs(view, octave.fromMs) - headHalfPx('quarter');
    const x2 = openRight ? view.widthPx : xForMs(view, octave.toMs) + GAP * 1.3;
    if (x2 <= x1) continue;
    if (!drawsStaff(view, octave.staff)) continue;
    const y = staffTopFor(view, octave.staff) + (lines[i] as number);

    let lineFrom = x1;
    if (!openLeft) {
      // The font's label, its ink centred on the line; the line starts clear
      // after it, by its advance.
      const label = octave.up ? 'ottavaAlta' : 'ottavaBassaVb';
      const { advance, bbox } = MUSIC_GLYPH_METRICS[label];
      const middle = (bbox[1] + bbox[3]) / 2;
      drawGlyph(ctx, label, x1, y + middle * OCTAVE_LABEL_SPACE, OCTAVE_LABEL_SPACE);
      lineFrom = x1 + advance * OCTAVE_LABEL_SPACE + GAP * 0.4;
    }
    ctx.save();
    ctx.setLineDash([3, 2.6]);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(lineFrom, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.restore();
    if (!openRight) {
      // The hook turns in as far as the label reaches, and no further, so the
      // mark keeps to the band its place was found for.
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x2, y);
      ctx.lineTo(x2, y + (octave.up ? 1 : -1) * OCTAVE_BAND_HALF_PX);
      ctx.stroke();
    }
  }
}

/** Staff space the dynamic marks are set at. */
const DYNAMIC_SPACE = GAP * 0.9;

/**
 * Dynamic marks and hairpins, between the staves.
 *
 * The velocity behind them has been recorded all along; this is the first time
 * either view has said anything about it. Both draw from the same reading, so
 * the screen and the page agree about where the music swells.
 */
function drawDynamics(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  palette: ScorePalette,
): void {
  if (layout.dynamics.length === 0 && layout.hairpins.length === 0) return;
  const fromMs = view.scrollMs;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs;
  const rowY = view.dynamicsRow;

  ctx.strokeStyle = palette.noteDim;
  ctx.lineWidth = 1.2;
  for (const hairpin of layout.hairpins) {
    if (hairpin.toMs <= fromMs) continue;
    if (hairpin.fromMs >= toMs) break; // sorted by start
    const openLeft = hairpin.fromMs < fromMs;
    const openRight = hairpin.toMs > toMs;
    const x1 = openLeft ? view.gutterPx : xForMs(view, hairpin.fromMs);
    const x2 = openRight ? view.widthPx : xForMs(view, hairpin.toMs);
    if (x2 - x1 < GAP * 2) continue;
    const midY = rowY - GAP * 0.8;
    const closed = hairpin.grow ? x1 : x2;
    const open = hairpin.grow ? x2 : x1;
    ctx.beginPath();
    ctx.moveTo(open, midY - HAIRPIN_MOUTH_PX);
    ctx.lineTo(closed, midY);
    ctx.lineTo(open, midY + HAIRPIN_MOUTH_PX);
    ctx.stroke();
  }

  // Each mark is the font's one glyph for it, its letters kerned as the font
  // sets them, standing on the row and centred on its note by its optical
  // centre rather than its ink.
  ctx.fillStyle = palette.noteDim;
  for (const mark of layout.dynamics) {
    if (mark.atMs < fromMs) continue;
    if (mark.atMs > toMs) break; // sorted by time
    // Centred, one at the very start of the piece reaches back under the
    // gutter — which is painted last, and would swallow it. Nudge it clear.
    const ink = dynamicInkG(mark.mark);
    const x = Math.max(view.gutterPx + ink.left * DYNAMIC_SPACE + 2, xForMs(view, mark.atMs));
    const origin = x - dynamicOpticalCentre(mark.mark) * DYNAMIC_SPACE;
    drawGlyph(ctx, DYNAMIC_GLYPHS[mark.mark], origin, rowY, DYNAMIC_SPACE);
  }
}

/**
 * Ties, under the heads they join. This view is time-proportional and scrolls
 * freely, so a tie is drawn wherever both of its ends happen to be: the pieces
 * of one note are the same staff and the same line, and the layout emits them
 * in order, so pairing them is a matter of remembering the open one.
 */
function drawTies(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  palette: ScorePalette,
): void {
  const fromMs = view.scrollMs - 4000;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs + 400;
  const open = new Map<string, { x: number; y: number; above: boolean; half: number }>();
  ctx.fillStyle = palette.noteDim;

  const { chords } = layout;
  for (let i = firstChordIndexAt(chords, fromMs); i < chords.length; i += 1) {
    const chord = chords[i] as ChordGroup;
    if (chord.displayStartMs > toMs) break; // sorted by display start
    // Same rule as `drawChords`: a single-staff view has one set of staff
    // origins, so a tie from the staff it is not showing would arc across the
    // one it is.
    if (!drawsStaff(view, chord.staff)) continue;
    for (const note of chord.notes) {
      if (!note.tiedFromPrev && !note.tiedToNext) continue;
      const key = `${note.staff}|${note.step}`;
      const above = chord.stemDown;
      const x = xForMs(view, chord.displayStartMs);
      const y = yForStep(view, note.staff, note.step) + (above ? -1 : 1) * GAP * 0.85;
      // From one head's edge to the other's.
      const half = headHalfWidth(chord);
      if (note.tiedFromPrev) {
        const start = open.get(key);
        if (start) {
          open.delete(key);
          drawTieArc(ctx, start.x + start.half, start.y, x - half, y, start.above);
        }
      }
      if (note.tiedToNext) open.set(key, { x, y, above, half });
    }
  }
}

/** A shallow filled crescent, tapering at both ends as an engraved tie does. */
function drawTieArc(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  above: boolean,
): void {
  if (x2 <= x1) return;
  const dir = above ? -1 : 1;
  const depth = dir * Math.min(GAP * 1.1, 0.24 * (x2 - x1) + GAP * 0.35);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(midX, midY + depth, x2, y2);
  ctx.quadraticCurveTo(midX, midY + depth * 0.72, x1, y1);
  ctx.closePath();
  ctx.fill();
}

/** Where a chord's stem stands, and the head the beam springs from. */
function stemXFor(view: ScoreView, chord: ChordGroup): number {
  const inset = stemInsetPx(chord.symbol.base);
  return xForMs(view, chord.displayStartMs) + (chord.stemDown ? -1 : 1) * inset;
}

function beamAnchorY(view: ScoreView, chord: ChordGroup): number {
  const note = chord.stemDown ? chord.notes[0]! : chord.notes[chord.notes.length - 1]!;
  return yForStep(view, chord.staff, note.step);
}

/**
 * Place each beam across the view.
 *
 * Which chords share a beam, and which way they stem, came from the layout —
 * this is only the line they hang on. The run tilts with its outer notes,
 * clamped so it never reads as a ramp, and then shifts bodily outward until
 * the shortest stem in it is still worth calling a stem.
 */
function computeBeamLines(view: ScoreView, layout: ScoreLayout): BeamLines {
  const lines: BeamLines = new Map();
  if (layout.beams.length === 0) return lines;
  const fromMs = view.scrollMs - 2000;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs + 400;

  const index = beamIndexFor(layout);
  for (
    let k = firstAtOrAfter(index.starts, fromMs - index.longestMs, (start) => start);
    k < index.ids.length && (index.starts[k] as number) <= toMs;
    k += 1
  ) {
    const id = index.ids[k] as number;
    const beam = layout.beams[id] as BeamGroup;
    const first = beam.members[0] as ChordGroup;
    const last = beam.members[beam.members.length - 1] as ChordGroup;
    if (last.displayStartMs < fromMs || first.displayStartMs > toMs) continue;
    // A beam belongs to one staff, and a single-staff view collapses `bassTop`
    // onto `trebleTop` — so an unfiltered beam from the other staff would be
    // drawn across the staff that *is* shown. Safe to drop here rather than at
    // paint time: `drawChord` looks its beam up by id and would fall back to a
    // flag, but `drawChords` has already dropped that chord by the same rule,
    // so the lookup never happens.
    if (!drawsStaff(view, first.staff)) continue;

    const xs = beam.members.map((chord) => stemXFor(view, chord));
    const anchors = beam.members.map((chord) => beamAnchorY(view, chord));
    const span = beamSpanFor(xs, anchors, beam.stemDown, GAP, beam.beamCount);
    lines.set(id, {
      x1: xs[0] as number,
      y1: span.y1,
      x2: xs[xs.length - 1] as number,
      y2: span.y2,
      stemDown: beam.stemDown,
      beamCount: beam.beamCount,
      tupletCount: beam.tupletCount,
      xs,
      secondary: beam.secondary,
    });
  }
  return lines;
}

function drawBeams(ctx: CanvasRenderingContext2D, lines: BeamLines, palette: ScorePalette): void {
  ctx.fillStyle = palette.note;
  for (const line of lines.values()) {
    if (line.tupletCount !== null) {
      // The font's tuplet digits, centred on the beam on the side away from
      // the heads, clear of it either way, as on paper. They stand on their
      // origin, so below the beam they go their height lower.
      const midX = (line.x1 + line.x2) / 2;
      const midY = (line.y1 + line.y2) / 2;
      const y = line.stemDown
        ? midY + TUPLET_GAP_PX + TUPLET_DIGIT_TOP_G * TUPLET_SPACE
        : midY - TUPLET_GAP_PX;
      drawDigitRun(ctx, 'tuplet', line.tupletCount, midX, y, TUPLET_SPACE);
    }
    const toward = line.stemDown ? -1 : 1; // further beams stack toward the heads
    const half = BEAM_THICKNESS_PX / 2;
    const segment = (fromX: number, toX: number, level: number): void => {
      const dy = level * toward * BEAM_SPACING_PX;
      const fromY = beamYAt(line, line.x1, line.x2, fromX) + dy;
      const toY = beamYAt(line, line.x1, line.x2, toX) + dy;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY - half);
      ctx.lineTo(toX, toY - half);
      ctx.lineTo(toX, toY + half);
      ctx.lineTo(fromX, fromY + half);
      ctx.closePath();
      ctx.fill();
    };
    segment(line.x1, line.x2, 0);
    line.secondary.forEach((pieces, index) => {
      for (const piece of pieces) {
        const [fromX, toX] = beamPieceXs(line.xs, piece, GAP);
        segment(fromX, toX, index + 1);
      }
    });
  }
}

function drawChords(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  input: ScoreRenderInput,
  palette: ScorePalette,
  beamLines: BeamLines,
): void {
  const { layout, playheadMs } = input;
  const lit = litTest(input);
  const fromMs = view.scrollMs - 2000;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs + 400;
  const start = firstChordIndexAt(layout.chords, fromMs);

  for (let i = start; i < layout.chords.length; i += 1) {
    const chord = layout.chords[i] as ChordGroup;
    if (chord.displayStartMs > toMs) break;
    // A single-staff view collapses `bassTop` onto `trebleTop`, so a chord from
    // the staff this view is *not* showing is not harmlessly off-canvas — it
    // lands on the staff that is, measured from the other clef's reference
    // line, silently a third and a bit away from where it belongs. `drawRests`,
    // `drawOctaves`, `drawTies` and `computeBeamLines` all guard the same way.
    // The last two used to be excused on the grounds that a lesson snippet was
    // whole notes with no ties; the rhythm chapter's beamed eighths ended that.
    if (!drawsStaff(view, chord.staff)) continue;
    drawChord(ctx, view, chord, playheadMs, palette, beamLines, lit);
  }
}

/** Whether a note is lit by the player, as opposed to by the playhead. */
type LitTest = (note: LaidOutNote) => boolean;

const NOTHING_LIT: LitTest = () => false;

function litTest({ litMidis, litNoteIds }: ScoreRenderInput): LitTest {
  if (litNoteIds) return (note) => litNoteIds.has(note.id);
  if (litMidis) return (note) => litMidis.has(note.midi);
  return NOTHING_LIT;
}

function drawChord(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  chord: ChordGroup,
  playheadMs: number,
  palette: ScorePalette,
  beamLines: BeamLines,
  lit: LitTest,
): void {
  const x = xForMs(view, chord.displayStartMs);
  if (x < view.gutterPx - 40) return;

  const { base } = chord.symbol;
  const head = noteheadGlyphFor(base);
  const half = headHalfPx(base);
  const shift = secondShiftPx(base);
  /** From a head's centre back to its glyph's origin. */
  const headOrigin = glyphCentre(head) * GAP;
  /** Where a note's head is centred, once any collision shift is applied. */
  const headX = (note: LaidOutNote): number => x + note.headShift * shift;
  // Accidentals hang off the left of the whole chord and dots off its right:
  // measured from the owning head alone, either would land on top of a head
  // displaced past it.
  const shifts = chord.notes.map((note) => note.headShift);
  const leftEdgeX = x + Math.min(...shifts) * shift;
  const rightEdgeX = x + Math.max(...shifts) * shift;

  // Ledger lines first, behind heads, reaching out to any displaced head.
  ctx.strokeStyle = palette.staffLine;
  ctx.lineWidth = 1;
  for (const note of chord.notes) {
    for (const step of ledgerLineSteps(note.step)) {
      const y = yForStep(view, note.staff, step) + 0.5;
      ctx.beginPath();
      ctx.moveTo(headX(note) - half - 4, y);
      ctx.lineTo(headX(note) + half + 4, y);
      ctx.stroke();
    }
  }

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const note of chord.notes) {
    const y = yForStep(view, note.staff, note.step);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    // Two independent reasons a head lights, kept named apart rather than
    // folded together: the cursor is inside it, or the user is holding it.
    const sounding = playheadMs >= note.startMs && playheadMs < note.startMs + note.durationMs;
    const held = lit(note);
    // A head, its accidental and its dot light; the stem, flag and beam
    // belong to the whole chord, and stay in ink.
    ctx.fillStyle = sounding || held ? palette.highlight : palette.note;

    // The font's head, a hollow one's hole and all, filled like any other.
    drawGlyph(ctx, head, headX(note) - headOrigin, y, GAP);
    if (note.accidental) {
      // Right-aligned before the chord, so its ink ends where its column does.
      const name = ACCIDENTAL_GLYPHS[note.accidental];
      const right = leftEdgeX - accidentalRightPx(note, half);
      const centre = right - (MUSIC_GLYPH_METRICS[name].bbox[2] - glyphCentre(name)) * GAP;
      drawAccidentalGlyph(ctx, note.accidental, centre, y, GAP);
    }
    if (chord.symbol.dotted) {
      // Dots sit in a space: a note on a line has its dot moved up half a space.
      const dotY = y - (note.step % 2 === 0 ? GAP / 2 : 0);
      drawGlyph(ctx, 'augmentationDot', rightEdgeX + half + DOT_GAP_PX, dotY, GAP);
    }
  }

  // Stem and flag (whole notes have neither). A beamed chord stems to its beam
  // and takes no flag — the beam is the flag, shared.
  if (base === 'whole') return;
  const beam = chord.beamId === null ? undefined : beamLines.get(chord.beamId);
  const sx = x + (chord.stemDown ? -1 : 1) * stemInsetPx(base);
  // The stem starts where the far head's stem anchor says, meeting its edge.
  const rise = STEM_ANCHOR_RISE_G * GAP;
  const headEnd = chord.stemDown ? minY + rise : maxY - rise;
  const flags = beamCountFor(base);
  // A 32nd's and a 64th's flags stack up past a normal stem's end, and their
  // anchors say how much further the stem has to run to meet them.
  const stemPx = flaggedStemG(flags, chord.stemDown) * GAP;
  const tipY = beam
    ? beamYAt(beam, beam.x1, beam.x2, sx)
    : chord.stemDown
      ? maxY + stemPx
      : minY - stemPx;

  ctx.strokeStyle = palette.note;
  ctx.lineWidth = STEM_W_PX;
  ctx.beginPath();
  ctx.moveTo(sx, headEnd);
  ctx.lineTo(sx, tipY);
  ctx.stroke();
  if (!beam && flags !== 0) {
    // One glyph carries all of a note's flags, hanging from the tip back
    // toward the head as on paper: its origin on the stem's left edge, as far
    // short of the tip as its anchor says.
    ctx.fillStyle = palette.note;
    drawGlyph(
      ctx,
      flagGlyphFor(flags, chord.stemDown),
      sx - STEM_W_PX / 2,
      tipY + flagAnchorYG(flags, chord.stemDown) * GAP,
      GAP,
    );
  }
}

/**
 * Where a note not laid out yet is drawn — a key held while recording, or the
 * ghost of one just played — on the line the key spells it on, so it does not
 * jump to another when the layout takes it over.
 */
function previewPosition(midi: number, input: ScoreRenderInput): StaffPosition {
  const fifths = normalizeFifths(input.keySignature);
  const spelled = spellInKey(midi, { fifths, mode: input.layout.keyMode });
  return midiToStaffPosition(midi, undefined, undefined, fifths, spelled);
}

/** From a black head's centre back to its glyph's origin. */
const BLACK_HEAD_ORIGIN_PX = glyphCentre('noteheadBlack') * GAP;

function drawOpenNotes(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  input: ScoreRenderInput,
  palette: ScorePalette,
): void {
  const { openNotes, recording } = input;
  if (!recording || openNotes.length === 0) return;
  for (const open of openNotes) {
    const position = previewPosition(open.midi, input);
    const y = yForStep(view, position.staff, position.step);
    const x = xForMs(view, open.startMs);
    const width = Math.max(6, open.durationMs * view.pxPerMs);
    // Extension bar shows the note is still held.
    ctx.fillStyle = palette.recordWash;
    ctx.fillRect(x, y - 3, width, 6);
    ctx.fillStyle = palette.record;
    drawGlyph(ctx, 'noteheadBlack', x - BLACK_HEAD_ORIGIN_PX, y, GAP);
  }
}

function drawGhosts(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  input: ScoreRenderInput,
  palette: ScorePalette,
): void {
  if (input.ghosts.length === 0) return;
  const x = Math.max(view.gutterPx + 14, xForMs(view, input.playheadMs));
  for (const ghost of input.ghosts) {
    const position = previewPosition(ghost.midi, input);
    const y = yForStep(view, position.staff, position.step);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, ghost.life));
    ctx.strokeStyle = palette.staffLine;
    for (const step of ledgerLineSteps(position.step)) {
      const ly = yForStep(view, position.staff, step) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x - GAP, ly);
      ctx.lineTo(x + GAP, ly);
      ctx.stroke();
    }
    ctx.fillStyle = palette.ghost;
    drawGlyph(ctx, 'noteheadBlack', x - BLACK_HEAD_ORIGIN_PX, y, GAP);
    ctx.restore();
  }
}

/** A wash behind the passage a loop repeats, with a line at each end. */
function drawLoop(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  loop: { startMs: number; endMs: number },
  palette: ScorePalette,
): void {
  // Each end stands where a bar line would: before the notes that start on it,
  // so the wash holds exactly the notes the loop plays. A loop from bar to bar
  // then runs from bar line to bar line, instead of through both downbeats.
  const startX = Math.round(dividerX(view, layout, loop.startMs)) + 0.5;
  const endX = Math.round(dividerX(view, layout, loop.endMs)) + 0.5;
  const left = Math.max(view.gutterPx, startX);
  const right = Math.min(view.widthPx, endX);
  if (right <= left) return;
  const top = view.trebleTop - 22;
  const bottom = systemBottom(view) + 12;
  ctx.fillStyle = palette.loopWash;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.strokeStyle = palette.loopEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of [startX, endX]) {
    if (x < view.gutterPx || x > view.widthPx) continue;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  ctx.stroke();
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  playheadMs: number,
  palette: ScorePalette,
): void {
  const x = xForMs(view, playheadMs);
  if (x < view.gutterPx - 2 || x > view.widthPx + 2) return;
  ctx.strokeStyle = palette.playhead;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, view.trebleTop - 16);
  ctx.lineTo(x, systemBottom(view) + 12);
  ctx.stroke();
  ctx.fillStyle = palette.playhead;
  ctx.beginPath();
  ctx.moveTo(x - 5, view.trebleTop - 22);
  ctx.lineTo(x + 5, view.trebleTop - 22);
  ctx.lineTo(x, view.trebleTop - 13);
  ctx.closePath();
  ctx.fill();
}

/** Room an inline clef takes, and the gap it keeps off the bar line. */
const INLINE_CLEF_W = 22;
const INLINE_CLEF_PAD = 3;
/** How far back from its bar line an inline clef's wash reaches. */
const INLINE_CLEF_ROOM = INLINE_CLEF_W + INLINE_CLEF_PAD + 2;
/** How wide the wash behind an inline clef is. */
const INLINE_CLEF_WASH_W = INLINE_CLEF_W + 4;

/** The line a clef is set on: a G clef's G line, an F clef's F line. */
function clefLineY(clef: ClefKind, staffTop: number): number {
  return clef === 'treble' ? staffTop + STAFF_H - GAP : staffTop + GAP;
}

/**
 * A clef announced mid-score: the font's change clef, smaller than the
 * gutter's, centred in its wash and seated on the line it names.
 *
 * It sits in the tail of the measure, just before the bar line, which is where
 * printed music puts a clef that changes on a bar line. Paper widens the bar
 * to make room for it; a time-proportional bar cannot, so the line makes what
 * room the music leaves (see `dividerX`), and the rest is drawn in two parts.
 * The wash, which clears the staff lines behind the clef, goes down under the
 * music, so it never hides a note. The clef itself goes on top of everything.
 */
function drawInlineClef(
  ctx: CanvasRenderingContext2D,
  clef: ClefKind,
  barX: number,
  staffTop: number,
  palette: ScorePalette,
  part: ClefPart,
): void {
  const washX = barX - INLINE_CLEF_ROOM;
  if (part === 'wash') {
    ctx.fillStyle = palette.gutterBg;
    ctx.fillRect(washX, staffTop - 3, INLINE_CLEF_WASH_W, STAFF_H + 6);
    return;
  }
  const name = clefGlyphFor(clef, true);
  const centre = washX + INLINE_CLEF_WASH_W / 2;
  ctx.fillStyle = palette.noteDim;
  drawGlyph(ctx, name, centre - glyphCentre(name) * GAP, clefLineY(clef, staffTop), GAP);
}

/** An inline clef is drawn in two passes: its wash, then the clef. */
type ClefPart = 'wash' | 'clef';

/** Announce every clef that turns over inside the visible span. */
function drawClefChanges(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  palette: ScorePalette,
  part: ClefPart,
): void {
  const fromMs = view.scrollMs - 200;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs + 200;
  const { measures } = layout;
  for (
    let i = firstAtOrAfter(measures, fromMs, (measure) => measure.endMs);
    i < measures.length;
    i += 1
  ) {
    const measure = measures[i] as MeasureInfo;
    if (measure.startMs > toMs) break;
    const previous = measures[measure.index - 1];
    if (!previous) continue;
    if (stavesOf(view).every((staff) => previous.clefs[staff] === measure.clefs[staff])) continue;
    const x = Math.round(dividerX(view, layout, measure.startMs)) + 0.5;
    if (x < view.gutterPx + INLINE_CLEF_W || x > view.widthPx) continue;
    for (const staff of stavesOf(view)) {
      if (previous.clefs[staff] === measure.clefs[staff]) continue;
      drawInlineClef(ctx, measure.clefs[staff], x, staffTopFor(view, staff), palette, part);
    }
  }
}

/** The clef each staff reads under at `ms`, or the nearest one either side. */
function clefsAt(layout: ScoreLayout, ms: number): Record<StaffKind, ClefKind> {
  const index = measureIndexAt(layout.measures, ms);
  const measure =
    index !== null
      ? layout.measures[index]
      : ms < 0
        ? layout.measures[0]
        : layout.measures[layout.measures.length - 1];
  return measure?.clefs ?? { treble: defaultClefFor('treble'), bass: defaultClefFor('bass') };
}

/** Where the gutter's clefs start, after the system line. */
const GUTTER_CLEF_X = 8;
/** Where the wider of the gutter's two clefs ends. */
const GUTTER_CLEF_RIGHT_PX =
  GUTTER_CLEF_X +
  Math.max(...(['gClef', 'fClef'] as const).map((name) => MUSIC_GLYPH_METRICS[name].bbox[2])) * GAP;

/** The clef a staff reads under, at the gutter's start: the font's full-size clef. */
function drawGutterClef(ctx: CanvasRenderingContext2D, clef: ClefKind, staffTop: number): void {
  drawGlyph(ctx, clefGlyphFor(clef, false), GUTTER_CLEF_X, clefLineY(clef, staffTop), GAP);
}

/** Where the key signature's `i`th accidental is centred. */
function keyAccidentalX(i: number): number {
  return GUTTER - 22 + (i + 0.5) * KEY_ACCIDENTAL_PX;
}

/** How far in from the gutter's edge the time signature is centred. */
const TIME_SIG_INSET_PX = 14;
/** Clear space the time signature keeps from what stands before it, and from the edge. */
const TIME_SIG_CLEAR_PX = GAP * 0.3;
/** The smallest the time signature is ever set, as a share of its full size. */
const TIME_SIG_MIN_SCALE = 0.5;

/**
 * The staff space the time signature's digits are set at: full size where
 * each number fits between what stands before it — the clefs, or the key
 * signature — and the gutter's edge, and evenly smaller where one does not.
 * So a 12/8 shrinks, rather than the gutter growing: the gutter's width is
 * what the Play page scrolls under and what Learn fits its bars to.
 */
function timeSignatureSpace(gutterPx: number, fifths: number, meter: TimeSignature): number {
  let before = GUTTER_CLEF_RIGHT_PX;
  const count = Math.abs(fifths);
  if (count > 0) {
    const sign = ACCIDENTAL_GLYPHS[signatureAccidental(fifths)];
    before = Math.max(before, keyAccidentalX(count - 1) + (glyphWidth(sign) / 2) * GAP);
  }
  const centre = gutterPx - TIME_SIG_INSET_PX;
  const room = 2 * Math.min(centre - before, gutterPx - centre) - 2 * TIME_SIG_CLEAR_PX;
  const widest = Math.max(
    runAdvance(digitGlyphsFor('timeSig', meter.numerator)),
    runAdvance(digitGlyphsFor('timeSig', meter.denominator)),
  );
  return GAP * Math.min(1, Math.max(TIME_SIG_MIN_SCALE, room / (widest * GAP)));
}

function drawGutter(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  input: ScoreRenderInput,
  palette: ScorePalette,
): void {
  const { timeSignature } = input;
  ctx.fillStyle = palette.gutterBg;
  ctx.fillRect(0, 0, view.gutterPx, view.heightPx);
  // The fill is for Play's score, which scrolls beneath the gutter: music
  // going by must not show through the clef. A lesson's staff stands still,
  // and there the fill hid nothing but the lines the clef and the key
  // signature are read against — and which line a sharp sits on is all a
  // signature says. So they go back in, from the system's edge.
  if (chromeOf(view) !== 'full') {
    drawStaffLines(ctx, view, palette, SYSTEM_LINE_X, view.gutterPx);
  }
  ctx.strokeStyle = palette.barLine;
  ctx.lineWidth = 1.4;
  // System bar line joining the staffs at the left edge.
  ctx.beginPath();
  ctx.moveTo(SYSTEM_LINE_X, view.trebleTop);
  ctx.lineTo(SYSTEM_LINE_X, systemBottom(view));
  ctx.stroke();

  // Clefs, key signature and time signature: all the font's, in the dimmer ink.
  ctx.fillStyle = palette.noteDim;

  // The gutter sits over the music, so it has to name the clef in force where
  // the view actually starts — not the one the piece opened with.
  const clefs = clefsAt(input.layout, view.scrollMs);
  for (const staff of stavesOf(view)) {
    drawGutterClef(ctx, clefs[staff], staffTopFor(view, staff));
  }

  // Key signature between the clef and the time signature, read under
  // whichever clef each staff currently carries.
  const fifths = normalizeFifths(input.keySignature);
  if (fifths !== 0) {
    const sign = signatureAccidental(fifths);
    for (const staff of stavesOf(view)) {
      const top = staffTopFor(view, staff);
      const steps = signatureSteps(fifths, clefs[staff]);
      for (let i = 0; i < steps.length; i += 1) {
        const y = top + STAFF_H - ((steps[i] as number) * GAP) / 2;
        drawAccidentalGlyph(ctx, sign, keyAccidentalX(i), y, GAP);
      }
    }
  }

  // Time signature on every staff drawn. Like the measure number, it describes
  // the bar rather than the note, so a bare view leaves it off. Each number is
  // a row of digits centred on its half of the staff, so a 12 sits as
  // squarely as a 4.
  if (chromeOf(view) !== 'bare') {
    const space = timeSignatureSpace(view.gutterPx, fifths, timeSignature);
    const x = view.gutterPx - TIME_SIG_INSET_PX;
    for (const top of staffTops(view)) {
      drawDigitRun(ctx, 'timeSig', timeSignature.numerator, x, top + GAP, space);
      drawDigitRun(ctx, 'timeSig', timeSignature.denominator, x, top + 3 * GAP, space);
    }
  }
}

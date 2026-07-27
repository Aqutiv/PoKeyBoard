import type { TimeSignature } from '@/domain/takeTypes';
import { drawAccidentalGlyph } from './accidentalGlyph';
import {
  beamSpanFor,
  beamYAt,
  BEAM_SPACING_G,
  BEAM_THICKNESS_G,
  STEM_LENGTH_G,
} from './beamGeometry';
import { normalizeFifths, signatureAccidental, signatureSteps } from './keySignature';
import {
  firstChordIndexAt,
  measureIndexAt,
  type BeamGroup,
  type ChordGroup,
  type LaidOutNote,
  type ScoreLayout,
} from './notationLayout';
import type { DurationSymbol } from './quantization';
import { drawRestGlyph } from './restGlyph';
import { restStep } from './rests';
import {
  defaultClefFor,
  ledgerLineSteps,
  midiToStaffPosition,
  type ClefKind,
  type StaffKind,
} from './staffMapping';

/** Staff geometry (CSS pixels; the canvas is DPR-scaled by the component). */
export const GAP = 9;
export const STAFF_H = GAP * 4;
export const TREBLE_TOP = 34;
export const STAFF_SPACING = 48;
export const BASS_TOP = TREBLE_TOP + STAFF_H + STAFF_SPACING;
export const SCORE_MIN_HEIGHT = BASS_TOP + STAFF_H + 38;
/**
 * Gutter: brace, clefs, key signature and time signature; notes scroll beneath
 * it. `GUTTER` is what it takes in C major, and a key signature widens it —
 * seven accidentals need somewhere to go, and the alternative is drawing them
 * over the music.
 */
export const GUTTER = 58;
/** Horizontal pitch of the accidentals in the gutter's key signature. */
const KEY_ACCIDENTAL_PX = GAP * 1.05;

export function gutterWidthFor(fifths: number): number {
  const count = Math.abs(normalizeFifths(fifths));
  return count === 0 ? GUTTER : GUTTER + count * KEY_ACCIDENTAL_PX + GAP * 0.6;
}

/** Horizontal pitch of stacked accidental columns, left of the chord. */
const ACCIDENTAL_COLUMN_PX = GAP * 1.4;

// Beam proportions come from `beamGeometry`, so a run groups and slants the
// same way on screen as it does on paper — only the unit differs.
const STEM_LENGTH_PX = GAP * STEM_LENGTH_G;
const BEAM_THICKNESS_PX = GAP * BEAM_THICKNESS_G;
const BEAM_SPACING_PX = GAP * BEAM_SPACING_G;
/** Stem x offset from the head centre, inset from the head edge. */
const STEM_INSET_PX = GAP * 0.64 - 0.8;

/** One beam's line across the view, in pixels; keyed by `ChordGroup.beamId`. */
interface BeamLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stemDown: boolean;
  beamCount: 1 | 2;
  tupletCount: number | null;
}
type BeamLines = Map<number, BeamLine>;

/** What a bar of silence takes, whatever the meter is. */
const WHOLE_REST: DurationSymbol = { base: 'whole', dotted: false };
const WHOLE_REST_STEP = restStep(WHOLE_REST);

/** Clearance above/below an extreme note head: half-height plus padding. */
const HEAD_CLEARANCE = GAP * 0.5 + 6;
/** Least room the pedal bracket keeps under the bass staff. */
const PEDAL_ROW_PX = 15;
/** Extra room between the staves when the take carries dynamics. */
const DYNAMICS_ROW_PX = 14;
/** Half-height of a hairpin's open end. */
const HAIRPIN_MOUTH_PX = GAP * 0.55;
/** Bottom margin below the bass staff at the default geometry. */
const BOTTOM_MARGIN = SCORE_MIN_HEIGHT - BASS_TOP - STAFF_H;

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

/**
 * Content-aware vertical geometry: the staves shift down and the view grows
 * only when the take reaches far enough beyond the staves that the default
 * margins would clip note heads. Stems point toward the staff on extreme
 * notes, so heads and their ledger lines set the required clearance. Takes
 * in the normal range get exactly the default constants.
 */
export function computeScoreGeometry(
  chords: readonly ChordGroup[],
  hasDynamics = false,
): ScoreGeometry {
  let maxTrebleStep = Number.NEGATIVE_INFINITY;
  let minBassStep = Number.POSITIVE_INFINITY;
  for (const chord of chords) {
    for (const note of chord.notes) {
      if (note.staff === 'treble') maxTrebleStep = Math.max(maxTrebleStep, note.step);
      else minBassStep = Math.min(minBassStep, note.step);
    }
  }
  const topExtent =
    maxTrebleStep === Number.NEGATIVE_INFINITY
      ? 0
      : (maxTrebleStep * GAP) / 2 - STAFF_H + HEAD_CLEARANCE;
  const trebleTop = Math.max(TREBLE_TOP, Math.ceil(topExtent));
  // Nothing else reserves the gap between the staves, so a take with dynamics
  // opens it up for them; one without keeps the geometry it always had.
  const staffSpacing = STAFF_SPACING + (hasDynamics ? DYNAMICS_ROW_PX : 0);
  const bassTop = trebleTop + STAFF_H + staffSpacing;
  const bottomExtent =
    minBassStep === Number.POSITIVE_INFINITY
      ? BOTTOM_MARGIN
      : Math.max(BOTTOM_MARGIN, Math.ceil((-minBassStep * GAP) / 2 + HEAD_CLEARANCE));
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
    gutterBg: 'rgba(29, 25, 22, 0.96)',
    measureNumber: '#7d7466',
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
    gutterBg: 'rgba(255, 253, 248, 0.96)',
    measureNumber: '#99917e',
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
}

function staffTopFor(view: ScoreView, staff: StaffKind): number {
  return staff === 'treble' ? view.trebleTop : view.bassTop;
}

function yForStep(view: ScoreView, staff: StaffKind, step: number): number {
  return staffTopFor(view, staff) + STAFF_H - (step * GAP) / 2;
}

function xForMs(view: ScoreView, ms: number): number {
  return view.gutterPx + (ms - view.scrollMs) * view.pxPerMs;
}

export function drawScore(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  input: ScoreRenderInput,
  palette: ScorePalette,
): void {
  ctx.clearRect(0, 0, view.widthPx, view.heightPx);
  drawStaffLines(ctx, view, palette);
  drawMeasures(ctx, view, input.layout, palette);
  drawRests(ctx, view, input.layout, palette);
  drawPedals(ctx, view, input.layout, palette);
  drawDynamics(ctx, view, input.layout, palette);
  drawTies(ctx, view, input.layout, palette);
  // Beams before the chords that hang from them: a stem has to know where its
  // beam ended up before it can reach for it.
  const beamLines = computeBeamLines(view, input.layout);
  drawBeams(ctx, beamLines, palette);
  drawChords(ctx, view, input, palette, beamLines);
  drawOpenNotes(ctx, view, input.openNotes, input.recording, palette);
  drawGhosts(ctx, view, input, palette);
  // Clefs go on last: this view is time-proportional, so nothing can reserve
  // room for one, and a clef that gets painted over is worse than one that
  // covers a note head for a moment.
  drawClefChanges(ctx, view, input.layout, palette);
  drawPlayhead(ctx, view, input.playheadMs, palette);
  drawGutter(ctx, view, input, palette);
}

function drawStaffLines(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  palette: ScorePalette,
): void {
  ctx.strokeStyle = palette.staffLine;
  ctx.lineWidth = 1;
  for (const top of [view.trebleTop, view.bassTop]) {
    for (let line = 0; line < 5; line += 1) {
      const y = top + line * GAP + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(view.widthPx, y);
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
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  for (const measure of layout.measures) {
    if (measure.endMs < fromMs || measure.startMs > toMs) continue;
    const x = Math.round(xForMs(view, measure.startMs)) + 0.5;
    if (x >= view.gutterPx - 8) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, view.trebleTop);
      ctx.lineTo(x, view.trebleTop + STAFF_H);
      ctx.moveTo(x, view.bassTop);
      ctx.lineTo(x, view.bassTop + STAFF_H);
      ctx.stroke();
      ctx.fillText(String(measure.index + 1), x + 3, view.trebleTop - 8);
      // A new tempo is announced where it takes over, as on paper.
      const previous = layout.measures[measure.index - 1];
      if (previous && previous.bpm !== measure.bpm) {
        drawTempoMark(ctx, x + 16, view.trebleTop - 20, measure.bpm, palette);
        ctx.strokeStyle = palette.barLine;
      }
    }
    if (measure.empty) {
      const cx = xForMs(view, (measure.startMs + measure.endMs) / 2);
      if (cx > view.gutterPx && cx < view.widthPx) {
        ctx.fillStyle = palette.rest;
        for (const top of [view.trebleTop, view.bassTop]) {
          drawRestGlyph(ctx, WHOLE_REST, cx, top, WHOLE_REST_STEP, GAP);
        }
        ctx.fillStyle = palette.measureNumber;
      }
    }
  }
  // Final bar line at the layout end.
  const endX = Math.round(xForMs(view, layout.totalMs)) + 0.5;
  if (endX > view.gutterPx && endX < view.widthPx + 4) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(endX, view.trebleTop);
    ctx.lineTo(endX, view.trebleTop + STAFF_H);
    ctx.moveTo(endX, view.bassTop);
    ctx.lineTo(endX, view.bassTop + STAFF_H);
    ctx.stroke();
  }
}

/**
 * "♩ = bpm" where the tempo changes. The quarter note is drawn rather than
 * typeset: the score canvas uses no music font.
 */
function drawTempoMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  bpm: number,
  palette: ScorePalette,
): void {
  ctx.fillStyle = palette.measureNumber;
  ctx.strokeStyle = palette.measureNumber;
  ctx.save();
  ctx.translate(x, baseline - 2.5);
  ctx.rotate(-0.32);
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.8, 2.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 2.6, baseline - 3.2);
  ctx.lineTo(x + 2.6, baseline - 11);
  ctx.stroke();
  ctx.fillText(`= ${Math.round(bpm)}`, x + 6, baseline);
}

/**
 * Rests go under the notes, in the dimmer rest ink: they say where the music
 * is not, and a head that happens to land on one should win the pixel.
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
  ctx.strokeStyle = palette.rest;
  for (const rest of layout.rests) {
    if (rest.displayStartMs < fromMs) continue;
    if (rest.displayStartMs > toMs) break; // sorted by display start
    const x = xForMs(view, rest.displayStartMs);
    if (x < view.gutterPx) continue;
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

  for (const pedal of layout.pedals) {
    if (pedal.toMs <= fromMs) continue;
    if (pedal.fromMs >= toMs) break; // sorted by start
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

  ctx.fillStyle = palette.noteDim;
  ctx.font = `bold italic ${GAP * 2.1}px Georgia, "Times New Roman", Times, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const mark of layout.dynamics) {
    if (mark.atMs < fromMs) continue;
    if (mark.atMs > toMs) break; // sorted by time
    // Marks are centred, so one at the very start of the piece sits half under
    // the gutter — which is painted last, and would swallow it. Nudge it clear.
    const x = Math.max(view.gutterPx + GAP * 1.2, xForMs(view, mark.atMs));
    ctx.fillText(mark.mark, x, rowY);
  }
  ctx.textAlign = 'left';
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
  const open = new Map<string, { x: number; y: number; above: boolean }>();
  ctx.fillStyle = palette.noteDim;

  for (const chord of layout.chords) {
    if (chord.displayStartMs < fromMs) continue;
    if (chord.displayStartMs > toMs) break; // sorted by display start
    for (const note of chord.notes) {
      if (!note.tiedFromPrev && !note.tiedToNext) continue;
      const key = `${note.staff}|${note.step}`;
      const above = chord.stemDown;
      const x = xForMs(view, chord.displayStartMs);
      const y = yForStep(view, note.staff, note.step) + (above ? -1 : 1) * GAP * 0.85;
      if (note.tiedFromPrev) {
        const start = open.get(key);
        if (start) {
          open.delete(key);
          drawTieArc(ctx, start.x + GAP * 0.64, start.y, x - GAP * 0.64, y, start.above);
        }
      }
      if (note.tiedToNext) open.set(key, { x, y, above });
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
  return xForMs(view, chord.displayStartMs) + (chord.stemDown ? -1 : 1) * STEM_INSET_PX;
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

  for (let id = 0; id < layout.beams.length; id += 1) {
    const beam = layout.beams[id] as BeamGroup;
    const first = beam.members[0] as ChordGroup;
    const last = beam.members[beam.members.length - 1] as ChordGroup;
    if (last.displayStartMs < fromMs || first.displayStartMs > toMs) continue;

    const xs = beam.members.map((chord) => stemXFor(view, chord));
    const anchors = beam.members.map((chord) => beamAnchorY(view, chord));
    const span = beamSpanFor(xs, anchors, beam.stemDown, GAP);
    lines.set(id, {
      x1: xs[0] as number,
      y1: span.y1,
      x2: xs[xs.length - 1] as number,
      y2: span.y2,
      stemDown: beam.stemDown,
      beamCount: beam.beamCount,
      tupletCount: beam.tupletCount,
    });
  }
  return lines;
}

function drawBeams(ctx: CanvasRenderingContext2D, lines: BeamLines, palette: ScorePalette): void {
  ctx.fillStyle = palette.note;
  for (const line of lines.values()) {
    if (line.tupletCount !== null) {
      // The numeral goes on the side away from the heads, as on paper.
      const midX = (line.x1 + line.x2) / 2;
      const midY = (line.y1 + line.y2) / 2;
      ctx.font = `italic 600 ${GAP * 1.7}px Georgia, "Times New Roman", Times, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(line.tupletCount), midX, midY + (line.stemDown ? GAP * 1.5 : -GAP * 0.8));
      ctx.textAlign = 'left';
    }
    const toward = line.stemDown ? -1 : 1; // further beams stack toward the heads
    for (let i = 0; i < line.beamCount; i += 1) {
      const dy = i * toward * BEAM_SPACING_PX;
      const half = BEAM_THICKNESS_PX / 2;
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1 + dy - half);
      ctx.lineTo(line.x2, line.y2 + dy - half);
      ctx.lineTo(line.x2, line.y2 + dy + half);
      ctx.lineTo(line.x1, line.y1 + dy + half);
      ctx.closePath();
      ctx.fill();
    }
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
  const fromMs = view.scrollMs - 2000;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs + 400;
  const start = firstChordIndexAt(layout.chords, fromMs);

  for (let i = start; i < layout.chords.length; i += 1) {
    const chord = layout.chords[i] as ChordGroup;
    if (chord.displayStartMs > toMs) break;
    drawChord(ctx, view, chord, playheadMs, palette, beamLines);
  }
}

function drawChord(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  chord: ChordGroup,
  playheadMs: number,
  palette: ScorePalette,
  beamLines: BeamLines,
): void {
  const x = xForMs(view, chord.displayStartMs);
  if (x < view.gutterPx - 40) return;

  const rx = GAP * 0.64;
  const ry = GAP * 0.5;
  const hollow = chord.symbol.base === 'whole' || chord.symbol.base === 'half';
  /** Where a note's head sits, once any collision shift is applied. */
  const headX = (note: LaidOutNote): number => x + note.headShift * 2 * rx;
  // Accidentals hang off the left of the whole chord and dots off its right:
  // measured from the owning head alone, either would land on top of a head
  // displaced past it.
  const shifts = chord.notes.map((note) => note.headShift);
  const leftEdgeX = x + Math.min(...shifts) * 2 * rx;
  const rightEdgeX = x + Math.max(...shifts) * 2 * rx;

  // Ledger lines first, behind heads, reaching out to any displaced head.
  ctx.strokeStyle = palette.staffLine;
  ctx.lineWidth = 1;
  for (const note of chord.notes) {
    for (const step of ledgerLineSteps(note.step)) {
      const y = yForStep(view, note.staff, step) + 0.5;
      ctx.beginPath();
      ctx.moveTo(headX(note) - rx - 4, y);
      ctx.lineTo(headX(note) + rx + 4, y);
      ctx.stroke();
    }
  }

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const note of chord.notes) {
    const y = yForStep(view, note.staff, note.step);
    const hx = headX(note);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    const sounding = playheadMs >= note.startMs && playheadMs < note.startMs + note.durationMs;
    const color = sounding ? palette.highlight : palette.note;

    ctx.save();
    ctx.translate(hx, y);
    ctx.rotate(-0.32);
    ctx.beginPath();
    ctx.ellipse(0, 0, chord.symbol.base === 'whole' ? rx * 1.25 : rx, ry, 0, 0, Math.PI * 2);
    if (hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();

    if (note.accidental) {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      drawAccidentalGlyph(
        ctx,
        note.accidental,
        leftEdgeX - rx - GAP * 0.7 - note.accidentalColumn * ACCIDENTAL_COLUMN_PX,
        y,
        GAP,
      );
    }
    if (chord.symbol.dotted) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(rightEdgeX + rx + 5, y - (note.step % 2 === 0 ? GAP / 2 : 0), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Stem and flags (whole notes have neither). A beamed chord stems to its
  // beam and takes no flag — the beam is the flag, shared.
  if (chord.symbol.base !== 'whole') {
    const beam = chord.beamId === null ? undefined : beamLines.get(chord.beamId);
    const sx = chord.stemDown ? x - rx + 0.8 : x + rx - 0.8;
    const headEnd = chord.stemDown ? minY : maxY;
    const tipY = beam
      ? beamYAt(beam, beam.x1, beam.x2, sx)
      : chord.stemDown
        ? maxY + STEM_LENGTH_PX
        : minY - STEM_LENGTH_PX;

    ctx.strokeStyle = palette.note;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx, headEnd);
    ctx.lineTo(sx, tipY);
    ctx.stroke();
    if (!beam) drawFlags(ctx, chord, sx, tipY, chord.stemDown ? 1 : -1, palette);
  }
}

function drawFlags(
  ctx: CanvasRenderingContext2D,
  chord: ChordGroup,
  x: number,
  stemEndY: number,
  direction: 1 | -1,
  palette: ScorePalette,
): void {
  const flags = chord.symbol.base === 'eighth' ? 1 : chord.symbol.base === 'sixteenth' ? 2 : 0;
  ctx.strokeStyle = palette.note;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < flags; i += 1) {
    const y = stemEndY + direction * i * (GAP * 0.7);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + GAP * 1.1,
      y + direction * GAP * 0.5,
      x + GAP * 1.2,
      y + direction * GAP * 1.3,
      x + GAP * 0.4,
      y + direction * GAP * 2,
    );
    ctx.stroke();
  }
}

function drawOpenNotes(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  openNotes: readonly OpenRecordingNote[],
  recording: boolean,
  palette: ScorePalette,
): void {
  if (!recording || openNotes.length === 0) return;
  for (const open of openNotes) {
    const position = midiToStaffPosition(open.midi);
    const y = yForStep(view, position.staff, position.step);
    const x = xForMs(view, open.startMs);
    const width = Math.max(6, open.durationMs * view.pxPerMs);
    // Extension bar shows the note is still held.
    ctx.fillStyle = palette.recordWash;
    ctx.fillRect(x, y - 3, width, 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.32);
    ctx.beginPath();
    ctx.ellipse(0, 0, GAP * 0.64, GAP * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = palette.record;
    ctx.fill();
    ctx.restore();
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
    const position = midiToStaffPosition(ghost.midi);
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
    ctx.translate(x, y);
    ctx.rotate(-0.32);
    ctx.beginPath();
    ctx.ellipse(0, 0, GAP * 0.64, GAP * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = palette.ghost;
    ctx.fill();
    ctx.restore();
  }
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
  ctx.lineTo(x, view.bassTop + STAFF_H + 12);
  ctx.stroke();
  ctx.fillStyle = palette.playhead;
  ctx.beginPath();
  ctx.moveTo(x - 5, view.trebleTop - 22);
  ctx.lineTo(x + 5, view.trebleTop - 22);
  ctx.lineTo(x, view.trebleTop - 13);
  ctx.closePath();
  ctx.fill();
}

let glyphSupport: { treble: boolean; bass: boolean } | null = null;

function detectGlyphSupport(ctx: CanvasRenderingContext2D): { treble: boolean; bass: boolean } {
  if (glyphSupport) return glyphSupport;
  ctx.save();
  ctx.font = `${GAP * 4}px serif`;
  const treble = ctx.measureText('\u{1D11E}').width > GAP;
  const bass = ctx.measureText('\u{1D122}').width > GAP;
  ctx.restore();
  glyphSupport = { treble, bass };
  return glyphSupport;
}

/** Scale a clef announcing a change mid-score is drawn at. */
const INLINE_CLEF_SCALE = 0.72;

/** Room an inline clef takes, and the gap it keeps off the bar line. */
const INLINE_CLEF_W = 22;
const INLINE_CLEF_PAD = 3;

/**
 * A clef announced mid-score, drawn smaller than the gutter's and seated on
 * the staff it belongs to. Scaling about the staff's centre keeps it there.
 *
 * It sits in the tail of the measure before the bar line rather than after it.
 * On paper the clef follows the bar line, but paper reserves width for it;
 * here the downbeat note is centred on the bar line itself, so anything drawn
 * after it lands on the note head. The tail is the one place in a
 * time-proportional bar that a note never starts.
 */
function drawInlineClef(
  ctx: CanvasRenderingContext2D,
  clef: ClefKind,
  barX: number,
  staffTop: number,
  palette: ScorePalette,
): void {
  const x = barX - INLINE_CLEF_W - INLINE_CLEF_PAD;
  // A wash keeps it legible over whatever the tail of the bar happens to hold.
  ctx.fillStyle = palette.gutterBg;
  ctx.fillRect(x - 2, staffTop - 3, INLINE_CLEF_W + 4, STAFF_H + 6);
  ctx.save();
  const centreY = staffTop + STAFF_H / 2;
  ctx.translate(x, centreY);
  ctx.scale(INLINE_CLEF_SCALE, INLINE_CLEF_SCALE);
  ctx.translate(-x, -centreY);
  if (clef === 'treble') drawFallbackTrebleClef(ctx, x + 6, staffTop, palette);
  else drawFallbackBassClef(ctx, x + 6, staffTop, palette);
  ctx.restore();
}

/** Announce every clef that turns over inside the visible span. */
function drawClefChanges(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  layout: ScoreLayout,
  palette: ScorePalette,
): void {
  const fromMs = view.scrollMs - 200;
  const toMs = view.scrollMs + (view.widthPx - view.gutterPx) / view.pxPerMs + 200;
  for (const measure of layout.measures) {
    if (measure.endMs < fromMs || measure.startMs > toMs) continue;
    const previous = layout.measures[measure.index - 1];
    if (!previous) continue;
    const x = Math.round(xForMs(view, measure.startMs)) + 0.5;
    if (x < view.gutterPx + INLINE_CLEF_W || x > view.widthPx) continue;
    for (const staff of ['treble', 'bass'] as const) {
      if (previous.clefs[staff] === measure.clefs[staff]) continue;
      const top = staff === 'treble' ? view.trebleTop : view.bassTop;
      drawInlineClef(ctx, measure.clefs[staff], x, top, palette);
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

/** The clef glyph for a staff, falling back to a drawn one where unsupported. */
function drawGutterClef(
  ctx: CanvasRenderingContext2D,
  clef: ClefKind,
  staffTop: number,
  palette: ScorePalette,
): void {
  const support = detectGlyphSupport(ctx);
  if (clef === 'treble') {
    if (support.treble) {
      ctx.font = `${GAP * 4.1}px serif`;
      ctx.fillText('\u{1D11E}', 8, staffTop + STAFF_H - GAP + GAP * 1.4);
    } else {
      drawFallbackTrebleClef(ctx, 14, staffTop, palette);
    }
    return;
  }
  if (support.bass) {
    ctx.font = `${GAP * 3.2}px serif`;
    ctx.fillText('\u{1D122}', 8, staffTop + GAP * 3.1);
  } else {
    drawFallbackBassClef(ctx, 14, staffTop, palette);
  }
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
  ctx.strokeStyle = palette.barLine;
  ctx.lineWidth = 1.4;
  // System bar line joining the staffs at the left edge.
  ctx.beginPath();
  ctx.moveTo(4.5, view.trebleTop);
  ctx.lineTo(4.5, view.bassTop + STAFF_H);
  ctx.stroke();

  ctx.fillStyle = palette.noteDim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // The gutter sits over the music, so it has to name the clef in force where
  // the view actually starts — not the one the piece opened with.
  const clefs = clefsAt(input.layout, view.scrollMs);
  drawGutterClef(ctx, clefs.treble, view.trebleTop, palette);
  drawGutterClef(ctx, clefs.bass, view.bassTop, palette);

  // Key signature between the clef and the time signature, read under
  // whichever clef each staff currently carries.
  const fifths = normalizeFifths(input.keySignature);
  if (fifths !== 0) {
    const sign = signatureAccidental(fifths);
    ctx.fillStyle = palette.noteDim;
    ctx.strokeStyle = palette.noteDim;
    for (const staff of ['treble', 'bass'] as const) {
      const top = staff === 'treble' ? view.trebleTop : view.bassTop;
      const steps = signatureSteps(fifths, clefs[staff]);
      for (let i = 0; i < steps.length; i += 1) {
        const y = top + STAFF_H - ((steps[i] as number) * GAP) / 2;
        drawAccidentalGlyph(ctx, sign, GUTTER - 22 + (i + 0.5) * KEY_ACCIDENTAL_PX, y, GAP);
      }
    }
    ctx.fillStyle = palette.noteDim;
  }

  // Time signature on both staffs.
  ctx.font = `700 ${GAP * 2.1}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  const tsX = view.gutterPx - 14;
  for (const top of [view.trebleTop, view.bassTop]) {
    ctx.fillText(String(timeSignature.numerator), tsX, top + GAP * 1.8);
    ctx.fillText(String(timeSignature.denominator), tsX, top + GAP * 3.9);
  }
  ctx.textAlign = 'left';
}

/** Stylized G clef: spiral around the G line plus a tall flourish. */
function drawFallbackTrebleClef(
  ctx: CanvasRenderingContext2D,
  x: number,
  staffTop: number,
  palette: ScorePalette,
): void {
  const gy = staffTop + STAFF_H - GAP; // G4 line
  ctx.strokeStyle = palette.noteDim;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(x, gy, GAP * 0.75, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + GAP * 0.75, gy);
  ctx.bezierCurveTo(x + GAP, staffTop - 6, x - GAP * 0.4, staffTop - 12, x, staffTop - 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, staffTop - 4);
  ctx.lineTo(x, staffTop + STAFF_H + 8);
  ctx.stroke();
}

/** Stylized F clef: comma curve with the two dots around the F line. */
function drawFallbackBassClef(
  ctx: CanvasRenderingContext2D,
  x: number,
  staffTop: number,
  palette: ScorePalette,
): void {
  const fy = staffTop + GAP; // F3 line
  ctx.strokeStyle = palette.noteDim;
  ctx.fillStyle = palette.noteDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x - 2, fy, GAP * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 2, fy);
  ctx.bezierCurveTo(
    x + GAP * 1.6,
    fy - GAP * 1.2,
    x + GAP * 1.6,
    fy + GAP * 1.6,
    x - 2,
    fy + GAP * 2.6,
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + GAP * 1.7, fy - 3, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + GAP * 1.7, fy + 4, 1.7, 0, Math.PI * 2);
  ctx.fill();
}

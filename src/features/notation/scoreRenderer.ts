import type { TimeSignature } from '@/domain/takeTypes';
import { firstChordIndexAt, type ChordGroup, type ScoreLayout } from './notationLayout';
import { ledgerLineSteps, midiToStaffPosition, type StaffKind } from './staffMapping';

/** Staff geometry (CSS pixels; the canvas is DPR-scaled by the component). */
export const GAP = 9;
export const STAFF_H = GAP * 4;
export const TREBLE_TOP = 34;
export const STAFF_SPACING = 48;
export const BASS_TOP = TREBLE_TOP + STAFF_H + STAFF_SPACING;
export const SCORE_MIN_HEIGHT = BASS_TOP + STAFF_H + 38;
/** Fixed gutter: brace, clefs, and time signature; notes scroll beneath it. */
export const GUTTER = 58;

/** Clearance above/below an extreme note head: half-height plus padding. */
const HEAD_CLEARANCE = GAP * 0.5 + 6;
/** Bottom margin below the bass staff at the default geometry. */
const BOTTOM_MARGIN = SCORE_MIN_HEIGHT - BASS_TOP - STAFF_H;

export interface ScoreGeometry {
  trebleTop: number;
  bassTop: number;
  /** Container min-height that fits every note head plus margins. */
  minHeight: number;
}

/**
 * Content-aware vertical geometry: the staves shift down and the view grows
 * only when the take reaches far enough beyond the staves that the default
 * margins would clip note heads. Stems point toward the staff on extreme
 * notes, so heads and their ledger lines set the required clearance. Takes
 * in the normal range get exactly the default constants.
 */
export function computeScoreGeometry(chords: readonly ChordGroup[]): ScoreGeometry {
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
  const bassTop = trebleTop + STAFF_H + STAFF_SPACING;
  const bottomExtent =
    minBassStep === Number.POSITIVE_INFINITY
      ? BOTTOM_MARGIN
      : Math.max(BOTTOM_MARGIN, Math.ceil((-minBassStep * GAP) / 2 + HEAD_CLEARANCE));
  return { trebleTop, bassTop, minHeight: bassTop + STAFF_H + bottomExtent };
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
    staffLine: '#57503f',
    barLine: '#6d6154',
    note: '#f0e9dc',
    noteDim: '#b3a996',
    highlight: '#f0b954',
    record: '#e5484d',
    recordWash: 'rgba(229, 72, 77, 0.28)',
    ghost: 'rgba(240, 233, 220, 0.4)',
    playhead: '#f0b954',
    gutterBg: 'rgba(31, 27, 24, 0.96)',
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
  return GUTTER + (ms - view.scrollMs) * view.pxPerMs;
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
  drawChords(ctx, view, input, palette);
  drawOpenNotes(ctx, view, input.openNotes, input.recording, palette);
  drawGhosts(ctx, view, input, palette);
  drawPlayhead(ctx, view, input.playheadMs, palette);
  drawGutter(ctx, view, input.timeSignature, palette);
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
  const toMs = view.scrollMs + (view.widthPx - GUTTER) / view.pxPerMs + 200;
  ctx.strokeStyle = palette.barLine;
  ctx.fillStyle = palette.measureNumber;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  for (const measure of layout.measures) {
    if (measure.endMs < fromMs || measure.startMs > toMs) continue;
    const x = Math.round(xForMs(view, measure.startMs)) + 0.5;
    if (x >= GUTTER - 8) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, view.trebleTop);
      ctx.lineTo(x, view.trebleTop + STAFF_H);
      ctx.moveTo(x, view.bassTop);
      ctx.lineTo(x, view.bassTop + STAFF_H);
      ctx.stroke();
      ctx.fillText(String(measure.index + 1), x + 3, view.trebleTop - 8);
    }
    if (measure.empty) {
      const cx = xForMs(view, (measure.startMs + measure.endMs) / 2);
      if (cx > GUTTER && cx < view.widthPx) {
        ctx.fillStyle = palette.rest;
        for (const top of [view.trebleTop, view.bassTop]) {
          // Whole rest: a small block hanging from the second line.
          ctx.fillRect(cx - 6, top + GAP + 0.5, 12, GAP * 0.55);
        }
        ctx.fillStyle = palette.measureNumber;
      }
    }
  }
  // Final bar line at the layout end.
  const endX = Math.round(xForMs(view, layout.totalMs)) + 0.5;
  if (endX > GUTTER && endX < view.widthPx + 4) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(endX, view.trebleTop);
    ctx.lineTo(endX, view.trebleTop + STAFF_H);
    ctx.moveTo(endX, view.bassTop);
    ctx.lineTo(endX, view.bassTop + STAFF_H);
    ctx.stroke();
  }
}

function drawChords(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  input: ScoreRenderInput,
  palette: ScorePalette,
): void {
  const { layout, playheadMs } = input;
  const fromMs = view.scrollMs - 2000;
  const toMs = view.scrollMs + (view.widthPx - GUTTER) / view.pxPerMs + 400;
  const start = firstChordIndexAt(layout.chords, fromMs);

  for (let i = start; i < layout.chords.length; i += 1) {
    const chord = layout.chords[i] as ChordGroup;
    if (chord.displayStartMs > toMs) break;
    drawChord(ctx, view, chord, playheadMs, palette);
  }
}

function drawChord(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  chord: ChordGroup,
  playheadMs: number,
  palette: ScorePalette,
): void {
  const x = xForMs(view, chord.displayStartMs);
  if (x < GUTTER - 40) return;

  const rx = GAP * 0.64;
  const ry = GAP * 0.5;
  const hollow = chord.symbol.base === 'whole' || chord.symbol.base === 'half';

  // Ledger lines first, behind heads.
  ctx.strokeStyle = palette.staffLine;
  ctx.lineWidth = 1;
  for (const note of chord.notes) {
    for (const step of ledgerLineSteps(note.step)) {
      const y = yForStep(view, note.staff, step) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x - rx - 4, y);
      ctx.lineTo(x + rx + 4, y);
      ctx.stroke();
    }
  }

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const note of chord.notes) {
    const y = yForStep(view, note.staff, note.step);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    const sounding = playheadMs >= note.startMs && playheadMs < note.startMs + note.durationMs;
    const color = sounding ? palette.highlight : palette.note;

    ctx.save();
    ctx.translate(x, y);
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
      ctx.font = `${GAP * 1.5}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('#', x - rx - 3, y);
    }
    if (chord.symbol.dotted) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + rx + 5, y - (note.step % 2 === 0 ? GAP / 2 : 0), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Stem and flags (whole notes have neither).
  if (chord.symbol.base !== 'whole') {
    const stemLength = GAP * 3.4;
    ctx.strokeStyle = palette.note;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (chord.stemDown) {
      const sx = x - rx + 0.8;
      ctx.moveTo(sx, minY);
      ctx.lineTo(sx, maxY + stemLength);
      ctx.stroke();
      drawFlags(ctx, chord, sx, maxY + stemLength, 1, palette);
    } else {
      const sx = x + rx - 0.8;
      ctx.moveTo(sx, maxY);
      ctx.lineTo(sx, minY - stemLength);
      ctx.stroke();
      drawFlags(ctx, chord, sx, minY - stemLength, -1, palette);
    }
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
  const x = Math.max(GUTTER + 14, xForMs(view, input.playheadMs));
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
  if (x < GUTTER - 2 || x > view.widthPx + 2) return;
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

function drawGutter(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  timeSignature: TimeSignature,
  palette: ScorePalette,
): void {
  ctx.fillStyle = palette.gutterBg;
  ctx.fillRect(0, 0, GUTTER, view.heightPx);
  ctx.strokeStyle = palette.barLine;
  ctx.lineWidth = 1.4;
  // System bar line joining the staffs at the left edge.
  ctx.beginPath();
  ctx.moveTo(4.5, view.trebleTop);
  ctx.lineTo(4.5, view.bassTop + STAFF_H);
  ctx.stroke();

  const support = detectGlyphSupport(ctx);
  ctx.fillStyle = palette.noteDim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Treble (G) clef.
  if (support.treble) {
    ctx.font = `${GAP * 4.1}px serif`;
    ctx.fillText('\u{1D11E}', 8, view.trebleTop + STAFF_H - GAP + GAP * 1.4);
  } else {
    drawFallbackTrebleClef(ctx, 14, view.trebleTop, palette);
  }
  // Bass (F) clef.
  if (support.bass) {
    ctx.font = `${GAP * 3.2}px serif`;
    ctx.fillText('\u{1D122}', 8, view.bassTop + GAP * 3.1);
  } else {
    drawFallbackBassClef(ctx, 14, view.bassTop, palette);
  }

  // Time signature on both staffs.
  ctx.font = `700 ${GAP * 2.1}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  const tsX = GUTTER - 14;
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

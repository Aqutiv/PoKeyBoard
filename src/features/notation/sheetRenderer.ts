import type { TimeSignature } from '@/domain/takeTypes';
import {
  ACCIDENTAL_COLUMN_W_G,
  HAIRPIN_MOUTH_G,
  HEAD_RX_G,
  KEY_ACCIDENTAL_W_G,
  keySignatureWidthPt,
  PEDAL_HOOK_G,
  SHEET_GAP_PT,
  staffYRel,
  stemXPt,
  type SheetBeam,
  type SheetChord,
  type SheetDynamic,
  type SheetHairpin,
  type SheetMeasure,
  type SheetNote,
  type SheetPage,
  type SheetPageMetrics,
  type SheetPedal,
  type SheetSystem,
  type SheetTie,
} from './sheetLayout';
import { drawAccidentalGlyph } from './accidentalGlyph';
import { BEAM_SPACING_G, BEAM_THICKNESS_G, STEM_LENGTH_G } from './beamGeometry';
import {
  normalizeFifths,
  signatureAccidental,
  signatureSteps,
  type AccidentalKind,
} from './keySignature';
import type { DurationSymbol } from './quantization';
import { drawRestGlyph } from './restGlyph';
import { restStep } from './rests';
import type { ClefKind } from './staffMapping';

/**
 * Draws one sheet page in engraved print style: black ink on white paper.
 * The ctx must be scaled so 1 canvas unit = 1 PDF point. All music glyphs
 * (clefs, brace, accidentals, flags, rests) are hand-drawn Béziers so the
 * output is identical on every device; fonts are used only for genuinely
 * textual elements (title, digits, page numbers). Rests and accidentals come
 * from `restGlyph.ts` and `accidentalGlyph.ts`, shared with the live score so
 * both views draw the same shapes.
 */

/** Device pixels per PDF point for print rasterization (≈288 DPI). */
export const RENDER_SCALE = 4;
/** Reduced scale for very long documents to bound canvas memory. */
export const RENDER_SCALE_LARGE_DOC = 3;
/** Page count above which the reduced scale is used. */
export const LARGE_DOC_PAGE_COUNT = 30;

const G = SHEET_GAP_PT;
const INK = '#000000';
const PAPER = '#ffffff';
const SERIF = 'Georgia, "Times New Roman", Times, serif';

const STAFF_LINE_W = 0.9;
const BARLINE_W = 1;
const STEM_W = 1;

/** What a bar of silence takes, whatever the meter is. */
const WHOLE_REST: DurationSymbol = { base: 'whole', dotted: false };
const WHOLE_REST_STEP = restStep(WHOLE_REST);

export function drawSheetPage(ctx: CanvasRenderingContext2D, page: SheetPage): void {
  const { metrics } = page;
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, metrics.pageWidthPt, metrics.pageHeightPt);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'butt';

  if (page.titleBlock) drawTitleBlock(ctx, page);
  for (const system of page.systems) drawSystem(ctx, system, page);
  drawFooter(ctx, page);
  ctx.restore();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function drawTitleBlock(ctx: CanvasRenderingContext2D, page: SheetPage): void {
  const { metrics } = page;
  const block = page.titleBlock;
  if (!block) return;
  const centerX = metrics.pageWidthPt / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 21px ${SERIF}`;
  ctx.fillText(
    ellipsize(ctx, block.title, metrics.contentWidthPt),
    centerX,
    metrics.marginTopPt + 30,
  );

  if (block.subtitle) {
    ctx.font = `italic 10px ${SERIF}`;
    ctx.fillText(
      ellipsize(ctx, block.subtitle, metrics.contentWidthPt),
      centerX,
      metrics.marginTopPt + 50,
    );
  }

  const markBaseline = metrics.marginTopPt + metrics.titleBlockHeightPt - 14;
  drawTempoMark(ctx, metrics.marginLeftPt, markBaseline, block.bpm);

  ctx.font = `9px ${SERIF}`;
  ctx.textAlign = 'right';
  ctx.fillText(block.credit, metrics.pageWidthPt - metrics.marginRightPt, markBaseline);
  ctx.textAlign = 'left';
}

/** "♩ = bpm" with a hand-drawn quarter note (no music-font dependency). */
function drawTempoMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  bpm: number,
): void {
  const headX = x + 3;
  const headY = baseline - 2.5;
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(-0.32);
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.1, 2.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(headX + 2.8, headY - 0.6);
  ctx.lineTo(headX + 2.8, headY - 10);
  ctx.stroke();

  ctx.font = `11px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`= ${bpm}`, headX + 7.5, baseline);
}

function drawFooter(ctx: CanvasRenderingContext2D, page: SheetPage): void {
  const { metrics } = page;
  ctx.font = `9.5px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(page.pageNumber), metrics.pageWidthPt / 2, metrics.pageHeightPt - 18);
  ctx.textAlign = 'left';
}

function drawSystem(ctx: CanvasRenderingContext2D, system: SheetSystem, page: SheetPage): void {
  const { metrics } = page;
  const right = system.xPt + system.widthPt;
  const bassBottom = system.bassTopPt + metrics.staffHeightPt;

  drawBrace(ctx, system.xPt, system.trebleTopPt, bassBottom);

  ctx.lineWidth = STAFF_LINE_W;
  for (const top of [system.trebleTopPt, system.bassTopPt]) {
    for (let line = 0; line < 5; line += 1) {
      const y = top + line * G;
      ctx.beginPath();
      ctx.moveTo(system.xPt, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
  }

  // System start barline joining both staffs.
  ctx.lineWidth = BARLINE_W;
  ctx.beginPath();
  ctx.moveTo(system.xPt, system.trebleTopPt);
  ctx.lineTo(system.xPt, bassBottom);
  ctx.stroke();

  drawClef(ctx, system.clefs.treble, system.xPt + 13, system.trebleTopPt, 1);
  drawClef(ctx, system.clefs.bass, system.xPt + 12, system.bassTopPt, 1);

  drawKeySignature(ctx, system, metrics, page.keySignature);
  if (system.showTimeSignature)
    drawTimeSignature(ctx, system, metrics, page.keySignature, page.timeSignature);

  ctx.font = `8px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(system.firstMeasureNumber), system.xPt + 1, system.trebleTopPt - 6);

  for (let i = 0; i < system.measures.length; i += 1) {
    const measure = system.measures[i]!;
    const isFinal = system.isLast && i === system.measures.length - 1;
    drawMeasure(ctx, measure, system, isFinal);
  }
  for (const tie of system.ties) drawTie(ctx, tie);
  for (const pedal of system.pedals) drawPedal(ctx, pedal, system.pedalRowPt);
  for (const hairpin of system.hairpins) drawHairpin(ctx, hairpin, system.dynamicsRowPt);
  for (const dynamic of system.dynamics) drawDynamic(ctx, dynamic, system.dynamicsRowPt);
}

/**
 * A dynamic mark, in the bold italic serif that editions have set them in
 * since long before music fonts. These are letters, so the renderer's rule
 * about drawing its glyphs rather than typesetting them does not apply —
 * `p` and `f` are text, and always were.
 */
function drawDynamic(ctx: CanvasRenderingContext2D, dynamic: SheetDynamic, rowY: number): void {
  ctx.font = `bold italic ${2.4 * G}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(dynamic.mark, dynamic.xPt, rowY);
  ctx.textAlign = 'left';
}

/**
 * A hairpin: two lines meeting at a point and opening toward the loud end. An
 * end that runs off the system stays open at full mouth, which says the swell
 * carries on rather than arriving here.
 */
function drawHairpin(ctx: CanvasRenderingContext2D, hairpin: SheetHairpin, rowY: number): void {
  const mouth = HAIRPIN_MOUTH_G * G;
  // The wedge sits on the marks' own line, lifted to their middle.
  const midY = rowY - 0.8 * G;
  const closed = hairpin.grow ? hairpin.x1Pt : hairpin.x2Pt;
  const open = hairpin.grow ? hairpin.x2Pt : hairpin.x1Pt;
  // A tip that is really a continuation is cut off rather than pointed.
  const tipCut = (hairpin.grow ? hairpin.continuesLeft : hairpin.continuesRight) ? mouth * 0.5 : 0;

  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(open, midY - mouth);
  ctx.lineTo(closed, midY - tipCut);
  if (tipCut > 0) ctx.lineTo(closed, midY + tipCut);
  else ctx.moveTo(closed, midY);
  ctx.lineTo(open, midY + mouth);
  ctx.stroke();
}

/**
 * The sustain pedal, as the bracket modern editions use: a line under the bass
 * staff hooked up at each end, the hooks marking where the pedal goes down and
 * comes up. An end that runs off the system is left open instead of hooked,
 * which says the press carries on.
 */
function drawPedal(ctx: CanvasRenderingContext2D, pedal: SheetPedal, rowY: number): void {
  const hook = PEDAL_HOOK_G * G;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  if (!pedal.continuesLeft) {
    ctx.moveTo(pedal.xFromPt, rowY - hook);
    ctx.lineTo(pedal.xFromPt, rowY);
  } else {
    ctx.moveTo(pedal.xFromPt, rowY);
  }
  ctx.lineTo(pedal.xToPt, rowY);
  if (!pedal.continuesRight) ctx.lineTo(pedal.xToPt, rowY - hook);
  ctx.stroke();
}

/**
 * A tie: a shallow crescent between two heads, filled so it tapers at both
 * ends the way an engraved one does rather than reading as a drawn line.
 */
function drawTie(ctx: CanvasRenderingContext2D, tie: SheetTie): void {
  const dir = tie.above ? -1 : 1;
  const span = Math.max(tie.x2Pt - tie.x1Pt, 0.1);
  // Shallow over a short tie, deeper over a long one, but never a semicircle.
  const depth = dir * Math.min(1.1 * G, 0.24 * span + 0.35 * G);
  const midX = (tie.x1Pt + tie.x2Pt) / 2;
  const midY = (tie.y1Pt + tie.y2Pt) / 2;
  ctx.beginPath();
  ctx.moveTo(tie.x1Pt, tie.y1Pt);
  ctx.quadraticCurveTo(midX, midY + depth, tie.x2Pt, tie.y2Pt);
  ctx.quadraticCurveTo(midX, midY + depth * 0.72, tie.x1Pt, tie.y1Pt);
  ctx.closePath();
  ctx.fill();
}

function drawMeasure(
  ctx: CanvasRenderingContext2D,
  measure: SheetMeasure,
  system: SheetSystem,
  isFinal: boolean,
): void {
  const bassBottom = system.bassTopPt + 4 * G;
  const endX = measure.xPt + measure.widthPt;

  // A clef turning over is engraved small, just inside the bar line it follows.
  for (const staff of measure.clefChanges) {
    const staffTop = staff === 'treble' ? system.trebleTopPt : system.bassTopPt;
    drawClef(ctx, measure.clefs[staff], measure.xPt + 1.5 * G, staffTop, CLEF_CHANGE_SCALE);
  }

  if (measure.tempoMarkBpm !== null) {
    drawTempoMark(ctx, measure.xPt + 1, system.tempoMarkBaselinePt, measure.tempoMarkBpm);
  }

  if (isFinal) {
    // Final barline: thin line then a thick terminal stroke.
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(endX - 4, system.trebleTopPt);
    ctx.lineTo(endX - 4, bassBottom);
    ctx.stroke();
    ctx.fillRect(endX - 2.4, system.trebleTopPt, 2.4, bassBottom - system.trebleTopPt);
  } else {
    ctx.lineWidth = BARLINE_W;
    ctx.beginPath();
    ctx.moveTo(endX, system.trebleTopPt);
    ctx.lineTo(endX, bassBottom);
    ctx.stroke();
  }

  if (measure.empty) {
    const centerX = measure.xPt + measure.widthPt / 2;
    for (const top of [system.trebleTopPt, system.bassTopPt]) {
      drawRestGlyph(ctx, WHOLE_REST, centerX, top, WHOLE_REST_STEP, G);
    }
    return;
  }

  for (const column of measure.columns) {
    for (const chord of [...column.treble, ...column.bass]) {
      const staffTop = chord.staff === 'treble' ? system.trebleTopPt : system.bassTopPt;
      drawChord(ctx, chord, column.xPt, staffTop, measure.beams);
    }
    if (column.trebleRest) {
      drawRestGlyph(
        ctx,
        column.trebleRest.symbol,
        column.xPt,
        system.trebleTopPt,
        column.trebleRest.step,
        G,
      );
    }
    if (column.bassRest) {
      drawRestGlyph(
        ctx,
        column.bassRest.symbol,
        column.xPt,
        system.bassTopPt,
        column.bassRest.step,
        G,
      );
    }
  }
  for (const beam of measure.beams) {
    drawBeam(ctx, beam);
    drawTupletNumeral(ctx, beam);
  }
}

function drawChord(
  ctx: CanvasRenderingContext2D,
  chord: SheetChord,
  x: number,
  staffTop: number,
  beams: SheetBeam[],
): void {
  const rx = (chord.symbol.base === 'whole' ? 1.25 : 1) * HEAD_RX_G * G;
  const ry = 0.5 * G;
  const hollow = chord.symbol.base === 'whole' || chord.symbol.base === 'half';
  /** Where a note's head sits, once any collision shift is applied. */
  const headX = (note: SheetNote): number => x + note.headShift * 2 * rx;
  // Accidentals hang off the left of the whole chord and dots off its right:
  // measured from the owning head alone, either would land on top of a head
  // displaced past it.
  const shifts = chord.notes.map((note) => note.headShift);
  const leftEdgeX = x + Math.min(...shifts) * 2 * rx;
  const rightEdgeX = x + Math.max(...shifts) * 2 * rx;

  // Ledger lines behind the heads, each long enough to carry every head on its
  // step — a displaced head needs the line to reach out to it.
  ctx.lineWidth = STAFF_LINE_W;
  const ledgerSpans = new Map<number, { left: number; right: number }>();
  for (const note of chord.notes) {
    for (const step of note.ledger) {
      const span = ledgerSpans.get(step);
      const left = headX(note) - rx - 0.28 * G;
      const right = headX(note) + rx + 0.28 * G;
      if (span) {
        span.left = Math.min(span.left, left);
        span.right = Math.max(span.right, right);
      } else {
        ledgerSpans.set(step, { left, right });
      }
    }
  }
  for (const [step, span] of ledgerSpans) {
    const y = staffTop + staffYRel(step);
    ctx.beginPath();
    ctx.moveTo(span.left, y);
    ctx.lineTo(span.right, y);
    ctx.stroke();
  }

  for (const note of chord.notes) {
    const y = staffTop + staffYRel(note.step);
    const hx = headX(note);
    ctx.save();
    ctx.translate(hx, y);
    ctx.rotate(-0.32);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    if (hollow) {
      ctx.lineWidth = chord.symbol.base === 'whole' ? 1.3 : 1.1;
      ctx.stroke();
    } else {
      ctx.fill();
    }
    ctx.restore();

    if (note.accidental) {
      drawAccidental(
        ctx,
        note.accidental,
        leftEdgeX - 1.5 * G - note.accidentalColumn * ACCIDENTAL_COLUMN_W_G * G,
        y,
      );
    }
    if (chord.symbol.dotted) {
      // Dots sit in a space: shift line-notes up half a space.
      const dotY = y - (note.step % 2 === 0 ? G / 2 : 0);
      ctx.beginPath();
      ctx.arc(rightEdgeX + 1.3 * G, dotY, 0.22 * G, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (chord.symbol.base === 'whole') return;

  const stemX = stemXPt(x, chord.stemDown);
  const topHeadY = staffTop + staffYRel(chord.notes[chord.notes.length - 1]!.step);
  const bottomHeadY = staffTop + staffYRel(chord.notes[0]!.step);

  let tipY: number;
  if (chord.beamId !== null) {
    const beam = beams[chord.beamId]!;
    const dx = beam.x2Pt - beam.x1Pt;
    tipY = dx === 0 ? beam.y1Pt : beam.y1Pt + ((stemX - beam.x1Pt) / dx) * (beam.y2Pt - beam.y1Pt);
  } else {
    tipY = chord.stemDown ? bottomHeadY + STEM_LENGTH_G * G : topHeadY - STEM_LENGTH_G * G;
  }

  ctx.lineWidth = STEM_W;
  ctx.beginPath();
  ctx.moveTo(stemX, chord.stemDown ? topHeadY : bottomHeadY);
  ctx.lineTo(stemX, tipY);
  ctx.stroke();

  if (chord.beamId === null) {
    const flags = chord.symbol.base === 'eighth' ? 1 : chord.symbol.base === 'sixteenth' ? 2 : 0;
    for (let i = 0; i < flags; i += 1) {
      drawFlag(ctx, stemX, tipY + (chord.stemDown ? -1 : 1) * i * 0.9 * G, chord.stemDown);
    }
  }
}

/** Filled flag curving from the stem tip back toward the notehead. */
function drawFlag(ctx: CanvasRenderingContext2D, x: number, tipY: number, stemDown: boolean): void {
  const d = stemDown ? -1 : 1; // flags extend from the tip toward the head
  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.bezierCurveTo(
    x + 0.15 * G,
    tipY + d * 0.9 * G,
    x + 1.45 * G,
    tipY + d * 1.1 * G,
    x + 0.95 * G,
    tipY + d * 2.7 * G,
  );
  ctx.bezierCurveTo(
    x + 1.3 * G,
    tipY + d * 1.5 * G,
    x + 0.5 * G,
    tipY + d * 1.3 * G,
    x,
    tipY + d * 0.7 * G,
  );
  ctx.closePath();
  ctx.fill();
}

/**
 * The tuplet numeral, centred over its beam on the side away from the heads.
 * Italic, as editions set it, and small enough not to compete with the notes.
 */
function drawTupletNumeral(ctx: CanvasRenderingContext2D, beam: SheetBeam): void {
  if (beam.tupletCount === null) return;
  const midX = (beam.x1Pt + beam.x2Pt) / 2;
  const midY = (beam.y1Pt + beam.y2Pt) / 2;
  // Clear of the beam on the stem side: below a down-stem run, above an up one.
  const away = beam.stemDown ? 1.5 * G : -0.9 * G;
  ctx.font = `italic 600 ${1.9 * G}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(beam.tupletCount), midX, midY + away);
  ctx.textAlign = 'left';
}

function drawBeam(ctx: CanvasRenderingContext2D, beam: SheetBeam): void {
  const t = BEAM_THICKNESS_G * G;
  const towardHeads = beam.stemDown ? -1 : 1;
  for (let i = 0; i < beam.beamCount; i += 1) {
    const dy = i * towardHeads * BEAM_SPACING_G * G;
    ctx.beginPath();
    ctx.moveTo(beam.x1Pt, beam.y1Pt + dy - t / 2);
    ctx.lineTo(beam.x2Pt, beam.y2Pt + dy - t / 2);
    ctx.lineTo(beam.x2Pt, beam.y2Pt + dy + t / 2);
    ctx.lineTo(beam.x1Pt, beam.y1Pt + dy + t / 2);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The key signature after the clef, on both staffs, in every system prefix —
 * a reader picks up mid-page as often as at the top, and the alternative is
 * marking the same accidentals over and over inside the bars.
 *
 * The positions are read under the clef the staff carries, so a bass staff
 * under a G clef gets the treble layout.
 */
function drawKeySignature(
  ctx: CanvasRenderingContext2D,
  system: SheetSystem,
  metrics: SheetPageMetrics,
  fifths: number,
): void {
  if (normalizeFifths(fifths) === 0) return;
  const sign = signatureAccidental(fifths);
  const left = system.xPt + metrics.clefAreaPt;
  for (const staff of ['treble', 'bass'] as const) {
    const top = staff === 'treble' ? system.trebleTopPt : system.bassTopPt;
    const steps = signatureSteps(fifths, system.clefs[staff]);
    for (let i = 0; i < steps.length; i += 1) {
      const x = left + (i + 0.5) * KEY_ACCIDENTAL_W_G * G;
      drawAccidental(ctx, sign, x, top + staffYRel(steps[i] as number));
    }
  }
}

/** Time signature digits on both staffs (first system only). */
function drawTimeSignature(
  ctx: CanvasRenderingContext2D,
  system: SheetSystem,
  metrics: SheetPageMetrics,
  fifths: number,
  timeSignature: TimeSignature,
): void {
  const x =
    system.xPt + metrics.clefAreaPt + keySignatureWidthPt(fifths) + metrics.timeSigAreaPt * 0.4;
  ctx.font = `700 ${2.6 * G}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const top of [system.trebleTopPt, system.bassTopPt]) {
    ctx.fillText(String(timeSignature.numerator), x, top + 1.85 * G);
    ctx.fillText(String(timeSignature.denominator), x, top + 3.95 * G);
  }
  ctx.textAlign = 'left';
}

function drawAccidental(
  ctx: CanvasRenderingContext2D,
  kind: AccidentalKind,
  x: number,
  y: number,
): void {
  drawAccidentalGlyph(ctx, kind, x, y, G);
}

/** Curly brace joining the two staffs, drawn as a filled double curve. */
function drawBrace(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number): void {
  const right = x - 2.5;
  const mid = (top + bottom) / 2;
  const h = bottom - top;
  ctx.beginPath();
  ctx.moveTo(right, top);
  ctx.bezierCurveTo(right - 7, top + h * 0.26, right - 1.5, mid - h * 0.16, right - 7.5, mid);
  ctx.bezierCurveTo(right - 1.5, mid + h * 0.16, right - 7, bottom - h * 0.26, right, bottom);
  ctx.bezierCurveTo(right - 5.2, bottom - h * 0.26, right - 0.2, mid + h * 0.14, right - 5.6, mid);
  ctx.bezierCurveTo(right - 0.2, mid - h * 0.14, right - 5.2, top + h * 0.26, right, top);
  ctx.closePath();
  ctx.fill();
}

/** Scale a clef announcing a change mid-staff is drawn at. */
const CLEF_CHANGE_SCALE = 0.72;

/**
 * A clef at `cx`, drawn at `scale` — full size in a system prefix, smaller
 * where one turns over mid-staff. The glyphs are laid out around the staff
 * top, so scaling about that point keeps them seated on their own lines.
 */
function drawClef(
  ctx: CanvasRenderingContext2D,
  clef: ClefKind,
  cx: number,
  staffTop: number,
  scale: number,
): void {
  if (scale === 1) {
    if (clef === 'treble') drawTrebleClef(ctx, cx, staffTop);
    else drawBassClef(ctx, cx, staffTop);
    return;
  }
  ctx.save();
  // Scale about the staff's vertical centre so a smaller clef stays centred on
  // the staff rather than riding up off its top line.
  const centreY = staffTop + 2 * G;
  ctx.translate(cx, centreY);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -centreY);
  if (clef === 'treble') drawTrebleClef(ctx, cx, staffTop);
  else drawBassClef(ctx, cx, staffTop);
  ctx.restore();
}

/** Stylized G clef: spiral on the G line, tall flourish, tail with a dot. */
function drawTrebleClef(ctx: CanvasRenderingContext2D, cx: number, staffTop: number): void {
  const gy = staffTop + 3 * G; // G4 line
  ctx.lineWidth = 1.15;

  // Spiral around the G line.
  ctx.beginPath();
  ctx.arc(cx - 0.05 * G, gy, 0.55 * G, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, gy - 0.1 * G, 1.05 * G, 0.25 * Math.PI, 1.75 * Math.PI);
  ctx.stroke();

  // Rising line from the spiral through the top curl.
  ctx.beginPath();
  ctx.moveTo(cx + 0.78 * G, gy + 0.68 * G);
  ctx.bezierCurveTo(
    cx + 1.15 * G,
    staffTop + 0.6 * G,
    cx + 0.9 * G,
    staffTop - 1.6 * G,
    cx + 0.1 * G,
    staffTop - 2.4 * G,
  );
  ctx.bezierCurveTo(
    cx - 0.75 * G,
    staffTop - 1.55 * G,
    cx - 0.2 * G,
    staffTop - 0.3 * G,
    cx + 0.2 * G,
    staffTop + 0.9 * G,
  );
  // Descender through the staff to the tail.
  ctx.bezierCurveTo(
    cx + 0.45 * G,
    staffTop + 1.9 * G,
    cx + 0.4 * G,
    staffTop + 3.6 * G,
    cx + 0.32 * G,
    staffTop + 5.2 * G,
  );
  ctx.stroke();

  // Tail hook and dot.
  ctx.beginPath();
  ctx.moveTo(cx + 0.32 * G, staffTop + 5.2 * G);
  ctx.bezierCurveTo(
    cx + 0.2 * G,
    staffTop + 6 * G,
    cx - 0.9 * G,
    staffTop + 6 * G,
    cx - 0.95 * G,
    staffTop + 5.35 * G,
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - 0.7 * G, staffTop + 5.3 * G, 0.3 * G, 0, Math.PI * 2);
  ctx.fill();
}

/** F clef: filled head, tapered sweeping curve, two dots by the F line. */
function drawBassClef(ctx: CanvasRenderingContext2D, cx: number, staffTop: number): void {
  const fy = staffTop + G; // F3 line
  ctx.beginPath();
  ctx.arc(cx - 0.2 * G, fy, 0.45 * G, 0, Math.PI * 2);
  ctx.fill();

  // Tapered curve drawn as a filled shape between two Béziers.
  ctx.beginPath();
  ctx.moveTo(cx - 0.6 * G, fy + 0.1 * G);
  ctx.bezierCurveTo(
    cx - 0.5 * G,
    staffTop - 0.45 * G,
    cx + 1.4 * G,
    staffTop - 0.35 * G,
    cx + 1.55 * G,
    fy + 0.15 * G,
  );
  ctx.bezierCurveTo(
    cx + 1.7 * G,
    fy + 1.4 * G,
    cx + 0.65 * G,
    fy + 2.3 * G,
    cx - 0.55 * G,
    fy + 2.75 * G,
  );
  ctx.bezierCurveTo(
    cx + 0.55 * G,
    fy + 2.05 * G,
    cx + 1.25 * G,
    fy + 1.3 * G,
    cx + 1.15 * G,
    fy + 0.3 * G,
  );
  ctx.bezierCurveTo(
    cx + 1.05 * G,
    staffTop - 0.05 * G,
    cx - 0.3 * G,
    staffTop + 0.05 * G,
    cx - 0.6 * G,
    fy + 0.1 * G,
  );
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx + 2.1 * G, fy - 0.45 * G, 0.2 * G, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 2.1 * G, fy + 0.45 * G, 0.2 * G, 0, Math.PI * 2);
  ctx.fill();
}

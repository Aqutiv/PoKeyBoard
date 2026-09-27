import type { TimeSignature } from '@/domain/takeTypes';
import {
  ACCIDENTAL_COLUMN_W_G,
  HAIRPIN_MOUTH_G,
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
  type SheetOctave,
  type SheetPage,
  type SheetPageMetrics,
  type SheetPedal,
  type SheetSystem,
  type SheetTie,
} from './sheetLayout';
import type { DrawSurface } from './drawSurface';
import { beamPieceXs, beamYAt, BEAM_SPACING_G, BEAM_THICKNESS_G } from './beamGeometry';
import { drawGlyph } from './glyphs/drawGlyph';
import {
  ACCIDENTAL_GLYPHS,
  clefGlyphFor,
  drawAccidentalCentred,
  drawAccidentalEndingAt,
  drawDigitRun,
  drawRestSymbol,
  DYNAMIC_GLYPHS,
  dynamicOpticalCentre,
  flagAnchorYG,
  flagGlyphFor,
  flaggedStemG,
  glyphCentre,
  noteheadGlyphFor,
  noteheadHalfWidth,
  secondShiftG,
  STEM_ANCHOR_RISE_G,
  STEM_THICKNESS_G,
} from './glyphs/engravingGlyphs';
import { ENGRAVING_DEFAULTS, MUSIC_GLYPH_METRICS } from './glyphs/musicGlyphMetrics';
import { normalizeFifths, signatureAccidental, signatureSteps } from './keySignature';
import { beamCountFor, type DurationSymbol } from './quantization';
import { restStep } from './rests';
import { ellipsizeRich, fillRich } from './sheetText';
import type { ClefKind } from './staffMapping';

/**
 * Draws one sheet page in engraved print style: black ink on white paper,
 * onto any `DrawSurface` whose units are PDF points (y down). The export
 * dialog's preview passes its scaled canvas; the PDF export passes a surface
 * that writes the same calls as vector operators (`export/pdfSurface.ts`), so
 * the preview shows exactly what prints.
 *
 * Every music symbol — clefs, brace, noteheads, flags, accidentals, rests,
 * dots, time signature and tuplet digits, dynamics, the 8va label, the tempo
 * mark's note — is a glyph from the music font (`glyphs/`), placed by its
 * SMuFL metrics and anchors, so the page is the same on every device. What is
 * drawn as lines is what engravers rule: staff lines, bar lines, stems, ledger
 * lines, beams, ties, hairpins, pedal brackets and the octave line. Words and
 * numbers — title, credit, measure and page numbers, the tempo's "= n" — are
 * set in Times, which is what the PDF sets.
 *
 * Only the canvas subset `DrawSurface` names may be used here: anything else
 * would work in the preview and have no counterpart in the PDF.
 */

const G = SHEET_GAP_PT;
const INK = '#000000';
const PAPER = '#ffffff';
/**
 * Times, which is what the PDF sets its text in (the standard Times fonts), so
 * the preview measures and draws the letters the page will print.
 */
const SERIF = '"Times New Roman", Times, serif';

const STAFF_LINE_W = 0.9;
const BARLINE_W = 1;
const STEM_W = STEM_THICKNESS_G * G;
const LEDGER_W = ENGRAVING_DEFAULTS.legerLineThickness * G;
/** How far a ledger line runs past the head it carries. */
const LEDGER_EXTENSION = ENGRAVING_DEFAULTS.legerLineExtension * G;

/** Clear space between an accidental and the head it stands before. */
const ACCIDENTAL_GAP_G = 0.25;
/** Clear space a ledger line leaves before an accidental beside it. */
const LEDGER_ACCIDENTAL_GAP_G = 0.1;
/** Clear space between the rightmost head and its dot. */
const DOT_GAP_G = 0.4;
/** Where a system's clefs start, after its opening bar line. */
const SYSTEM_CLEF_X_G = 1.1;
/** Where a clef changing mid-staff starts, after the bar line it follows. */
const CLEF_CHANGE_X_G = 0.6;
/** Clear space between the brace and the system it joins, in points. */
const BRACE_GAP_PT = 2.5;

/** What a bar of silence takes, whatever the meter is. */
const WHOLE_REST: DurationSymbol = { base: 'whole', dotted: false };
const WHOLE_REST_STEP = restStep(WHOLE_REST);

export function drawSheetPage(ctx: DrawSurface, page: SheetPage): void {
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

const TITLE_PX = 21;
const SUBTITLE_PX = 10;

/**
 * Title, subtitle, tempo and credit. A title can name its key — "Nocturne in
 * E♭" — so both lines go through `sheetText`, which draws the signs as glyphs:
 * no font the PDF can rely on has them, and the preview must show what prints.
 */
function drawTitleBlock(ctx: DrawSurface, page: SheetPage): void {
  const { metrics } = page;
  const block = page.titleBlock;
  if (!block) return;
  const centerX = metrics.pageWidthPt / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${TITLE_PX}px ${SERIF}`;
  fillRich(
    ctx,
    ellipsizeRich(ctx, block.title, metrics.contentWidthPt, TITLE_PX),
    centerX,
    metrics.marginTopPt + 30,
    TITLE_PX,
  );

  if (block.subtitle) {
    ctx.font = `italic ${SUBTITLE_PX}px ${SERIF}`;
    fillRich(
      ctx,
      ellipsizeRich(ctx, block.subtitle, metrics.contentWidthPt, SUBTITLE_PX),
      centerX,
      metrics.marginTopPt + 50,
      SUBTITLE_PX,
    );
  }

  const markBaseline = metrics.marginTopPt + metrics.titleBlockHeightPt - 14;
  drawTempoMark(ctx, metrics.marginLeftPt, markBaseline, block.bpm);

  ctx.font = `9px ${SERIF}`;
  ctx.textAlign = 'right';
  ctx.fillText(block.credit, metrics.pageWidthPt - metrics.marginRightPt, markBaseline);
  ctx.textAlign = 'left';
}

/** Size the tempo mark's note is set at: smaller than the music it governs. */
const TEMPO_NOTE_SPACE = 0.75 * G;

/** "♩ = bpm": the metronome-mark quarter note standing on the baseline, then the number. */
function drawTempoMark(ctx: DrawSurface, x: number, baseline: number, bpm: number): void {
  const noteX = x + 0.5;
  const [, bottom] = MUSIC_GLYPH_METRICS.metNoteQuarterUp.bbox;
  drawGlyph(ctx, 'metNoteQuarterUp', noteX, baseline + bottom * TEMPO_NOTE_SPACE, TEMPO_NOTE_SPACE);

  ctx.font = `11px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`= ${bpm}`, noteX + 1.6 * G, baseline);
}

function drawFooter(ctx: DrawSurface, page: SheetPage): void {
  const { metrics } = page;
  ctx.font = `9.5px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(page.pageNumber), metrics.pageWidthPt / 2, metrics.pageHeightPt - 18);
  ctx.textAlign = 'left';
}

function drawSystem(ctx: DrawSurface, system: SheetSystem, page: SheetPage): void {
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

  const clefX = system.xPt + SYSTEM_CLEF_X_G * G;
  drawClef(ctx, system.clefs.treble, clefX, system.trebleTopPt, false);
  drawClef(ctx, system.clefs.bass, clefX, system.bassTopPt, false);

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
  for (const octave of system.octaves) drawOctave(ctx, octave, system, metrics);
  for (const hairpin of system.hairpins) drawHairpin(ctx, hairpin, system.dynamicsRowPt);
  for (const dynamic of system.dynamics) drawDynamic(ctx, dynamic, system.dynamicsRowPt);
}

/** Size the 8va and 8vb labels are set at. */
const OCTAVE_LABEL_SPACE = 0.7 * G;

/**
 * An 8va or 8vb: the label, then a dashed line running to a hook that turns
 * down onto the music it covers. The hook is what says where it stops, so an
 * end that runs off the system has none — the passage carries on.
 */
function drawOctave(
  ctx: DrawSurface,
  octave: SheetOctave,
  system: SheetSystem,
  metrics: SheetPageMetrics,
): void {
  const y = octave.up
    ? system.trebleTopPt - 2.6 * G
    : system.bassTopPt + metrics.staffHeightPt + 2.6 * G;
  const label = octave.up ? 'ottavaAlta' : 'ottavaBassaVb';

  let lineFrom = octave.x1Pt;
  if (!octave.continuesLeft) {
    // Its digit is centred on the line, and the line starts clear after it.
    drawGlyph(ctx, label, octave.x1Pt, y + 0.65 * G, OCTAVE_LABEL_SPACE);
    lineFrom = octave.x1Pt + MUSIC_GLYPH_METRICS[label].advance * OCTAVE_LABEL_SPACE + 0.4 * G;
  }

  ctx.save();
  ctx.setLineDash([2.2, 2]);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(lineFrom, y);
  ctx.lineTo(octave.x2Pt, y);
  ctx.stroke();
  ctx.restore();

  if (!octave.continuesRight) {
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(octave.x2Pt, y);
    ctx.lineTo(octave.x2Pt, y + (octave.up ? 1 : -1) * 0.9 * G);
    ctx.stroke();
  }
}

/**
 * A dynamic mark: the music font's own glyph for the whole mark, its letters
 * kerned as the font sets them, standing on the dynamics row and centred on
 * the note it belongs to by its optical centre rather than its ink.
 */
function drawDynamic(ctx: DrawSurface, dynamic: SheetDynamic, rowY: number): void {
  const x = dynamic.xPt - dynamicOpticalCentre(dynamic.mark) * G;
  drawGlyph(ctx, DYNAMIC_GLYPHS[dynamic.mark], x, rowY, G);
}

/**
 * A hairpin: two lines meeting at a point and opening toward the loud end. An
 * end that runs off the system stays open at full mouth, which says the swell
 * carries on rather than arriving here.
 */
function drawHairpin(ctx: DrawSurface, hairpin: SheetHairpin, rowY: number): void {
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
function drawPedal(ctx: DrawSurface, pedal: SheetPedal, rowY: number): void {
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
function drawTie(ctx: DrawSurface, tie: SheetTie): void {
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
  ctx: DrawSurface,
  measure: SheetMeasure,
  system: SheetSystem,
  isFinal: boolean,
): void {
  const bassBottom = system.bassTopPt + 4 * G;
  const endX = measure.xPt + measure.widthPt;

  // A clef turning over is engraved small, just inside the bar line it follows.
  for (const staff of measure.clefChanges) {
    const staffTop = staff === 'treble' ? system.trebleTopPt : system.bassTopPt;
    drawClef(ctx, measure.clefs[staff], measure.xPt + CLEF_CHANGE_X_G * G, staffTop, true);
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
      drawRestSymbol(ctx, WHOLE_REST, centerX, top, WHOLE_REST_STEP, G);
    }
    return;
  }

  for (const column of measure.columns) {
    for (const chord of [...column.treble, ...column.bass]) {
      const staffTop = chord.staff === 'treble' ? system.trebleTopPt : system.bassTopPt;
      drawChord(ctx, chord, column.xPt, staffTop, measure.beams);
    }
    if (column.trebleRest) {
      const { symbol, step } = column.trebleRest;
      drawRestSymbol(ctx, symbol, column.xPt, system.trebleTopPt, step, G);
    }
    if (column.bassRest) {
      const { symbol, step } = column.bassRest;
      drawRestSymbol(ctx, symbol, column.xPt, system.bassTopPt, step, G);
    }
  }
  for (const beam of measure.beams) {
    drawBeam(ctx, beam);
    drawTupletNumeral(ctx, beam);
  }
}

function drawChord(
  ctx: DrawSurface,
  chord: SheetChord,
  x: number,
  staffTop: number,
  beams: SheetBeam[],
): void {
  const base = chord.symbol.base;
  const head = noteheadGlyphFor(base);
  const half = noteheadHalfWidth(base) * G;
  const shift = secondShiftG(base) * G;
  /** Where a note's head is centred, once any collision shift is applied. */
  const headX = (note: SheetNote): number => x + note.headShift * shift;
  // Accidentals hang off the left of the whole chord and dots off its right:
  // measured from the owning head alone, either would land on top of a head
  // displaced past it.
  const shifts = chord.notes.map((note) => note.headShift);
  const leftHeadX = x + Math.min(...shifts) * shift;
  const rightHeadX = x + Math.max(...shifts) * shift;
  /**
   * Where an accidental's ink ends on the right: right-aligned, so accidentals
   * of different widths line up on the chord.
   */
  const accidentalRight = (note: SheetNote): number =>
    leftHeadX - half - ACCIDENTAL_GAP_G * G - note.accidentalColumn * ACCIDENTAL_COLUMN_W_G * G;

  // Ledger lines behind the heads, each long enough to carry every head on its
  // step — a displaced head needs the line to reach out to it.
  ctx.lineWidth = LEDGER_W;
  const ledgerSpans = new Map<number, { left: number; right: number }>();
  for (const note of chord.notes) {
    for (const step of note.ledger) {
      const span = ledgerSpans.get(step);
      const left = headX(note) - half - LEDGER_EXTENSION;
      const right = headX(note) + half + LEDGER_EXTENSION;
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
    // An accidental stands closer to its head than a ledger line reaches, so
    // a line that would run into one stops short of its ink instead.
    let left = span.left;
    for (const note of chord.notes) {
      if (!note.accidental) continue;
      const noteY = staffTop + staffYRel(note.step);
      const [, bottom, , top] = MUSIC_GLYPH_METRICS[ACCIDENTAL_GLYPHS[note.accidental]].bbox;
      const reaches = y >= noteY - top * G - LEDGER_W && y <= noteY - bottom * G + LEDGER_W;
      if (reaches) left = Math.max(left, accidentalRight(note) + LEDGER_ACCIDENTAL_GAP_G * G);
    }
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(span.right, y);
    ctx.stroke();
  }

  for (const note of chord.notes) {
    const y = staffTop + staffYRel(note.step);
    drawGlyph(ctx, head, headX(note) - glyphCentre(head) * G, y, G);

    if (note.accidental) drawAccidentalEndingAt(ctx, note.accidental, accidentalRight(note), y, G);
    if (chord.symbol.dotted) {
      // Dots sit in a space: shift line-notes up half a space.
      const dotY = y - (note.step % 2 === 0 ? G / 2 : 0);
      drawGlyph(ctx, 'augmentationDot', rightHeadX + half + DOT_GAP_G * G, dotY, G);
    }
  }

  if (base === 'whole') return;

  const stemX = stemXPt(x, chord.stemDown);
  const topHeadY = staffTop + staffYRel(chord.notes[chord.notes.length - 1]!.step);
  const bottomHeadY = staffTop + staffYRel(chord.notes[0]!.step);
  const flags = beamCountFor(base);

  let tipY: number;
  if (chord.beamId !== null) {
    const beam = beams[chord.beamId]!;
    const dx = beam.x2Pt - beam.x1Pt;
    tipY = dx === 0 ? beam.y1Pt : beam.y1Pt + ((stemX - beam.x1Pt) / dx) * (beam.y2Pt - beam.y1Pt);
  } else {
    // A 32nd's and a 64th's flags stack up past a normal stem's end, and
    // their anchors say how much further the stem has to run to meet them.
    const stem = flaggedStemG(flags, chord.stemDown) * G;
    tipY = chord.stemDown ? bottomHeadY + stem : topHeadY - stem;
  }

  // The stem starts where the far head's stem anchor says, meeting its edge.
  const rise = STEM_ANCHOR_RISE_G * G;
  ctx.lineWidth = STEM_W;
  ctx.beginPath();
  ctx.moveTo(stemX, chord.stemDown ? topHeadY + rise : bottomHeadY - rise);
  ctx.lineTo(stemX, tipY);
  ctx.stroke();

  if (chord.beamId === null && flags !== 0) {
    // One glyph carries all of a note's flags, its origin on the stem's left
    // edge and as far short of the tip as its anchor says.
    drawGlyph(
      ctx,
      flagGlyphFor(flags, chord.stemDown),
      stemX - STEM_W / 2,
      tipY + flagAnchorYG(flags, chord.stemDown) * G,
      G,
    );
  }
}

/** Size tuplet numerals are set at: small enough not to compete with the notes. */
const TUPLET_SPACE = 0.8 * G;

/**
 * The tuplet numeral, centred on its beam on the side away from the heads:
 * above an up-stem run, below a down-stem one, clear of the beam either way.
 */
function drawTupletNumeral(ctx: DrawSurface, beam: SheetBeam): void {
  if (beam.tupletCount === null) return;
  const midX = (beam.x1Pt + beam.x2Pt) / 2;
  const midY = (beam.y1Pt + beam.y2Pt) / 2;
  // The digits stand on their origin, so below the beam it goes their height lower.
  const y = beam.stemDown ? midY + 1.8 * G : midY - 0.6 * G;
  drawDigitRun(ctx, 'tuplet', beam.tupletCount, midX, y, TUPLET_SPACE);
}

/**
 * The first beam runs the whole group; the ones after it join only the notes
 * that carry them, or stand as short stubs off a note that carries one alone.
 */
function drawBeam(ctx: DrawSurface, beam: SheetBeam): void {
  const t = BEAM_THICKNESS_G * G;
  const towardHeads = beam.stemDown ? -1 : 1;
  const span = { y1: beam.y1Pt, y2: beam.y2Pt };
  const segment = (fromX: number, toX: number, level: number): void => {
    const dy = level * towardHeads * BEAM_SPACING_G * G;
    const fromY = beamYAt(span, beam.x1Pt, beam.x2Pt, fromX) + dy;
    const toY = beamYAt(span, beam.x1Pt, beam.x2Pt, toX) + dy;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY - t / 2);
    ctx.lineTo(toX, toY - t / 2);
    ctx.lineTo(toX, toY + t / 2);
    ctx.lineTo(fromX, fromY + t / 2);
    ctx.closePath();
    ctx.fill();
  };
  segment(beam.x1Pt, beam.x2Pt, 0);
  beam.secondary.forEach((pieces, index) => {
    for (const piece of pieces) {
      const [fromX, toX] = beamPieceXs(beam.stemXsPt, piece, G);
      segment(fromX, toX, index + 1);
    }
  });
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
  ctx: DrawSurface,
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
      drawAccidentalCentred(ctx, sign, x, top + staffYRel(steps[i] as number), G);
    }
  }
}

/**
 * Time signature digits on both staffs (first system only): each number a row
 * of digits set by their advances and centred, the numerator's centred on the
 * staff's upper half and the denominator's on its lower — so a 12 sits as
 * squarely as a 4.
 */
function drawTimeSignature(
  ctx: DrawSurface,
  system: SheetSystem,
  metrics: SheetPageMetrics,
  fifths: number,
  timeSignature: TimeSignature,
): void {
  const x =
    system.xPt + metrics.clefAreaPt + keySignatureWidthPt(fifths) + metrics.timeSigAreaPt * 0.4;
  for (const top of [system.trebleTopPt, system.bassTopPt]) {
    drawDigitRun(ctx, 'timeSig', timeSignature.numerator, x, top + G, G);
    drawDigitRun(ctx, 'timeSig', timeSignature.denominator, x, top + 3 * G, G);
  }
}

/**
 * The brace joining the two staffs: the font's brace, scaled evenly until its
 * box runs from the treble's top line to the bass's bottom one, just left of
 * the system.
 */
function drawBrace(ctx: DrawSurface, x: number, top: number, bottom: number): void {
  const [, low, right, high] = MUSIC_GLYPH_METRICS.brace.bbox;
  const space = (bottom - top) / (high - low);
  drawGlyph(ctx, 'brace', x - BRACE_GAP_PT - right * space, top + high * space, space);
}

/**
 * A clef starting at `x`: a G clef on its G line, an F clef on its F line.
 * Full size where a system opens; where one turns over mid-staff, the font's
 * smaller change clef, which sits on the same line.
 */
function drawClef(
  ctx: DrawSurface,
  clef: ClefKind,
  x: number,
  staffTop: number,
  change: boolean,
): void {
  const line = clef === 'treble' ? staffTop + 3 * G : staffTop + G;
  drawGlyph(ctx, clefGlyphFor(clef, change), x, line, G);
}

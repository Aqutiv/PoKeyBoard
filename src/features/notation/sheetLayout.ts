import type { TimeSignature } from '@/domain/takeTypes';
import { beatDurationMs, clamp, wholeNoteDurationMs } from '@/utils/timing';
import type { ChordGroup, ScoreLayout } from './notationLayout';
import type { DurationSymbol } from './quantization';
import type { StaffKind } from './staffMapping';

/**
 * Paginated engraving layout for printable sheet music. Consumes the same
 * `ScoreLayout` the on-screen view uses and produces pages of justified
 * grand-staff systems in PDF points. Pure geometry — no DOM, no canvas.
 */
export type PaperSize = 'a4' | 'letter';
/** Sheet output always snaps to a grid ('off' would give one column per note). */
export type SheetGrid = '1/8' | '1/16';

/** Staff space on paper (pt); all engraving dimensions scale from this. */
export const SHEET_GAP_PT = 5.4;
const G = SHEET_GAP_PT;

/** Ideal stem length in staff spaces. */
export const STEM_LENGTH_G = 3.5;
/** Shortest stem a beam may leave. */
export const MIN_BEAM_STEM_G = 2.8;
/** Maximum beam slant across a run. */
export const BEAM_SLANT_MAX_G = 1;
export const BEAM_THICKNESS_G = 0.5;
/** Center-to-center offset of a secondary beam, toward the noteheads. */
export const BEAM_SPACING_G = 0.75;
/** Notehead horizontal radius. */
export const HEAD_RX_G = 0.64;
/** Stem x offset from the head center (inset from the head edge). */
export const STEM_X_G = HEAD_RX_G - 0.1;
/** Extra lead reserved before a column that carries an accidental. */
export const ACCIDENTAL_LEAD_G = 1.7;

// Horizontal spacing (staff spaces).
const START_PAD_G = 1.6;
const EMPTY_MEASURE_W_G = 10;
const MIN_ADV_G = 2.4;
const MAX_ADV_G = 13;
const LEAD_SILENCE_MAX_G = 8;
const LAST_ADV_MIN_G = 3;
/** The final (ragged-right) system may stretch at most this far. */
const FINAL_STRETCH_MAX = 1.15;

export interface SheetPageMetrics {
  paper: PaperSize;
  pageWidthPt: number;
  pageHeightPt: number;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  contentWidthPt: number;
  gapPt: number;
  staffHeightPt: number;
  /** Treble bottom line → bass top line. */
  interStaffGapPt: number;
  minSystemGapPt: number;
  /** Page-1 header reserved for title/subtitle/tempo. */
  titleBlockHeightPt: number;
  footerHeightPt: number;
  /** Per-system prefix for brace + clefs. */
  clefAreaPt: number;
  /** Extra prefix on the first system only. */
  timeSigAreaPt: number;
}

const PAPER_DIMS: Record<PaperSize, { w: number; h: number }> = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
};

export function metricsFor(paper: PaperSize): SheetPageMetrics {
  const { w, h } = PAPER_DIMS[paper];
  const marginTopPt = 46;
  const marginRightPt = 40;
  const marginBottomPt = 46;
  const marginLeftPt = 40;
  return {
    paper,
    pageWidthPt: w,
    pageHeightPt: h,
    marginTopPt,
    marginRightPt,
    marginBottomPt,
    marginLeftPt,
    contentWidthPt: w - marginLeftPt - marginRightPt,
    gapPt: G,
    staffHeightPt: 4 * G,
    interStaffGapPt: 34,
    minSystemGapPt: 26,
    titleBlockHeightPt: 118,
    footerHeightPt: 28,
    clefAreaPt: 38,
    timeSigAreaPt: 26,
  };
}

export interface SheetNote {
  midi: number;
  step: number;
  accidental: '#' | null;
  ledger: number[];
}

export interface SheetChord {
  staff: StaffKind;
  /** Sorted by step ascending (lowest pitch first). */
  notes: SheetNote[];
  symbol: DurationSymbol;
  stemDown: boolean;
  /** Index into the owning measure's `beams`, or null for a flagged chord. */
  beamId: number | null;
}

export interface SheetColumn {
  timeMs: number;
  /** Absolute page x of the notehead center. */
  xPt: number;
  treble: SheetChord | null;
  bass: SheetChord | null;
}

export interface SheetBeam {
  staff: StaffKind;
  stemDown: boolean;
  /** 1 for eighths, 2 for sixteenths. */
  beamCount: 1 | 2;
  x1Pt: number;
  y1Pt: number;
  x2Pt: number;
  y2Pt: number;
}

export interface SheetMeasure {
  /** 0-based global measure index. */
  index: number;
  xPt: number;
  widthPt: number;
  /** Draw a whole rest on both staffs. */
  empty: boolean;
  columns: SheetColumn[];
  beams: SheetBeam[];
}

export interface SheetSystem {
  xPt: number;
  /** Staff-line extent from xPt (clef area + measures). */
  widthPt: number;
  trebleTopPt: number;
  bassTopPt: number;
  measures: SheetMeasure[];
  /** 1-based label at the system start. */
  firstMeasureNumber: number;
  /** True only on the first system of the piece. */
  showTimeSignature: boolean;
  /** Draw the final thin+thick barline at the system end. */
  isLast: boolean;
}

export interface SheetTitleBlock {
  title: string;
  subtitle: string;
  bpm: number;
  credit: string;
}

export interface SheetPage {
  pageNumber: number;
  metrics: SheetPageMetrics;
  timeSignature: TimeSignature;
  /** Present on page 1 only. */
  titleBlock: SheetTitleBlock | null;
  systems: SheetSystem[];
}

export interface SheetLayoutOptions {
  paper: PaperSize;
  timeSignature: TimeSignature;
  bpm: number;
  title: string;
  /** Pre-formatted (localized) subtitle line, e.g. the recording date. */
  subtitle: string;
  credit: string;
}

export interface SheetLayoutResult {
  pages: SheetPage[];
  measureCount: number;
  systemCount: number;
}

/** y of a staff step relative to that staff's top line (pt; down is +). */
export function staffYRel(step: number): number {
  return 4 * G - (step * G) / 2;
}

/** Stem x for a chord drawn at `headXPt` (stem hugs the head edge). */
export function stemXPt(headXPt: number, stemDown: boolean): number {
  return headXPt + (stemDown ? -1 : 1) * STEM_X_G * G;
}

/** Staff-relative y of the head the stem grows away from. */
export function stemAnchorYRel(chord: SheetChord): number {
  const note = chord.stemDown ? chord.notes[0]! : chord.notes[chord.notes.length - 1]!;
  return staffYRel(note.step);
}

interface WorkColumn {
  timeMs: number;
  /** Natural head-center offset from the measure start, in staff spaces. */
  headOffG: number;
  treble: SheetChord | null;
  bass: SheetChord | null;
}

interface WorkMeasure {
  index: number;
  startMs: number;
  columns: WorkColumn[];
  naturalWG: number;
}

interface WorkSystem {
  measures: SheetMeasure[];
  widthPt: number;
  /** Space needed above the treble top line / below the bass bottom line. */
  abovePt: number;
  belowPt: number;
}

export function layoutSheet(score: ScoreLayout, options: SheetLayoutOptions): SheetLayoutResult {
  const metrics = metricsFor(options.paper);
  const workMeasures = buildWorkMeasures(score, options.bpm);
  const systems = packSystems(workMeasures, metrics, options);
  const pages = paginate(systems, metrics, options);
  return { pages, measureCount: score.measures.length, systemCount: systems.length };
}

/** Column advance for a time gap, in staff spaces (sub-linear in duration). */
function advanceG(deltaMs: number, wholeMs: number): number {
  return clamp(10 * Math.pow(Math.max(deltaMs, 0) / wholeMs, 0.47), MIN_ADV_G, MAX_ADV_G);
}

function columnHasAccidental(column: WorkColumn): boolean {
  for (const chord of [column.treble, column.bass]) {
    if (chord?.notes.some((note) => note.accidental !== null)) return true;
  }
  return false;
}

function toSheetChord(chord: ChordGroup): SheetChord {
  return {
    staff: chord.staff,
    notes: chord.notes.map((note) => ({
      midi: note.midi,
      step: note.step,
      accidental: note.accidental,
      ledger: note.ledger,
    })),
    symbol: chord.symbol,
    stemDown: chord.stemDown,
    beamId: null,
  };
}

/** Group chords into per-measure columns and compute natural spacing. */
function buildWorkMeasures(score: ScoreLayout, bpm: number): WorkMeasure[] {
  const wholeMs = wholeNoteDurationMs(bpm);
  const chordsByMeasure: ChordGroup[][] = score.measures.map(() => []);
  for (const chord of score.chords) {
    const index = Math.floor(chord.displayStartMs / score.barMs);
    if (index >= 0 && index < chordsByMeasure.length) chordsByMeasure[index]!.push(chord);
  }

  return score.measures.map((measure) => {
    const byTime = new Map<number, WorkColumn>();
    for (const chord of chordsByMeasure[measure.index]!) {
      let column = byTime.get(chord.displayStartMs);
      if (!column) {
        column = { timeMs: chord.displayStartMs, headOffG: 0, treble: null, bass: null };
        byTime.set(chord.displayStartMs, column);
      }
      if (chord.staff === 'treble') column.treble = toSheetChord(chord);
      else column.bass = toSheetChord(chord);
    }
    const columns = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
    if (columns.length === 0) {
      return {
        index: measure.index,
        startMs: measure.startMs,
        columns,
        naturalWG: EMPTY_MEASURE_W_G,
      };
    }

    const lead = columns[0]!.timeMs - measure.startMs;
    let offset =
      START_PAD_G + (lead > 0 ? Math.min(advanceG(lead, wholeMs), LEAD_SILENCE_MAX_G) : 0);
    for (let i = 0; i < columns.length; i += 1) {
      const column = columns[i]!;
      if (i > 0) offset += advanceG(column.timeMs - columns[i - 1]!.timeMs, wholeMs);
      if (columnHasAccidental(column)) offset += ACCIDENTAL_LEAD_G;
      column.headOffG = offset;
    }
    const tailMs = measure.endMs - columns[columns.length - 1]!.timeMs;
    const naturalWG = offset + clamp(advanceG(tailMs, wholeMs), LAST_ADV_MIN_G, MAX_ADV_G);
    return { index: measure.index, startMs: measure.startMs, columns, naturalWG };
  });
}

/** Greedily fill systems, justify, assign x positions, and build beams. */
function packSystems(
  workMeasures: WorkMeasure[],
  metrics: SheetPageMetrics,
  options: SheetLayoutOptions,
): WorkSystem[] {
  const availableFor = (systemIndex: number): number =>
    metrics.contentWidthPt - metrics.clefAreaPt - (systemIndex === 0 ? metrics.timeSigAreaPt : 0);

  const rows: { measures: WorkMeasure[]; stretch: number }[] = [];
  let current: WorkMeasure[] = [];
  let currentWPt = 0;
  for (const measure of workMeasures) {
    const wPt = measure.naturalWG * G;
    const available = availableFor(rows.length);
    if (current.length > 0 && currentWPt + wPt > available) {
      rows.push({ measures: current, stretch: available / currentWPt });
      current = [];
      currentWPt = 0;
    }
    current.push(measure);
    currentWPt += wPt;
  }
  if (current.length > 0) {
    const available = availableFor(rows.length);
    rows.push({ measures: current, stretch: Math.min(available / currentWPt, FINAL_STRETCH_MAX) });
  }

  return rows.map((row, systemIndex) => {
    let x =
      metrics.marginLeftPt + metrics.clefAreaPt + (systemIndex === 0 ? metrics.timeSigAreaPt : 0);
    const measures: SheetMeasure[] = row.measures.map((wm) => {
      const widthPt = wm.naturalWG * row.stretch * G;
      const columns: SheetColumn[] = wm.columns.map((column) => ({
        timeMs: column.timeMs,
        xPt: x + column.headOffG * row.stretch * G,
        treble: column.treble,
        bass: column.bass,
      }));
      const measure: SheetMeasure = {
        index: wm.index,
        xPt: x,
        widthPt,
        empty: columns.length === 0,
        columns,
        beams: [],
      };
      x += widthPt;
      return measure;
    });

    for (let i = 0; i < measures.length; i += 1) {
      buildBeams(measures[i]!, row.measures[i]!.startMs, options);
    }
    const extents = systemExtents(measures);
    return {
      measures,
      widthPt: x - metrics.marginLeftPt,
      abovePt: extents.abovePt,
      belowPt: extents.belowPt,
    };
  });
}

function beamable(chord: SheetChord): boolean {
  return (
    !chord.symbol.dotted && (chord.symbol.base === 'eighth' || chord.symbol.base === 'sixteenth')
  );
}

interface BeamMember {
  column: SheetColumn;
  chord: SheetChord;
}

/**
 * Beam runs of equal undotted eighths/sixteenths that share a beat group on
 * one staff. Compound meters (6/8, 9/8, …) group per dotted beat-unit trio.
 * Beam y values are staff-relative here; `paginate` shifts them to page space.
 */
function buildBeams(
  measure: SheetMeasure,
  measureStartMs: number,
  options: SheetLayoutOptions,
): void {
  const { timeSignature, bpm } = options;
  const beatMs = beatDurationMs(bpm, timeSignature);
  const compound = timeSignature.numerator % 3 === 0 && timeSignature.denominator >= 8;
  const groupMs = compound ? beatMs * 3 : beatMs;

  for (const staff of ['treble', 'bass'] as const) {
    let run: BeamMember[] = [];
    let runBase: DurationSymbol['base'] | null = null;
    let runGroup = -1;

    const flush = (): void => {
      if (run.length >= 2) emitBeam(measure, staff, run);
      run = [];
      runBase = null;
    };

    for (const column of measure.columns) {
      const chord = staff === 'treble' ? column.treble : column.bass;
      if (!chord) continue;
      if (!beamable(chord)) {
        flush();
        continue;
      }
      const group = Math.floor((column.timeMs - measureStartMs) / groupMs + 1e-6);
      if (run.length > 0 && (chord.symbol.base !== runBase || group !== runGroup)) flush();
      run.push({ column, chord });
      runBase = chord.symbol.base;
      runGroup = group;
    }
    flush();
  }
}

function emitBeam(measure: SheetMeasure, staff: StaffKind, run: BeamMember[]): void {
  const downVotes = run.filter((member) => member.chord.stemDown).length;
  const stemDown = downVotes * 2 >= run.length;
  const dir = stemDown ? 1 : -1;

  const xs = run.map((member) => stemXPt(member.column.xPt, stemDown));
  const anchors = run.map((member) => {
    const note = stemDown
      ? member.chord.notes[0]!
      : member.chord.notes[member.chord.notes.length - 1]!;
    return staffYRel(note.step);
  });
  const tipFirst = anchors[0]! + dir * STEM_LENGTH_G * G;
  const tipLast = anchors[anchors.length - 1]! + dir * STEM_LENGTH_G * G;
  const slant = clamp(tipLast - tipFirst, -BEAM_SLANT_MAX_G * G, BEAM_SLANT_MAX_G * G);
  const x1 = xs[0]!;
  const x2 = xs[xs.length - 1]!;

  // Shift the whole beam outward until every member keeps a minimum stem.
  let shift = 0;
  for (let i = 0; i < run.length; i += 1) {
    const lineY = tipFirst + ((xs[i]! - x1) / (x2 - x1)) * slant;
    const required = anchors[i]! + dir * MIN_BEAM_STEM_G * G;
    const violation = dir === 1 ? required - lineY : lineY - required;
    if (violation > shift) shift = violation;
  }
  const y1 = tipFirst + dir * shift;

  const beamId = measure.beams.length;
  measure.beams.push({
    staff,
    stemDown,
    beamCount: run[0]!.chord.symbol.base === 'sixteenth' ? 2 : 1,
    x1Pt: x1,
    y1Pt: y1,
    x2Pt: x2,
    y2Pt: y1 + slant,
  });
  for (const member of run) {
    member.chord.stemDown = stemDown;
    member.chord.beamId = beamId;
  }
}

/** Space needed above the treble staff and below the bass staff (pt). */
function systemExtents(measures: SheetMeasure[]): { abovePt: number; belowPt: number } {
  const headPad = 0.5 * G;
  let abovePt = 3 * G; // floor reserves room for the measure number
  let belowPt = 2.5 * G;

  for (const measure of measures) {
    for (const column of measure.columns) {
      for (const chord of [column.treble, column.bass]) {
        if (!chord) continue;
        let top = staffYRel(chord.notes[chord.notes.length - 1]!.step) - headPad;
        let bottom = staffYRel(chord.notes[0]!.step) + headPad;
        if (chord.symbol.base !== 'whole' && chord.beamId === null) {
          if (chord.stemDown) bottom = Math.max(bottom, stemAnchorYRel(chord) + STEM_LENGTH_G * G);
          else top = Math.min(top, stemAnchorYRel(chord) - STEM_LENGTH_G * G);
        }
        if (chord.staff === 'treble') abovePt = Math.max(abovePt, -top);
        else belowPt = Math.max(belowPt, bottom - 4 * G);
      }
    }
    for (const beam of measure.beams) {
      const pad = (BEAM_THICKNESS_G / 2) * G;
      if (beam.staff === 'treble' && !beam.stemDown) {
        abovePt = Math.max(abovePt, -(Math.min(beam.y1Pt, beam.y2Pt) - pad));
      } else if (beam.staff === 'bass' && beam.stemDown) {
        belowPt = Math.max(belowPt, Math.max(beam.y1Pt, beam.y2Pt) + pad - 4 * G);
      }
    }
  }
  return { abovePt, belowPt };
}

/** Flow systems down pages and translate beams to absolute page space. */
function paginate(
  systems: WorkSystem[],
  metrics: SheetPageMetrics,
  options: SheetLayoutOptions,
): SheetPage[] {
  const corePt = metrics.staffHeightPt * 2 + metrics.interStaffGapPt;
  const contentBottom = metrics.pageHeightPt - metrics.marginBottomPt - metrics.footerHeightPt;
  const pages: SheetPage[] = [];
  let currentSystems: SheetSystem[] = [];
  let cursorY = metrics.marginTopPt + metrics.titleBlockHeightPt;

  const finalizePage = (): void => {
    const pageNumber = pages.length + 1;
    pages.push({
      pageNumber,
      metrics,
      timeSignature: options.timeSignature,
      titleBlock:
        pageNumber === 1
          ? {
              title: options.title,
              subtitle: options.subtitle,
              bpm: options.bpm,
              credit: options.credit,
            }
          : null,
      systems: currentSystems,
    });
    currentSystems = [];
    cursorY = metrics.marginTopPt;
  };

  for (let s = 0; s < systems.length; s += 1) {
    const system = systems[s]!;
    const totalH = system.abovePt + corePt + system.belowPt;
    if (currentSystems.length > 0 && cursorY + totalH > contentBottom) finalizePage();

    const trebleTopPt = cursorY + system.abovePt;
    const bassTopPt = trebleTopPt + metrics.staffHeightPt + metrics.interStaffGapPt;
    for (const measure of system.measures) {
      for (const beam of measure.beams) {
        const staffTop = beam.staff === 'treble' ? trebleTopPt : bassTopPt;
        beam.y1Pt += staffTop;
        beam.y2Pt += staffTop;
      }
    }
    currentSystems.push({
      xPt: metrics.marginLeftPt,
      widthPt: system.widthPt,
      trebleTopPt,
      bassTopPt,
      measures: system.measures,
      firstMeasureNumber: system.measures[0]!.index + 1,
      showTimeSignature: s === 0,
      isLast: s === systems.length - 1,
    });
    cursorY += totalH + metrics.minSystemGapPt;
  }
  finalizePage();
  return pages;
}

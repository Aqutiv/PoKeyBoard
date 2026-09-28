import type { QuantizationSetting, TimeSignature } from '@/domain/takeTypes';
import { clamp, wholeNoteDurationMs } from '@/utils/timing';
import {
  measureIndexAt,
  type BeamGroup,
  type ChordGroup,
  type HeadShift,
  type LaidOutRest,
  type MeasureInfo,
  type OctaveSpan,
  type PedalSpan,
  type ScoreLayout,
} from './notationLayout';
import { accidentalSlots } from './accidentalStacking';
import { beamSpanFor, beamYAt, BEAM_THICKNESS_G, type BeamPiece } from './beamGeometry';
import type { DynamicEvent, DynamicMark, HairpinEvent } from './dynamics';
import {
  ACCIDENTAL_GLYPHS,
  digitGlyphsFor,
  dynamicInkG,
  flagGlyphFor,
  flaggedStemReachG,
  glyphWidth,
  noteheadGlyphFor,
  noteheadHalfWidth,
  runAdvance,
  secondShiftG,
  STEM_THICKNESS_G,
} from './glyphs/engravingGlyphs';
import {
  ENGRAVING_DEFAULTS,
  MUSIC_GLYPH_ANCHORS,
  MUSIC_GLYPH_METRICS,
  type MusicGlyphName,
} from './glyphs/musicGlyphMetrics';
import { normalizeFifths, type AccidentalKind } from './keySignature';
import { beamCountFor, type BeamCount, type DurationSymbol } from './quantization';
import type { ClefKind, StaffKind } from './staffMapping';

/**
 * Paginated engraving layout for printable sheet music. Consumes the same
 * `ScoreLayout` the on-screen view uses and produces pages of justified
 * grand-staff systems in PDF points. Pure geometry — no DOM, no canvas.
 */
export type PaperSize = 'a4' | 'letter';
/** Sheet output always snaps to a grid ('off' would give one column per note). */
export type SheetGrid = Exclude<QuantizationSetting, 'off'>;

/** Staff space on paper (pt); all engraving dimensions scale from this. */
export const SHEET_GAP_PT = 5.4;
const G = SHEET_GAP_PT;

/**
 * Room kept around a notehead's centre for what attaches beside it — a tie's
 * end, an octave line's reach — a little wider than the head itself.
 */
export const HEAD_RX_G = 0.64;
/**
 * Stem centre-line x offset from the head centre: the stem's outer edge on the
 * notehead's stem anchor, which is the head's own edge, and half a stem inside.
 */
export const STEM_X_G =
  MUSIC_GLYPH_ANCHORS.noteheadBlack.stemUpSE[0] -
  noteheadHalfWidth('quarter') -
  STEM_THICKNESS_G / 2;
/** Extra lead reserved before a column that carries an accidental. */
export const ACCIDENTAL_LEAD_G = 1.7;
/** Each further accidental column stacked left of the first. */
export const ACCIDENTAL_COLUMN_W_G = 1.4;
/** Clear space between an accidental and the head it stands before. */
export const ACCIDENTAL_GAP_G = 0.25;
/** Clear space between a chord's rightmost head and its dot. */
export const DOT_GAP_G = 0.4;
/** Width a mid-staff clef change takes at the head of a measure. */
export const CLEF_CHANGE_W_G = 3.6;
/** Horizontal pitch of the accidentals in a key signature. */
export const KEY_ACCIDENTAL_W_G = 1.15;
/** Clear space kept after the last of them, before the time signature or music. */
export const KEY_SIGNATURE_PAD_G = 0.9;

/**
 * Width the key signature takes in every system prefix. Zero for C major, so a
 * score without one is laid out exactly as it was before keys existed.
 */
export function keySignatureWidthPt(fifths: number): number {
  const count = Math.abs(normalizeFifths(fifths));
  return count === 0 ? 0 : (count * KEY_ACCIDENTAL_W_G + KEY_SIGNATURE_PAD_G) * G;
}
/** Band a system reserves above the music for a mid-score tempo mark (pt). */
export const TEMPO_MARK_SPACE_PT = 20;
/** The mark's baseline inside that band, measured from the band's top. */
export const TEMPO_MARK_BASELINE_PT = 12;

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

/** Coerce any value (e.g. a corrupt persisted setting) to a known paper size. */
export function normalizePaperSize(value: unknown): PaperSize {
  return value === 'letter' ? 'letter' : 'a4';
}

export function metricsFor(paper: PaperSize): SheetPageMetrics {
  // Never trust the incoming value blindly: a restored/corrupt setting could
  // carry an unknown string, and an undefined dimension would throw here.
  const safePaper = normalizePaperSize(paper);
  const { w, h } = PAPER_DIMS[safePaper];
  const marginTopPt = 46;
  const marginRightPt = 40;
  const marginBottomPt = 46;
  const marginLeftPt = 40;
  return {
    paper: safePaper,
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
  accidental: AccidentalKind | null;
  /** Which column left of the chord the accidental goes in, 0 nearest. */
  accidentalColumn: number;
  ledger: number[];
  /** Head-widths this head sits clear of the column; see `HeadShift`. */
  headShift: HeadShift;
  /** True when this head continues one before it, under a tie. */
  tiedFromPrev: boolean;
  /** True when a tie runs from this head into the next piece of the same note. */
  tiedToNext: boolean;
}

/**
 * A tie arc, in absolute page coordinates. A tie whose ends fall in different
 * systems is written as two of these: a stub off the end of the first and a
 * stub into the head on the second, which is how it is engraved on paper.
 */
export interface SheetTie {
  staff: StaffKind;
  /** True when the arc bows upward, away from a downward stem. */
  above: boolean;
  x1Pt: number;
  y1Pt: number;
  x2Pt: number;
  y2Pt: number;
}

export interface SheetChord {
  staff: StaffKind;
  clef: ClefKind;
  /** Sorted by step ascending (lowest pitch first). */
  notes: SheetNote[];
  /** The staff voice this chord belongs to; see `ChordGroup.voice`. */
  voice: number;
  symbol: DurationSymbol;
  stemDown: boolean;
  /** Index into the owning measure's `beams`, or null for a flagged chord. */
  beamId: number | null;
}

/** A silence engraved on one staff; see `LaidOutRest`. */
export interface SheetRest {
  symbol: DurationSymbol;
  /** Steps above the staff's bottom line the glyph is read from. */
  step: number;
}

export interface SheetColumn {
  timeMs: number;
  /** Absolute page x of the notehead center. */
  xPt: number;
  /**
   * The voices sounding on each staff at this instant, topmost first. Usually
   * one; two voices share the column's x and stem apart, as engraved.
   */
  treble: SheetChord[];
  bass: SheetChord[];
  /** The rest each staff starts here, where it is silent instead. */
  trebleRest: SheetRest | null;
  bassRest: SheetRest | null;
}

export interface SheetBeam {
  staff: StaffKind;
  stemDown: boolean;
  /** The most beams any member carries: 1 for eighths … 4 for 64ths. */
  beamCount: BeamCount;
  /** The tuplet numeral over the beam, where the run is one. */
  tupletCount: number | null;
  x1Pt: number;
  y1Pt: number;
  x2Pt: number;
  y2Pt: number;
  /** Each member's stem x, which the beams after the first are measured from. */
  stemXsPt: number[];
  /** The beams after the first; see `BeamGroup.secondary`. */
  secondary: BeamPiece[][];
}

export interface SheetMeasure {
  /** 0-based global measure index. */
  index: number;
  xPt: number;
  widthPt: number;
  /** The stretch of take time this measure covers. */
  startMs: number;
  endMs: number;
  /** Draw a whole rest on both staffs. */
  empty: boolean;
  columns: SheetColumn[];
  beams: SheetBeam[];
  /** The tempo this measure is played at. */
  bpm: number;
  /** Set on the first measure of a new tempo — engrave a "♩ = n" mark. */
  tempoMarkBpm: number | null;
  /** The clef each staff reads under here. */
  clefs: Record<StaffKind, ClefKind>;
  /**
   * Staffs whose clef turns over at this measure, so the renderer engraves the
   * new one after the bar line. Empty on the first measure of a system, where
   * the system prefix already shows it.
   */
  clefChanges: StaffKind[];
}

/**
 * A sustain-pedal bracket under the bass staff, clipped to one system. A press
 * that outlives its system is drawn open at that end and picked up on the next,
 * which is how a long pedal is engraved on paper.
 */
export interface SheetPedal {
  xFromPt: number;
  xToPt: number;
  /** True when the press began before this system, or runs past its end. */
  continuesLeft: boolean;
  continuesRight: boolean;
}

/** A dynamic mark standing between the staves. */
export interface SheetDynamic {
  xPt: number;
  mark: DynamicMark;
}

/**
 * A crescendo or diminuendo wedge, clipped to one system. A swell outliving
 * its system is left open at that end and picked up on the next.
 */
export interface SheetHairpin {
  x1Pt: number;
  x2Pt: number;
  grow: boolean;
  continuesLeft: boolean;
  continuesRight: boolean;
}

/** An 8va or 8vb line over or under a system's music. */
export interface SheetOctave {
  staff: StaffKind;
  up: boolean;
  x1Pt: number;
  x2Pt: number;
  /**
   * y of the line on the page, where it stands clear of the music under it
   * (`octaveLineRel`). The whole mark keeps within `OCTAVE_BAND_HALF_G` of it.
   */
  yPt: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

export interface SheetSystem {
  xPt: number;
  /** Staff-line extent from xPt (clef area + measures). */
  widthPt: number;
  /** Baseline for this system's tempo marks, above everything else it draws. */
  tempoMarkBaselinePt: number;
  trebleTopPt: number;
  bassTopPt: number;
  measures: SheetMeasure[];
  /** Tie arcs spanning this system's music; see `SheetTie`. */
  ties: SheetTie[];
  /** Pedal brackets under the bass staff; see `SheetPedal`. */
  pedals: SheetPedal[];
  /** y of the pedal row, below the bass staff (absolute page pt). */
  pedalRowPt: number;
  /** Octave lines above the treble or below the bass; see `SheetOctave`. */
  octaves: SheetOctave[];
  /** Dynamic marks between the staves; see `SheetDynamic`. */
  dynamics: SheetDynamic[];
  /** Hairpins between the staves; see `SheetHairpin`. */
  hairpins: SheetHairpin[];
  /** Baseline of the dynamics row, in the gap between the staves. */
  dynamicsRowPt: number;
  /** The clef each staff opens this system under. */
  clefs: Record<StaffKind, ClefKind>;
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
  /** Sharps (positive) or flats (negative) every system prefix carries. */
  keySignature: number;
  /** Present on page 1 only. */
  titleBlock: SheetTitleBlock | null;
  systems: SheetSystem[];
}

export interface SheetLayoutOptions {
  paper: PaperSize;
  timeSignature: TimeSignature;
  /** Sharps (positive) or flats (negative); 0 (C major) prints nothing. */
  keySignature?: number;
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
  treble: SheetChord[];
  bass: SheetChord[];
  trebleRest: SheetRest | null;
  bassRest: SheetRest | null;
}

interface WorkMeasure {
  index: number;
  startMs: number;
  endMs: number;
  columns: WorkColumn[];
  naturalWG: number;
  bpm: number;
  tempoMarkBpm: number | null;
  clefs: Record<StaffKind, ClefKind>;
  /** Staffs whose clef differs from the measure before it, system aside. */
  clefTurnsOver: StaffKind[];
}

interface WorkSystem {
  measures: SheetMeasure[];
  ties: SheetTie[];
  pedals: SheetPedal[];
  octaves: SheetOctave[];
  dynamics: SheetDynamic[];
  hairpins: SheetHairpin[];
  /** Extra room this system needs between its staves, for the dynamics row. */
  interStaffExtraPt: number;
  clefs: Record<StaffKind, ClefKind>;
  widthPt: number;
  /** Space needed above the treble top line / below the bass bottom line. */
  abovePt: number;
  belowPt: number;
}

export function layoutSheet(score: ScoreLayout, options: SheetLayoutOptions): SheetLayoutResult {
  const metrics = metricsFor(options.paper);
  const workMeasures = trimTrailingEmpty(buildWorkMeasures(score));
  const systems = packSystems(workMeasures, score, metrics, options);
  const pages = paginate(systems, metrics, options);
  return { pages, measureCount: workMeasures.length, systemCount: systems.length };
}

/**
 * Drop the measures after the last one that has a note in it. The score on
 * screen deliberately keeps blank bars past the end — they are the space you
 * record into, and a take ending exactly on a bar line gets one more on top of
 * that — but printed before the final barline they read as an engraving
 * mistake. Rest bars *inside* the piece are real music and always survive.
 *
 * A score with no notes at all keeps its scaffold, so the export preview of an
 * empty take still shows staves rather than nothing.
 */
function trimTrailingEmpty(measures: WorkMeasure[]): WorkMeasure[] {
  let last = measures.length - 1;
  while (last >= 0 && measures[last]!.columns.length === 0) last -= 1;
  return last < 0 ? measures : measures.slice(0, last + 1);
}

/** Column advance for a time gap, in staff spaces (sub-linear in duration). */
function advanceG(deltaMs: number, wholeMs: number): number {
  return clamp(10 * Math.pow(Math.max(deltaMs, 0) / wholeMs, 0.47), MIN_ADV_G, MAX_ADV_G);
}

/**
 * How many accidental column slots the widest stack here needs (0 if none): a
 * double flat fills two.
 */
function accidentalColumnsIn(column: WorkColumn): number {
  let columns = 0;
  for (const chord of [...column.treble, ...column.bass]) {
    for (const note of chord.notes) {
      if (note.accidental === null) continue;
      columns = Math.max(columns, note.accidentalColumn + accidentalSlots(note.accidental));
    }
  }
  return columns;
}

function toSheetChord(chord: ChordGroup): SheetChord {
  return {
    staff: chord.staff,
    clef: chord.clef,
    notes: chord.notes.map((note) => ({
      midi: note.midi,
      step: note.step,
      accidental: note.accidental,
      accidentalColumn: note.accidentalColumn,
      ledger: note.ledger,
      headShift: note.headShift,
      tiedFromPrev: note.tiedFromPrev,
      tiedToNext: note.tiedToNext,
    })),
    voice: chord.voice,
    symbol: chord.symbol,
    stemDown: chord.stemDown,
    // The layout's own index; `buildBeams` swaps it for this measure's.
    beamId: chord.beamId,
  };
}

/** Group chords into per-measure columns and compute natural spacing. */
function buildWorkMeasures(score: ScoreLayout): WorkMeasure[] {
  const chordsByMeasure: ChordGroup[][] = score.measures.map(() => []);
  for (const chord of score.chords) {
    const index = measureIndexAt(score.measures, chord.displayStartMs);
    if (index !== null) chordsByMeasure[index]!.push(chord);
  }
  const restsByMeasure: LaidOutRest[][] = score.measures.map(() => []);
  for (const rest of score.rests) {
    const index = measureIndexAt(score.measures, rest.displayStartMs);
    if (index !== null) restsByMeasure[index]!.push(rest);
  }

  return score.measures.map((measure, position) => {
    // Spacing is relative to the local whole note, so bars either side of a
    // tempo change engrave the same rhythms at the same widths.
    const wholeMs = wholeNoteDurationMs(measure.bpm);
    const previous = position === 0 ? null : (score.measures[position - 1] as MeasureInfo);
    const tempoMarkBpm = previous !== null && previous.bpm !== measure.bpm ? measure.bpm : null;
    const clefTurnsOver: StaffKind[] = [];
    if (previous !== null) {
      for (const staff of ['treble', 'bass'] as const) {
        if (previous.clefs[staff] !== measure.clefs[staff]) clefTurnsOver.push(staff);
      }
    }
    const byTime = new Map<number, WorkColumn>();
    const columnAt = (timeMs: number): WorkColumn => {
      let column = byTime.get(timeMs);
      if (!column) {
        column = {
          timeMs,
          headOffG: 0,
          treble: [],
          bass: [],
          trebleRest: null,
          bassRest: null,
        };
        byTime.set(timeMs, column);
      }
      return column;
    };
    for (const chord of chordsByMeasure[measure.index]!) {
      const column = columnAt(chord.displayStartMs);
      // score.chords already runs topmost voice first within a stack.
      if (chord.staff === 'treble') column.treble.push(toSheetChord(chord));
      else column.bass.push(toSheetChord(chord));
    }
    // A rest takes a column of its own where the other staff has nothing at
    // that instant, and shares one where it does.
    for (const rest of restsByMeasure[measure.index]!) {
      const column = columnAt(rest.displayStartMs);
      const entry: SheetRest = { symbol: rest.symbol, step: rest.step };
      if (rest.staff === 'treble') column.trebleRest = entry;
      else column.bassRest = entry;
    }
    const columns = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
    if (columns.length === 0) {
      return {
        index: measure.index,
        startMs: measure.startMs,
        endMs: measure.endMs,
        columns,
        naturalWG: EMPTY_MEASURE_W_G + clefTurnsOver.length * CLEF_CHANGE_W_G,
        bpm: measure.bpm,
        tempoMarkBpm,
        clefs: measure.clefs,
        clefTurnsOver,
      };
    }

    const lead = columns[0]!.timeMs - measure.startMs;
    let offset =
      START_PAD_G +
      // A clef turning over needs room after the bar line before the music.
      (clefTurnsOver.length > 0 ? CLEF_CHANGE_W_G : 0) +
      (lead > 0 ? Math.min(advanceG(lead, wholeMs), LEAD_SILENCE_MAX_G) : 0);
    for (let i = 0; i < columns.length; i += 1) {
      const column = columns[i]!;
      if (i > 0) offset += advanceG(column.timeMs - columns[i - 1]!.timeMs, wholeMs);
      const accidentals = accidentalColumnsIn(column);
      if (accidentals > 0) {
        offset += ACCIDENTAL_LEAD_G + (accidentals - 1) * ACCIDENTAL_COLUMN_W_G;
      }
      column.headOffG = offset;
    }
    const tailMs = measure.endMs - columns[columns.length - 1]!.timeMs;
    const naturalWG = offset + clamp(advanceG(tailMs, wholeMs), LAST_ADV_MIN_G, MAX_ADV_G);
    return {
      index: measure.index,
      startMs: measure.startMs,
      endMs: measure.endMs,
      columns,
      naturalWG,
      bpm: measure.bpm,
      tempoMarkBpm,
      clefs: measure.clefs,
      clefTurnsOver,
    };
  });
}

/** Greedily fill systems, justify, assign x positions, and build beams. */
function packSystems(
  workMeasures: WorkMeasure[],
  score: ScoreLayout,
  metrics: SheetPageMetrics,
  options: SheetLayoutOptions,
): WorkSystem[] {
  // The key signature repeats in every prefix, unlike the time signature.
  const keyAreaPt = keySignatureWidthPt(options.keySignature ?? 0);
  const availableFor = (systemIndex: number): number =>
    metrics.contentWidthPt -
    metrics.clefAreaPt -
    keyAreaPt -
    (systemIndex === 0 ? metrics.timeSigAreaPt : 0);

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
      metrics.marginLeftPt +
      metrics.clefAreaPt +
      keyAreaPt +
      (systemIndex === 0 ? metrics.timeSigAreaPt : 0);
    const measures: SheetMeasure[] = row.measures.map((wm, position) => {
      const widthPt = wm.naturalWG * row.stretch * G;
      const columns: SheetColumn[] = wm.columns.map((column) => ({
        timeMs: column.timeMs,
        xPt: x + column.headOffG * row.stretch * G,
        treble: column.treble,
        bass: column.bass,
        trebleRest: column.trebleRest,
        bassRest: column.bassRest,
      }));
      const measure: SheetMeasure = {
        index: wm.index,
        xPt: x,
        widthPt,
        startMs: wm.startMs,
        endMs: wm.endMs,
        empty: columns.length === 0,
        columns,
        beams: [],
        bpm: wm.bpm,
        tempoMarkBpm: wm.tempoMarkBpm,
        clefs: wm.clefs,
        // The system prefix already engraves the clef it opens under, so a
        // turnover landing on the first measure needs nothing after the bar.
        clefChanges: position === 0 ? [] : wm.clefTurnsOver,
      };
      x += widthPt;
      return measure;
    });

    for (let i = 0; i < measures.length; i += 1) {
      buildBeams(measures[i]!, score.beams);
    }
    const ties = buildTies(measures, metrics.marginLeftPt, x);
    const pedals = buildPedals(measures, score.pedals);
    const marks = buildDynamics(measures, score.dynamics, score.hairpins);
    const octaves = buildOctaves(measures, score.octaves, ties);
    const extents = systemExtents(measures);
    const carriesDynamics = marks.dynamics.length > 0 || marks.hairpins.length > 0;

    // Stacked out from the staves as an engraver stacks them: the music, then
    // an octave line standing clear of it, which needs only as much room as
    // its band reaches past the music; then a tempo mark on top and a pedal
    // bracket underneath, each in a band of its own, so neither can land on a
    // high note, a low one, or the line.
    let abovePt = extents.abovePt;
    let belowPt = extents.belowPt;
    const band = OCTAVE_BAND_HALF_G * G;
    for (const octave of octaves) {
      if (octave.up && octave.staff === 'treble') {
        abovePt = Math.max(abovePt, band - octave.yPt);
      } else if (!octave.up && octave.staff === 'bass') {
        belowPt = Math.max(belowPt, octave.yPt + band - 4 * G);
      }
    }
    if (measures.some((measure) => measure.tempoMarkBpm !== null)) abovePt += TEMPO_MARK_SPACE_PT;
    if (pedals.length > 0) belowPt += PEDAL_ROW_PT;

    return {
      measures,
      ties,
      pedals,
      octaves,
      dynamics: marks.dynamics,
      hairpins: marks.hairpins,
      interStaffExtraPt: carriesDynamics ? DYNAMICS_ROW_PT : 0,
      widthPt: x - metrics.marginLeftPt,
      abovePt,
      belowPt,
      clefs: (row.measures[0] as WorkMeasure).clefs,
    };
  });
}

/** Vertical room under the bass staff for a pedal bracket (pt). */
export const PEDAL_ROW_PT = 13;
/** The bracket's own height, measured up from its line. */
export const PEDAL_HOOK_G = 0.75;

/**
 * Extra room a system opens between its staves to carry dynamics.
 *
 * Nothing reserves that gap otherwise — a low treble note or a high bass one
 * hangs into it freely — so a system with marks has to widen, and one without
 * is laid out exactly as it was before dynamics existed.
 */
export const DYNAMICS_ROW_PT = 12;
/** Half-height of a hairpin's open end. */
export const HAIRPIN_MOUTH_G = 0.55;
/** Clear space kept between a hairpin and the ink of the mark at either end of it. */
const HAIRPIN_GAP_G = 0.5;
/** How far a hairpin's end stands off from its note where no mark is written there. */
const HAIRPIN_CLEARANCE_G = 1.2;

/**
 * Where a moment in time falls across a system, in points.
 *
 * Music is not spaced in proportion to time — a run of sixteenths is packed
 * tighter per millisecond than a whole note is — so a pedal mark can only be
 * placed by the columns around it. Interpolating between the two nearest
 * anchors puts a press exactly under the note it was taken with, which is the
 * only placement a player reads it against.
 */
function xAtTime(anchors: readonly { timeMs: number; xPt: number }[], timeMs: number): number {
  const first = anchors[0] as { timeMs: number; xPt: number };
  const last = anchors[anchors.length - 1] as { timeMs: number; xPt: number };
  if (timeMs <= first.timeMs) return first.xPt;
  if (timeMs >= last.timeMs) return last.xPt;
  let low = 0;
  let high = anchors.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((anchors[mid] as { timeMs: number }).timeMs <= timeMs) low = mid;
    else high = mid;
  }
  const a = anchors[low] as { timeMs: number; xPt: number };
  const b = anchors[high] as { timeMs: number; xPt: number };
  const span = b.timeMs - a.timeMs;
  return span <= 0 ? a.xPt : a.xPt + ((timeMs - a.timeMs) / span) * (b.xPt - a.xPt);
}

interface TimeAnchor {
  timeMs: number;
  xPt: number;
}

/** Bar lines and note columns alike anchor the mapping from time to page x. */
function timeAnchorsFor(measures: readonly SheetMeasure[]): TimeAnchor[] {
  const last = measures[measures.length - 1];
  const anchors: TimeAnchor[] = [];
  for (const measure of measures) {
    anchors.push({ timeMs: measure.startMs, xPt: measure.xPt });
    for (const column of measure.columns) anchors.push({ timeMs: column.timeMs, xPt: column.xPt });
  }
  if (last) anchors.push({ timeMs: last.endMs, xPt: last.xPt + last.widthPt });
  anchors.sort((a, b) => a.timeMs - b.timeMs);
  return anchors;
}

/** Size the 8va and 8vb labels are set at, in staff spaces. */
export const OCTAVE_LABEL_SPACE_G = 0.7;
/**
 * How far an octave line's mark reaches either side of the line, in staff
 * spaces. Its label is the tallest part of it, its ink centred on the line;
 * the hook at the far end turns in no further. So the whole mark keeps to one
 * band this far each side of the line, and that band is what has to clear the
 * music under it.
 */
export const OCTAVE_BAND_HALF_G = Math.max(
  ...(['ottavaAlta', 'ottavaBassaVb'] as const).map((name) => {
    const [, bottom, , top] = MUSIC_GLYPH_METRICS[name].bbox;
    return ((top - bottom) / 2) * OCTAVE_LABEL_SPACE_G;
  }),
);
/** How far an octave line stands off its staff where nothing under it reaches that far. */
const OCTAVE_LINE_OFFSET_G = 2.6;
/** Clear space an octave line's band keeps from the music under it. */
const OCTAVE_CLEAR_G = 0.5;
/** The pen an octave line and its hook are drawn with (pt). */
export const OCTAVE_LINE_W_PT = 0.7;

/**
 * The octave lines a system carries, clipped to the music it holds, each
 * standing clear of what it stands over (`octaveLineRel`).
 *
 * y values are staff-relative here; `paginate` moves them into page space.
 */
function buildOctaves(
  measures: readonly SheetMeasure[],
  spans: readonly OctaveSpan[],
  ties: readonly SheetTie[],
): SheetOctave[] {
  const first = measures[0];
  const last = measures[measures.length - 1];
  if (!first || !last || spans.length === 0) return [];
  const anchors = timeAnchorsFor(measures);
  const fromMs = first.startMs;
  const toMs = last.endMs;

  const octaves: SheetOctave[] = [];
  for (const span of spans) {
    if (span.toMs < fromMs || span.fromMs >= toMs) continue;
    // From the left edge of the first head it covers...
    const x1Pt = xAtTime(anchors, Math.max(span.fromMs, fromMs)) - HEAD_RX_G * G;
    // ...to past the last, so the line covers the note it applies to.
    const x2Pt = xAtTime(anchors, Math.min(span.toMs, toMs)) + HEAD_RX_G * G * 2;
    octaves.push({
      staff: span.staff,
      up: span.up,
      x1Pt,
      x2Pt,
      yPt: octaveLineRel(inkUnderRel(measures, ties, span, x1Pt, x2Pt), span.up),
      continuesLeft: span.fromMs < fromMs,
      continuesRight: span.toMs > toMs,
    });
  }
  return octaves;
}

/**
 * Where an octave line stands, relative to the top of its staff.
 *
 * Its usual distance off the staff, unless the music under it (`inkUnderRel`)
 * reaches further. Then it moves out until its band (`OCTAVE_BAND_HALF_G`)
 * clears that ink by `OCTAVE_CLEAR_G`: a head on its ledger lines, an
 * accidental, a stem and its flag, a beam, a tie.
 */
function octaveLineRel(ink: number | null, up: boolean): number {
  const clearance = (OCTAVE_CLEAR_G + OCTAVE_BAND_HALF_G) * G;
  if (up) {
    const line = -OCTAVE_LINE_OFFSET_G * G;
    return ink === null ? line : Math.min(line, ink - clearance);
  }
  const line = 4 * G + OCTAVE_LINE_OFFSET_G * G;
  return ink === null ? line : Math.max(line, ink + clearance);
}

/**
 * The furthest the music under an octave line reaches toward it, relative to
 * the top of its staff, or null for a line over nothing.
 *
 * That is everything its staff draws under the mark, or within the clear space
 * its band keeps either side of it: from the label, which starts at the first
 * head's edge, to the hook, which stands past the last head. A chord there
 * counts whole — its heads and the ledger lines through them, accidentals,
 * dots, a stem and its flag — and so does a chord beside the passage whose ink
 * reaches in: a flag or a dot swinging out from the chord before, under the
 * label, or the ledger lines, a head set off or the accidentals of the chord
 * after, reaching back under the hook. Beams, their tuplet numerals and ties
 * count where they pass under the mark, by how far out they stand there.
 *
 * The spacing on paper is fixed, so whatever stands clear of the mark across
 * the page is left out, however far out it reaches.
 */
function inkUnderRel(
  measures: readonly SheetMeasure[],
  ties: readonly SheetTie[],
  span: OctaveSpan,
  x1Pt: number,
  x2Pt: number,
): number | null {
  const { staff, up } = span;
  let ink = up ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const further = (y: number | null): void => {
    if (y !== null) ink = up ? Math.min(ink, y) : Math.max(ink, y);
  };
  // Where the mark's ink stands across the page — the label from its start, the
  // hook's pen either side of its end — with its clear space.
  const clear = OCTAVE_CLEAR_G * G;
  const from = x1Pt - clear;
  const to = x2Pt + OCTAVE_LINE_W_PT / 2 + clear;

  for (const measure of measures) {
    for (const column of measure.columns) {
      for (const chord of staff === 'treble' ? column.treble : column.bass) {
        const reach = chordReachPt(chord);
        if (column.xPt + reach.right > from && column.xPt - reach.left < to) {
          further(chordInkRel(chord, up));
        }
      }
    }
    for (const beam of measure.beams) {
      if (beam.staff === staff) further(beamInkRel(beam, up, from, to));
    }
  }

  for (const tie of ties) {
    if (tie.staff !== staff || tie.above !== up) continue;
    const a = Math.max(tie.x1Pt, from);
    const b = Math.min(tie.x2Pt, to);
    if (a >= b) continue;
    // A quadratic with its control point halfway along bows out furthest in
    // its middle, and less toward either end.
    const length = tie.x2Pt - tie.x1Pt;
    const t = clamp(0.5, (a - tie.x1Pt) / length, (b - tie.x1Pt) / length);
    const bow = 2 * t * (1 - t) * tieDepthPt(tie);
    further(up ? Math.min(tie.y1Pt, tie.y2Pt) - bow : Math.max(tie.y1Pt, tie.y2Pt) + bow);
  }
  return Number.isFinite(ink) ? ink : null;
}

/**
 * How far a chord's ink reaches left and right of its column, in points, set
 * as `drawChord` sets it: its heads, one set off either side of the stem
 * included, and the ledger lines through them; its accidentals on the left;
 * its dots, and an unbeamed stem's flag, on the right.
 */
function chordReachPt(chord: SheetChord): { left: number; right: number } {
  const { base } = chord.symbol;
  const half = noteheadHalfWidth(base) * G;
  const shift = secondShiftG(base) * G;
  const shifts = chord.notes.map((note) => note.headShift);
  const leftHead = Math.min(...shifts) * shift;
  const rightHead = Math.max(...shifts) * shift;
  let left = 0;
  let right = 0;
  for (const note of chord.notes) {
    const head = half + (note.ledger.length > 0 ? ENGRAVING_DEFAULTS.legerLineExtension * G : 0);
    left = Math.max(left, head - note.headShift * shift);
    right = Math.max(right, note.headShift * shift + head);
    if (note.accidental) {
      const accidental =
        half +
        ACCIDENTAL_GAP_G * G +
        note.accidentalColumn * ACCIDENTAL_COLUMN_W_G * G +
        glyphWidth(ACCIDENTAL_GLYPHS[note.accidental]) * G;
      left = Math.max(left, accidental - leftHead);
    }
  }
  if (chord.symbol.dotted) {
    const [, , dot] = MUSIC_GLYPH_METRICS.augmentationDot.bbox;
    right = Math.max(right, rightHead + half + DOT_GAP_G * G + dot * G);
  }
  const flags = beamCountFor(base);
  if (chord.beamId === null && flags !== 0) {
    // The flag hangs from the stem's left edge and swings out to the right.
    const [, , flag] = MUSIC_GLYPH_METRICS[flagGlyphFor(flags, chord.stemDown)].bbox;
    const stemLeft = (chord.stemDown ? -STEM_X_G : STEM_X_G) * G - (STEM_THICKNESS_G / 2) * G;
    right = Math.max(right, stemLeft + flag * G);
  }
  return { left, right };
}

/**
 * How far a chord's own ink reaches toward an octave line — above its staff
 * (`up`) or below it — relative to the staff's top: its heads, and the ledger
 * lines through them; its accidentals and dots; and an unbeamed stem with its
 * flags. A beamed chord's stem runs to its beam, which is measured on its own
 * (`beamInkRel`), and so are ties (`inkUnderRel`).
 */
function chordInkRel(chord: SheetChord, up: boolean): number {
  let ink = up ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const reach = (y: number): void => {
    ink = up ? Math.min(ink, y) : Math.max(ink, y);
  };
  /** How far a glyph set on `y` reaches that way: its box's top, or its bottom. */
  const edge = (name: MusicGlyphName, y: number): number => {
    const [, bottom, , top] = MUSIC_GLYPH_METRICS[name].bbox;
    return y - (up ? top : bottom) * G;
  };
  const head = noteheadGlyphFor(chord.symbol.base);
  for (const note of chord.notes) {
    const y = staffYRel(note.step);
    // A ledger line runs no further out than the head it carries.
    reach(edge(head, y));
    if (note.accidental) reach(edge(ACCIDENTAL_GLYPHS[note.accidental], y));
    // A dot sits in a space, so a line note's goes up half a space.
    if (chord.symbol.dotted) reach(edge('augmentationDot', y - (note.step % 2 === 0 ? G / 2 : 0)));
  }
  if (chord.symbol.base !== 'whole' && chord.beamId === null && chord.stemDown !== up) {
    const stem = flaggedStemReachG(beamCountFor(chord.symbol.base), chord.stemDown) * G;
    reach(stemAnchorYRel(chord) + (up ? -stem : stem));
  }
  return ink;
}

/**
 * How far a beam's ink reaches toward an octave line over the stretch of the
 * page from `from` to `to`, relative to its staff's top, or null where none of
 * it stands there — as a beam on the far side of its heads never does. That is
 * its outer edge, the beams after the first stacking inside it, which is
 * straight, so furthest out at one end of the stretch; and the digits of the
 * tuplet numeral set outside it.
 */
function beamInkRel(beam: SheetBeam, up: boolean, from: number, to: number): number | null {
  if (beam.stemDown === up) return null;
  let ink: number | null = null;
  const further = (y: number): void => {
    ink = ink === null ? y : up ? Math.min(ink, y) : Math.max(ink, y);
  };
  const a = Math.max(beam.x1Pt, from);
  const b = Math.min(beam.x2Pt, to);
  if (a < b) {
    const half = (BEAM_THICKNESS_G / 2) * G;
    for (const x of [a, b]) {
      const y = beamYAt({ y1: beam.y1Pt, y2: beam.y2Pt }, beam.x1Pt, beam.x2Pt, x);
      further(up ? y - half : y + half);
    }
  }
  if (beam.tupletCount !== null) {
    // Set as `drawDigitRun` sets them: by their advances, centred on the beam.
    const digits = digitGlyphsFor('tuplet', beam.tupletCount);
    const space = TUPLET_NUMERAL_SPACE_G * G;
    const y = tupletNumeralY(beam);
    let x = (beam.x1Pt + beam.x2Pt) / 2 - (runAdvance(digits) * space) / 2;
    for (const digit of digits) {
      const [left, bottom, right, top] = MUSIC_GLYPH_METRICS[digit].bbox;
      if (x + right * space > from && x + left * space < to) {
        further(y - (up ? top : bottom) * space);
      }
      x += MUSIC_GLYPH_METRICS[digit].advance * space;
    }
  }
  return ink;
}

/** The pedal brackets a system carries, clipped to the music it holds. */
function buildPedals(measures: readonly SheetMeasure[], spans: readonly PedalSpan[]): SheetPedal[] {
  const first = measures[0];
  const last = measures[measures.length - 1];
  if (!first || !last || spans.length === 0) return [];
  const anchors = timeAnchorsFor(measures);

  const fromMs = first.startMs;
  const toMs = last.endMs;
  const pedals: SheetPedal[] = [];
  for (const span of spans) {
    if (span.toMs <= fromMs || span.fromMs >= toMs) continue;
    const xFromPt = xAtTime(anchors, Math.max(span.fromMs, fromMs));
    const xToPt = xAtTime(anchors, Math.min(span.toMs, toMs));
    pedals.push({
      xFromPt,
      xToPt: Math.max(xToPt, xFromPt + G),
      continuesLeft: span.fromMs < fromMs,
      continuesRight: span.toMs > toMs,
    });
  }
  return pedals;
}

/**
 * The dynamics a system carries, clipped to the music it holds.
 *
 * A mark belongs under the note it applies to, so it is placed by the columns
 * around it exactly as a pedal press is. A hairpin keeps clear of the marks at
 * either end of it, since a wedge running into a letter reads as neither.
 */
function buildDynamics(
  measures: readonly SheetMeasure[],
  marks: readonly DynamicEvent[],
  hairpins: readonly HairpinEvent[],
): { dynamics: SheetDynamic[]; hairpins: SheetHairpin[] } {
  const first = measures[0];
  const last = measures[measures.length - 1];
  if (!first || !last || (marks.length === 0 && hairpins.length === 0)) {
    return { dynamics: [], hairpins: [] };
  }
  const anchors = timeAnchorsFor(measures);
  const fromMs = first.startMs;
  const toMs = last.endMs;

  const dynamics: SheetDynamic[] = [];
  /** The marks this system writes, by when they fall. */
  const markAt = new Map<number, DynamicMark>();
  for (const mark of marks) {
    if (mark.atMs < fromMs || mark.atMs >= toMs) continue;
    dynamics.push({ xPt: xAtTime(anchors, mark.atMs), mark: mark.mark });
    markAt.set(mark.atMs, mark.mark);
  }

  const wedges: SheetHairpin[] = [];
  for (const hairpin of hairpins) {
    if (hairpin.toMs <= fromMs || hairpin.fromMs >= toMs) continue;
    const continuesLeft = hairpin.fromMs < fromMs;
    const continuesRight = hairpin.toMs > toMs;
    // Where an end carries a mark of its own, keep clear of the mark's ink,
    // which reaches further from its note for an ff than for a p; where the
    // wedge runs off the system there is nothing to avoid.
    const startMark = markAt.get(hairpin.fromMs);
    const endMark = markAt.get(hairpin.toMs);
    const lead = continuesLeft
      ? 0
      : startMark
        ? (dynamicInkG(startMark).right + HAIRPIN_GAP_G) * G
        : HAIRPIN_CLEARANCE_G * G;
    const trail = continuesRight
      ? 0
      : endMark
        ? (dynamicInkG(endMark).left + HAIRPIN_GAP_G) * G
        : HAIRPIN_CLEARANCE_G * G;
    const x1Pt = xAtTime(anchors, Math.max(hairpin.fromMs, fromMs)) + lead;
    const x2Pt = xAtTime(anchors, Math.min(hairpin.toMs, toMs)) - trail;
    // A wedge with no room left to open in says less than nothing.
    if (x2Pt - x1Pt < 3 * G) continue;
    wedges.push({ x1Pt, x2Pt, grow: hairpin.grow, continuesLeft, continuesRight });
  }
  return { dynamics, hairpins: wedges };
}

/** How far a tie stub reaches when the note it joins is on another system. */
const TIE_STUB_G = 1.6;
/** Clearance between a tie and the head it springs from. */
const TIE_LIFT_G = 0.85;

/**
 * How far out a tie's arc is drawn to: its control point's distance off the
 * line between its ends, which the arc bows half way to. Shallow over a short
 * tie, deeper over a long one, but never a semicircle.
 */
export function tieDepthPt(tie: SheetTie): number {
  const span = Math.max(tie.x2Pt - tie.x1Pt, 0.1);
  return Math.min(1.1 * G, 0.24 * span + 0.35 * G);
}

/**
 * Pair up the tied heads of a system into arcs.
 *
 * A tie joins two writings of one note, so its ends are always the same staff
 * and the same line — that pair identifies it, and the pieces come out of the
 * layout in order. Where the far end is on the next system there is nothing to
 * reach, so the arc becomes a stub off the end of this one, and the head that
 * resumes over there gets a matching stub into it.
 *
 * y values are staff-relative here; `paginate` moves them into page space.
 */
function buildTies(
  measures: SheetMeasure[],
  systemLeftPt: number,
  systemRightPt: number,
): SheetTie[] {
  const ties: SheetTie[] = [];
  /** Heads still waiting for the other end of their tie, by staff and step. */
  const open = new Map<string, { xPt: number; step: number; above: boolean; staff: StaffKind }>();

  for (const measure of measures) {
    for (const column of measure.columns) {
      for (const chord of [...column.treble, ...column.bass]) {
        for (const note of chord.notes) {
          if (!note.tiedFromPrev && !note.tiedToNext) continue;
          const key = `${chord.staff}|${note.step}`;
          // The arc bows away from the stem, so it never fouls it.
          const above = chord.stemDown;
          const yRel = staffYRel(note.step) + (above ? -TIE_LIFT_G : TIE_LIFT_G) * G;

          if (note.tiedFromPrev) {
            const from = open.get(key);
            if (from) {
              open.delete(key);
              ties.push({
                staff: chord.staff,
                above: from.above,
                x1Pt: from.xPt + HEAD_RX_G * G,
                y1Pt: staffYRel(from.step) + (from.above ? -TIE_LIFT_G : TIE_LIFT_G) * G,
                x2Pt: column.xPt - HEAD_RX_G * G,
                y2Pt: yRel,
              });
            } else {
              // Resuming from the system above: a stub into the head.
              ties.push({
                staff: chord.staff,
                above,
                x1Pt: Math.max(systemLeftPt, column.xPt - HEAD_RX_G * G - TIE_STUB_G * G),
                y1Pt: yRel,
                x2Pt: column.xPt - HEAD_RX_G * G,
                y2Pt: yRel,
              });
            }
          }
          if (note.tiedToNext)
            open.set(key, { xPt: column.xPt, step: note.step, above, staff: chord.staff });
        }
      }
    }
  }

  // Whatever is still open runs off the end of the system.
  for (const from of open.values()) {
    const yRel = staffYRel(from.step) + (from.above ? -TIE_LIFT_G : TIE_LIFT_G) * G;
    ties.push({
      staff: from.staff,
      above: from.above,
      x1Pt: from.xPt + HEAD_RX_G * G,
      y1Pt: yRel,
      x2Pt: Math.min(systemRightPt, from.xPt + HEAD_RX_G * G + TIE_STUB_G * G),
      y2Pt: yRel,
    });
  }
  return ties;
}

interface BeamMember {
  column: SheetColumn;
  chord: SheetChord;
}

/**
 * Give this measure's beams their geometry.
 *
 * Which chords beam together, and which way their stems point, was settled by
 * `layoutScore` — both views draw the same grouping, so only the points are
 * decided here. `SheetChord.beamId` arrives holding the layout's own index and
 * leaves holding this measure's, which is what the renderer looks up. A beam
 * never crosses a bar line, so every member of a run is in one measure.
 *
 * Beam y values are staff-relative here; `paginate` shifts them to page space.
 */
function buildBeams(measure: SheetMeasure, groups: readonly BeamGroup[]): void {
  const runs = new Map<number, BeamMember[]>();
  for (const column of measure.columns) {
    for (const chord of [...column.treble, ...column.bass]) {
      if (chord.beamId === null) continue;
      const run = runs.get(chord.beamId);
      if (run) run.push({ column, chord });
      else runs.set(chord.beamId, [{ column, chord }]);
    }
  }
  for (const [layoutId, run] of runs) {
    // A run the sheet only received part of has nothing to span; it flags.
    if (run.length < 2) {
      for (const member of run) member.chord.beamId = null;
      continue;
    }
    // The layout decided which beams join which notes; the sheet only has the
    // same run when it received all of it, and otherwise joins what it has.
    const group = groups[layoutId];
    const whole = group !== undefined && group.members.length === run.length;
    emitBeam(
      measure,
      run,
      whole ? group.secondary : fallbackSecondary(run),
      whole ? group.tupletCount : tupletCountFor(run[0]!.chord.symbol, run.length),
    );
  }
}

/** Secondary beams for a run the layout's answer no longer fits: stubs point in. */
function fallbackSecondary(run: readonly BeamMember[]): BeamPiece[][] {
  const counts = run.map((member) => beamCountFor(member.chord.symbol.base) || 1);
  const levels: BeamPiece[][] = [];
  for (let level = 2; level <= Math.max(...counts); level += 1) {
    const pieces: BeamPiece[] = [];
    counts.forEach((count, i) => {
      if (count < level) return;
      if ((counts[i - 1] ?? 0) >= level) {
        (pieces[pieces.length - 1] as BeamPiece).to = i;
        return;
      }
      pieces.push({ from: i, to: i });
    });
    for (const piece of pieces) {
      if (piece.from === piece.to) piece.stub = piece.from === 0 ? 1 : -1;
    }
    levels.push(pieces);
  }
  return levels;
}

/** The numeral a beamed run carries, or null where it is not a whole tuplet. */
function tupletCountFor(symbol: DurationSymbol, runLength: number): number | null {
  const ratio = symbol.tuplet;
  return ratio && runLength % ratio.actual === 0 ? runLength : null;
}

/** Size a tuplet numeral is set at, in staff spaces: small enough not to compete with the notes. */
export const TUPLET_NUMERAL_SPACE_G = 0.8;

/**
 * The y a beam's tuplet numeral stands on: centred on the beam, on the side
 * away from its heads — above an up-stem run, below a down-stem one — and
 * clear of the beam either way. In the beam's own space, staff-relative or the
 * page's.
 */
export function tupletNumeralY(beam: SheetBeam): number {
  const midY = (beam.y1Pt + beam.y2Pt) / 2;
  // The digits stand on their origin, so below the beam it goes their height lower.
  return beam.stemDown ? midY + 1.8 * G : midY - 0.6 * G;
}

function emitBeam(
  measure: SheetMeasure,
  run: BeamMember[],
  secondary: BeamPiece[][],
  tupletCount: number | null,
): void {
  const first = run[0] as BeamMember;
  const staff = first.chord.staff;
  const stemDown = first.chord.stemDown;

  const xs = run.map((member) => stemXPt(member.column.xPt, stemDown));
  const anchors = run.map((member) => {
    const note = stemDown
      ? member.chord.notes[0]!
      : member.chord.notes[member.chord.notes.length - 1]!;
    return staffYRel(note.step);
  });
  const beamCount = Math.max(
    ...run.map((member) => beamCountFor(member.chord.symbol.base) || 1),
  ) as BeamCount;
  const span = beamSpanFor(xs, anchors, stemDown, G, beamCount);

  const beamId = measure.beams.length;
  measure.beams.push({
    staff,
    stemDown,
    beamCount,
    // The layout's numeral where the sheet has the layout's whole run; see
    // `buildBeamGroups`. A run cut short here numbers only whole tuplets.
    tupletCount,
    x1Pt: xs[0]!,
    y1Pt: span.y1,
    x2Pt: xs[xs.length - 1]!,
    y2Pt: span.y2,
    stemXsPt: xs,
    secondary,
  });
  for (const member of run) member.chord.beamId = beamId;
}

/**
 * Space the music needs above the treble staff and below the bass staff (pt):
 * what the rest of a system's marks stack outside of (`packSystems`).
 */
function systemExtents(measures: SheetMeasure[]): { abovePt: number; belowPt: number } {
  const headPad = 0.5 * G;
  let abovePt = 3 * G; // floor reserves room for the measure number
  let belowPt = 2.5 * G;

  for (const measure of measures) {
    for (const column of measure.columns) {
      for (const chord of [...column.treble, ...column.bass]) {
        let top = staffYRel(chord.notes[chord.notes.length - 1]!.step) - headPad;
        let bottom = staffYRel(chord.notes[0]!.step) + headPad;
        if (chord.symbol.base !== 'whole' && chord.beamId === null) {
          // A lone 32nd or 64th stacks more flags than an ordinary stem holds:
          // its stem runs longer and its flag's ink past the stem's end, and
          // the system has to leave room for both.
          const reach = flaggedStemReachG(beamCountFor(chord.symbol.base), chord.stemDown) * G;
          if (chord.stemDown) bottom = Math.max(bottom, stemAnchorYRel(chord) + reach);
          else top = Math.min(top, stemAnchorYRel(chord) - reach);
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
  // The inter-staff gap is per system now: one carrying dynamics opens up to
  // make room for them, and one without keeps the layout it always had.
  const interStaffFor = (system: WorkSystem): number =>
    metrics.interStaffGapPt + system.interStaffExtraPt;
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
      keySignature: normalizeFifths(options.keySignature ?? 0),
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
    const interStaffPt = interStaffFor(system);
    const totalH = system.abovePt + metrics.staffHeightPt * 2 + interStaffPt + system.belowPt;
    if (currentSystems.length > 0 && cursorY + totalH > contentBottom) finalizePage();

    const trebleTopPt = cursorY + system.abovePt;
    const bassTopPt = trebleTopPt + metrics.staffHeightPt + interStaffPt;
    for (const measure of system.measures) {
      for (const beam of measure.beams) {
        const staffTop = beam.staff === 'treble' ? trebleTopPt : bassTopPt;
        beam.y1Pt += staffTop;
        beam.y2Pt += staffTop;
      }
    }
    for (const tie of system.ties) {
      const staffTop = tie.staff === 'treble' ? trebleTopPt : bassTopPt;
      tie.y1Pt += staffTop;
      tie.y2Pt += staffTop;
    }
    for (const octave of system.octaves) {
      octave.yPt += octave.staff === 'treble' ? trebleTopPt : bassTopPt;
    }
    currentSystems.push({
      xPt: metrics.marginLeftPt,
      widthPt: system.widthPt,
      tempoMarkBaselinePt: trebleTopPt - system.abovePt + TEMPO_MARK_BASELINE_PT,
      trebleTopPt,
      bassTopPt,
      measures: system.measures,
      ties: system.ties,
      pedals: system.pedals,
      octaves: system.octaves,
      // The row sits under everything the music itself needed.
      pedalRowPt: bassTopPt + metrics.staffHeightPt + system.belowPt - PEDAL_ROW_PT * 0.45,
      dynamics: system.dynamics,
      hairpins: system.hairpins,
      // Marks sit low in the gap, nearer the bass staff, which is where a
      // pianist looks for them and where the treble's own stems are not.
      dynamicsRowPt: bassTopPt - interStaffPt * 0.3,
      clefs: system.clefs,
      firstMeasureNumber: system.measures[0]!.index + 1,
      showTimeSignature: s === 0,
      isLast: s === systems.length - 1,
    });
    cursorY += totalH + metrics.minSystemGapPt;
  }
  finalizePage();
  return pages;
}

import { createTakeTempoMap, type TempoMap } from '@/domain/tempoMap';
import type {
  NoteEvent,
  PedalEvent,
  QuantizationSetting,
  TempoChange,
  TimeSignature,
} from '@/domain/takeTypes';
import { barDurationMs } from '@/utils/timing';
import {
  beatsForSymbol,
  quantizeGridBeats,
  symbolForBeats,
  type DurationSymbol,
} from './quantization';
import { accidentalFor, normalizeFifths, type AccidentalKind } from './keySignature';
import {
  barUnits,
  restStep,
  restsForGap,
  symbolForUnits,
  unitsPerBeat,
  valuesForSpan,
} from './rests';
import {
  defaultClefFor,
  ledgerLineSteps,
  midiToStaffPosition,
  stemGoesDown,
  type ClefKind,
  type StaffKind,
} from './staffMapping';

/**
 * Whether a notehead is drawn on its chord's column (0) or one head-width to
 * the left (-1) or right (+1) of it, to clear a head it would otherwise
 * collide with. The stem never moves with it.
 */
export type HeadShift = -1 | 0 | 1;

export interface LaidOutNote {
  id: string;
  midi: number;
  /** Raw performance timing (playback truth, never quantized). */
  startMs: number;
  durationMs: number;
  /** Where the note is drawn (visual quantization only). */
  displayStartMs: number;
  staff: StaffKind;
  /** The clef this note is read under; usually the staff's own. */
  clef: ClefKind;
  /** The voice the source numbered, if any; see `ChordGroup.voice`. */
  voice?: number;
  step: number;
  /** The accidental printed here, after the key and the rest of the bar. */
  accidental: AccidentalKind | null;
  /** How the pitch is altered from its letter; see `StaffPosition.alter`. */
  alter: number;
  symbol: DurationSymbol;
  /** True when this head continues one before it, under a tie. */
  tiedFromPrev: boolean;
  /** True when a tie runs from this head into the next piece of the same note. */
  tiedToNext: boolean;
  ledger: number[];
  headShift: HeadShift;
  /**
   * Which column left of the chord this note's accidental is drawn in, 0 being
   * nearest the heads. Sharps are tall enough to foul each other, so notes
   * close together stack outward instead of sharing one column.
   */
  accidentalColumn: number;
}

/** Notes of one voice on one staff whose quantized starts coincide. */
export interface ChordGroup {
  staff: StaffKind;
  /** The clef in force where this chord falls. */
  clef: ClefKind;
  displayStartMs: number;
  /** Sorted by step ascending (lowest note first). */
  notes: LaidOutNote[];
  /**
   * Which line of the staff's polyphony this is, 0 for the topmost. Taken from
   * the source score when it numbers voices (stable, so beams run across
   * columns) and otherwise from the chord's pitch rank in its stack.
   */
  voice: number;
  stemDown: boolean;
  symbol: DurationSymbol;
}

/**
 * A silence engraved on one staff. Rests are derived, never stored: what a
 * take records is when keys went down, and the silence between them is
 * whatever the written note values leave over.
 */
export interface LaidOutRest {
  staff: StaffKind;
  /** Where the rest is drawn, on the same clock as `ChordGroup`. */
  displayStartMs: number;
  symbol: DurationSymbol;
  /** Diatonic steps above the staff's bottom line; 4 is the middle line. */
  step: number;
}

export interface MeasureInfo {
  index: number;
  startMs: number;
  endMs: number;
  /** The tempo in force here; equal to `bpm` unless the piece changes tempo. */
  bpm: number;
  /** True when no chord starts inside the measure (draws a whole rest). */
  empty: boolean;
  /** The clef each staff is read under here, carried forward between changes. */
  clefs: Record<StaffKind, ClefKind>;
}

/** A stretch the sustain pedal is held down for, in take milliseconds. */
export interface PedalSpan {
  fromMs: number;
  toMs: number;
}

export interface ScoreLayout {
  chords: ChordGroup[];
  /** Sorted by display start; see `LaidOutRest`. */
  rests: LaidOutRest[];
  /** Sorted, non-overlapping; see `PedalSpan`. */
  pedals: PedalSpan[];
  measures: MeasureInfo[];
  /** The FIRST measure's length; later measures can differ (tempo changes). */
  barMs: number;
  /** Layout extent in ms — always whole measures. */
  totalMs: number;
}

export interface LayoutOptions {
  bpm: number;
  timeSignature: TimeSignature;
  quantization: QuantizationSetting;
  /**
   * Sharps (positive) or flats (negative) the score is written with. Decides
   * how black keys are spelled and what the prefix prints; C major by default,
   * which spells every one of them as a sharp.
   */
  keySignature?: number;
  /** The take's pedal events; engraved as brackets under the bass staff. */
  pedals?: readonly PedalEvent[];
  /** Tempo marks after the first, from the take (`tempo.changes`). */
  tempoChanges?: readonly TempoChange[];
  /** Never lay out fewer measures than this (empty-score scaffold). */
  minMeasures?: number;
}

/**
 * What makes two notes of a stack part of the same stem. The source's voice
 * where there is one; otherwise the written note value, which is the most a
 * recorded take can tell us — notes of equal length struck together are a
 * chord, and anything else is a second line of music.
 */
function voiceIdentity(note: LaidOutNote): string {
  if (note.voice !== undefined) return `v${note.voice}`;
  return `d${note.symbol.base}${note.symbol.dotted ? '.' : ''}`;
}

/** Outer voices stem away from each other; a lone voice follows the staff. */
function stemDownFor(index: number, count: number, averageStep: number): boolean {
  if (count === 1) return stemGoesDown(averageStep);
  if (index === 0) return false; // top voice up
  if (index === count - 1) return true; // bottom voice down
  return stemGoesDown(averageStep);
}

/**
 * One stack of simultaneous same-staff notes → a chord per voice, topmost
 * first. A single-voice stack yields exactly the chord this layout has always
 * produced, so recorded takes engrave unchanged.
 */
function chordsInStack(stack: LaidOutNote[]): ChordGroup[] {
  const byVoice = new Map<string, LaidOutNote[]>();
  for (const note of stack) {
    const key = voiceIdentity(note);
    const group = byVoice.get(key);
    if (group) group.push(note);
    else byVoice.set(key, [note]);
  }

  const voices = [...byVoice.values()].map((groupNotes) => {
    groupNotes.sort((a, b) => a.step - b.step || a.midi - b.midi);
    const averageStep = groupNotes.reduce((sum, note) => sum + note.step, 0) / groupNotes.length;
    let longest = groupNotes[0] as LaidOutNote;
    for (const note of groupNotes) {
      if (note.durationMs > longest.durationMs) longest = note;
    }
    return { notes: groupNotes, averageStep, symbol: longest.symbol };
  });
  voices.sort((a, b) => b.averageStep - a.averageStep);

  return voices.map((voice, index) => {
    const first = voice.notes[0] as LaidOutNote;
    return {
      staff: first.staff,
      clef: first.clef,
      displayStartMs: first.displayStartMs,
      notes: voice.notes,
      voice: first.voice ?? index,
      stemDown: stemDownFor(index, voices.length, voice.averageStep),
      symbol: voice.symbol,
    };
  });
}

/** Steps closer than this leave two sharps overlapping in one column. */
const ACCIDENTAL_CLEARANCE_STEPS = 5;

/**
 * Give each accidental in a chord a column, working down from the top. A sharp
 * stands about two and a half staff spaces tall — five steps — so two of them
 * any closer than that cannot share a column and the lower one moves out a
 * place. Most chords need only column 0.
 */
function stackAccidentals(voices: ChordGroup[]): void {
  const marked = [];
  for (const chord of voices) {
    for (const note of chord.notes) {
      if (note.accidental !== null) marked.push(note);
    }
  }
  if (marked.length < 2) return;
  marked.sort((a, b) => b.step - a.step);

  /** The lowest step already placed in each column, top-down. */
  const lowestInColumn: number[] = [];
  for (const note of marked) {
    let column = 0;
    while (
      lowestInColumn[column] !== undefined &&
      (lowestInColumn[column] as number) - note.step < ACCIDENTAL_CLEARANCE_STEPS
    ) {
      column += 1;
    }
    lowestInColumn[column] = note.step;
    note.accidentalColumn = column;
  }
}

/**
 * Record which way each voice stemmed where it shared a staff with another.
 * Only voices the source numbered count: a derived voice is a pitch rank
 * within one stack, so voting on it would drag plain single-line passages
 * along with whatever the one polyphonic moment decided.
 */
function collectStemVotes(voices: ChordGroup[], votes: Map<string, number>): void {
  for (const chord of voices) {
    if ((chord.notes[0] as LaidOutNote).voice === undefined) continue;
    const key = `${chord.staff}|${chord.voice}`;
    votes.set(key, (votes.get(key) ?? 0) + (chord.stemDown ? 1 : -1));
  }
}

/**
 * An engraver commits a voice to one stem direction and keeps it there, so a
 * staff's two lines stay readable through the beats where one of them happens
 * to be sounding alone. Voices that never meet another are left as they were.
 */
function settleVoiceStems(chords: ChordGroup[], votes: Map<string, number>): void {
  if (votes.size === 0) return;
  for (const chord of chords) {
    const vote = votes.get(`${chord.staff}|${chord.voice}`);
    if (vote !== undefined && vote !== 0) chord.stemDown = vote > 0;
  }
}

/**
 * A step is half a staff space and a notehead is a whole one high, so heads a
 * step apart already overlap, and on the same step a filled head hides a
 * hollow one entirely. Engraving moves one of them a head-width clear, and
 * that is all this does — the stem stays on the chord's own column, so beams
 * and flags are untouched.
 */
function displaceCollidingHeads(voices: ChordGroup[]): void {
  for (const chord of voices) displaceSeconds(chord);
  if (voices.length > 1) displaceAcrossVoices(voices);
}

/** The least a chord has to expose for its heads to be placed. */
export interface StemmedChord {
  stemDown: boolean;
  notes: { step: number; headShift: HeadShift }[];
}

/**
 * Inside one chord, the note that resolves a second is the one on the far side
 * of the stem: reading up the chord when the stem points up, down it when the
 * stem points down. A displaced head clears the column for the note after it,
 * so a cluster alternates instead of marching off the staff.
 *
 * Safe to run again if the stem later turns around — beaming can do that — so
 * it starts by putting every head back on the column.
 */
export function displaceSeconds(chord: StemmedChord): void {
  for (const note of chord.notes) note.headShift = 0;
  // notes are sorted by step ascending; the stem decides which end leads.
  const order = chord.stemDown ? [...chord.notes].reverse() : chord.notes;
  const shift: HeadShift = chord.stemDown ? -1 : 1;
  let previous: (typeof chord.notes)[number] | null = null;
  for (const note of order) {
    if (previous !== null && previous.headShift === 0 && Math.abs(note.step - previous.step) <= 1) {
      note.headShift = shift;
    }
    previous = note;
  }
}

/**
 * Heads of different voices clash on the same terms — a shared step, or steps
 * a single step apart. The up-stem voice is the one that yields, so a unison
 * reads the way an engraver writes it: down-stem head on the column, up-stem
 * head to its right, both stems clear of each other.
 */
function displaceAcrossVoices(voices: ChordGroup[]): void {
  const heads: { chord: ChordGroup; note: LaidOutNote }[] = [];
  for (const chord of voices) {
    for (const note of chord.notes) heads.push({ chord, note });
  }
  heads.sort((a, b) => a.note.step - b.note.step);

  for (let i = 0; i < heads.length; i += 1) {
    const lower = heads[i] as (typeof heads)[number];
    for (let j = i + 1; j < heads.length; j += 1) {
      const upper = heads[j] as (typeof heads)[number];
      if (upper.note.step - lower.note.step > 1) break; // sorted: no closer pair follows
      // A chord has already settled its own seconds, and a head that moved for
      // one is where it needs to be — moving it again only trades the clash.
      if (upper.chord === lower.chord) continue;
      if (lower.note.headShift !== 0 || upper.note.headShift !== 0) continue;
      const bothSameWay = lower.chord.stemDown === upper.chord.stemDown;
      const yields = bothSameWay ? upper : lower.chord.stemDown ? upper : lower;
      yields.note.headShift = 1;
    }
  }
}

interface TieContext {
  tempoMap: TempoMap;
  timeSignature: TimeSignature;
  /** The snap grid in beats, or null when the score is not on one. */
  gridBeats: number | null;
  beatsHeld: (note: { startMs: number; durationMs: number }) => number;
}

/**
 * Cut held notes into the pieces a bar can actually carry, joined by ties.
 *
 * A bar line is a hard edge: no symbol reaches across one, so a note that does
 * is written as a note in each bar with a tie between them. The same applies
 * inside a bar to any length no single value can express, and to anything
 * longer than a whole note — which used to be drawn as a whole note and lose
 * the difference.
 *
 * With no grid there is nothing to align to, so notes are left whole. Only the
 * live score allows that, and the export always sets one.
 */
function tieAcrossBarLines(laidOut: readonly LaidOutNote[], context: TieContext): LaidOutNote[] {
  const { tempoMap, timeSignature, gridBeats, beatsHeld } = context;
  if (gridBeats === null) return [...laidOut];

  const perBeat = unitsPerBeat(timeSignature.denominator);
  const bar = barUnits(timeSignature);
  /** Absolute 32nd notes from the start of the piece. */
  const unitsAt = (ms: number): number => Math.round(tempoMap.beatAtMs(ms) * perBeat);
  const msAtUnits = (units: number): number => Math.round(tempoMap.msAtBeat(units / perBeat));

  const out: LaidOutNote[] = [];
  for (const note of laidOut) {
    const from = unitsAt(note.displayStartMs);
    const heldBeats = Math.max(1, Math.round(beatsHeld(note) / gridBeats)) * gridBeats;
    const to = from + Math.max(2, Math.round(heldBeats * perBeat));

    // Bar lines first, then the value or values that fill each piece between
    // them — one where a single symbol is exactly that long, which is the
    // ordinary case and the one that must not be split.
    const pieces: { startUnits: number; symbol: DurationSymbol }[] = [];
    let edge = from;
    while (edge < to) {
      const measureStart = Math.floor(edge / bar) * bar;
      const nextBarLine = Math.min(to, measureStart + bar);
      const whole = symbolForUnits(nextBarLine - edge);
      if (whole !== null) {
        pieces.push({ startUnits: edge, symbol: whole });
      } else {
        for (const span of valuesForSpan(
          edge - measureStart,
          nextBarLine - measureStart,
          timeSignature,
        )) {
          pieces.push({ startUnits: measureStart + span.startUnits, symbol: span.symbol });
        }
      }
      edge = nextBarLine;
    }
    if (pieces.length === 0) {
      out.push(note);
      continue;
    }

    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i] as (typeof pieces)[number];
      out.push({
        ...note,
        // Every piece keeps the whole note's performance timing: it is one
        // sounding note, so it lights up as one under the playhead.
        displayStartMs: i === 0 ? note.displayStartMs : msAtUnits(piece.startUnits),
        symbol: piece.symbol,
        tiedFromPrev: i > 0,
        tiedToNext: i < pieces.length - 1,
      });
    }
  }
  return out;
}

/**
 * Apply the bar's memory to the accidentals the key left over.
 *
 * An accidental holds for the rest of the measure at the line or space it was
 * written on, and the bar line forgets it. So a repeated F sharp is marked once
 * and not four times, and a note that goes back to what the key says needs a
 * natural to say so — which is the difference between an engraved bar and a
 * page that restates everything on every note.
 *
 * Keyed by staff and step, because that pair *is* the line or space: the step
 * comes from the letter, so C flat and B keep their own memories.
 */
function applyMeasureAccidentals(chordsByMeasure: readonly ChordGroup[][]): void {
  for (const inMeasure of chordsByMeasure) {
    /** What each line or space currently sounds as; absent means "as the key says". */
    const inForce = new Map<string, number>();
    // Read in the order the bar is read, so an accidental reaches the notes
    // after it and not the ones before.
    const ordered = [...inMeasure].sort((a, b) => a.displayStartMs - b.displayStartMs);
    for (const chord of ordered) {
      for (const note of chord.notes) {
        const key = `${note.staff}|${note.step}`;
        // A tie carries its note's accidental over the bar line with it, so the
        // far side of one is never marked again — but it does hold the line for
        // whatever else lands there.
        if (note.tiedFromPrev) {
          note.accidental = null;
          inForce.set(key, note.alter);
          continue;
        }
        const standing = inForce.get(key);
        if (standing === undefined) {
          // Nothing written here yet, so the key signature is still speaking;
          // `accidental` already says whether this note departs from it.
          if (note.accidental !== null) inForce.set(key, note.alter);
        } else if (standing === note.alter) {
          note.accidental = null;
        } else {
          note.accidental = accidentalFor(note.alter);
          inForce.set(key, note.alter);
        }
      }
    }
  }
}

/**
 * Turn pedal events into the stretches a bracket is drawn under.
 *
 * The events are a stream of downs and ups; what gets engraved is the span
 * between them. A down while already down is the same press continuing, and an
 * up with nothing held is ignored, so a stream that never quite balances still
 * draws something sensible. A press left open at the end runs to the end.
 */
function pedalSpans(events: readonly PedalEvent[], totalMs: number): PedalSpan[] {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const spans: PedalSpan[] = [];
  let downAt: number | null = null;
  for (const event of sorted) {
    if (event.down) {
      downAt ??= event.atMs;
    } else if (downAt !== null) {
      if (event.atMs > downAt) spans.push({ fromMs: downAt, toMs: event.atMs });
      downAt = null;
    }
  }
  if (downAt !== null && totalMs > downAt) spans.push({ fromMs: downAt, toMs: totalMs });
  return spans;
}

/** A stretch of one staff that is sounding, in take milliseconds. */
interface SoundingSpan {
  fromMs: number;
  toMs: number;
}

/** Sort and coalesce overlapping spans, so what is left between them is silence. */
function mergeSpans(spans: SoundingSpan[]): SoundingSpan[] {
  spans.sort((a, b) => a.fromMs - b.fromMs);
  const merged: SoundingSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, span.toMs);
    else merged.push({ ...span });
  }
  return merged;
}

function pushRests(
  out: LaidOutRest[],
  staff: StaffKind,
  fromUnits: number,
  toUnits: number,
  timeSignature: TimeSignature,
  msAtUnits: (units: number) => number,
): void {
  for (const span of restsForGap(fromUnits, toUnits, timeSignature)) {
    out.push({
      staff,
      displayStartMs: msAtUnits(span.startUnits),
      symbol: span.symbol,
      step: restStep(span.symbol),
    });
  }
}

/**
 * The rests each staff needs, from the silence its chords leave over.
 *
 * A staff is occupied for as long as its notes are *written*, not as long as
 * they were held: play a bar of detached quarters and every one of them lifts
 * early, which is phrasing rather than four extra rests. So the span a chord
 * covers is the length of the symbol it engraves as, which is also exactly the
 * span the reader sees filled.
 *
 * Bars with nothing starting in them are left alone — `MeasureInfo.empty`
 * already draws the whole rest that a wholly silent bar takes.
 */
function deriveRests(
  chords: readonly ChordGroup[],
  measures: readonly MeasureInfo[],
  timeSignature: TimeSignature,
  tempoMap: TempoMap,
): LaidOutRest[] {
  const { denominator } = timeSignature;
  const perBeat = unitsPerBeat(denominator);
  const bar = barUnits(timeSignature);

  const spans: Record<StaffKind, SoundingSpan[]> = { treble: [], bass: [] };
  for (const chord of chords) {
    const fromBeat = tempoMap.beatAtMs(chord.displayStartMs);
    spans[chord.staff].push({
      fromMs: chord.displayStartMs,
      toMs: tempoMap.msAtBeat(fromBeat + beatsForSymbol(chord.symbol, denominator)),
    });
  }
  const sounding: Record<StaffKind, SoundingSpan[]> = {
    treble: mergeSpans(spans.treble),
    bass: mergeSpans(spans.bass),
  };
  // Spans are sorted, so each staff can walk its own list once across the whole
  // piece instead of rescanning it per measure.
  const scanned: Record<StaffKind, number> = { treble: 0, bass: 0 };

  const rests: LaidOutRest[] = [];
  for (const measure of measures) {
    if (measure.empty) continue;
    const startBeat = tempoMap.beatAtMs(measure.startMs);
    const unitsAt = (ms: number): number =>
      Math.round((tempoMap.beatAtMs(ms) - startBeat) * perBeat);
    const msAtUnits = (units: number): number =>
      Math.round(tempoMap.msAtBeat(startBeat + units / perBeat));

    for (const staff of ['treble', 'bass'] as const) {
      const list = sounding[staff];
      // Only spans that finish before this bar can be retired; one that runs
      // into it is still occupying the bars after it too.
      while (
        scanned[staff] < list.length &&
        (list[scanned[staff]] as SoundingSpan).toMs <= measure.startMs
      ) {
        scanned[staff] += 1;
      }

      let cursor = 0;
      for (let i = scanned[staff]; i < list.length; i += 1) {
        const span = list[i] as SoundingSpan;
        const from = unitsAt(span.fromMs);
        if (from >= bar) break;
        const to = unitsAt(span.toMs);
        if (to <= cursor) continue;
        if (from > cursor) pushRests(rests, staff, cursor, from, timeSignature, msAtUnits);
        cursor = to;
        if (cursor >= bar) break;
      }
      if (cursor < bar) pushRests(rests, staff, cursor, bar, timeSignature, msAtUnits);
    }
  }
  rests.sort((a, b) => a.displayStartMs - b.displayStartMs);
  return rests;
}

export function layoutScore(notes: readonly NoteEvent[], options: LayoutOptions): ScoreLayout {
  const barMs = barDurationMs(options.bpm, options.timeSignature);
  const minMeasures = options.minMeasures ?? 4;
  const tempoMap = createTakeTempoMap({
    bpm: options.bpm,
    timeSignature: options.timeSignature,
    changes: options.tempoChanges,
  });

  // The grid lives in beat space, so it stays anchored to bar lines and to the
  // tempo changes that start on them. An absolute millisecond grid at the new
  // tempo would only line up when the change happens to fall on one of its
  // multiples, and would otherwise drag a downbeat off its own bar line.
  const gridBeats = quantizeGridBeats(options.quantization, options.timeSignature.denominator);
  const snapToGrid = (startMs: number): number => {
    if (gridBeats === null) return startMs;
    const beat = Math.round(tempoMap.beatAtMs(startMs) / gridBeats) * gridBeats;
    return Math.round(tempoMap.msAtBeat(beat));
  };

  const { denominator } = options.timeSignature;
  /** Beats between a note's endpoints, tempo map and all. */
  const beatsHeld = (note: { startMs: number; durationMs: number }): number =>
    tempoMap.beatAtMs(note.startMs + note.durationMs) - tempoMap.beatAtMs(note.startMs);

  /**
   * The value a note is written as. Onsets snap to the grid, so lengths have to
   * as well or the two disagree: a quarter played detached is held for perhaps
   * four fifths of its beat, which reads as a dotted eighth against a grid that
   * has already put the next note on the following beat. Written that way the
   * bar no longer adds up, and the rests derived from what is left over turn
   * the shortfall into a scattering of unaskable-for silences.
   *
   * Rounding is to the nearest slot and never to nothing, so the shortest note
   * still gets the shortest value the grid can express. With the grid off —
   * only the live score offers that — lengths stay exactly as played.
   */
  const symbolFor = (note: NoteEvent): DurationSymbol => {
    const held = beatsHeld(note);
    if (gridBeats === null) return symbolForBeats(held, denominator);
    return symbolForBeats(Math.max(1, Math.round(held / gridBeats)) * gridBeats, denominator);
  };

  const fifths = normalizeFifths(options.keySignature ?? 0);
  const laidOut: LaidOutNote[] = notes.map((note) => {
    const position = midiToStaffPosition(note.midi, note.staff, note.clef, fifths);
    return {
      id: note.id,
      midi: note.midi,
      startMs: note.startMs,
      durationMs: note.durationMs,
      displayStartMs: snapToGrid(note.startMs),
      staff: position.staff,
      clef: position.clef,
      ...(note.voice !== undefined ? { voice: note.voice } : {}),
      step: position.step,
      accidental: position.accidental,
      alter: position.alter,
      symbol: symbolFor(note),
      ledger: ledgerLineSteps(position.step),
      headShift: 0,
      accidentalColumn: 0,
      tiedFromPrev: false,
      tiedToNext: false,
    };
  });

  const tied = tieAcrossBarLines(laidOut, {
    tempoMap,
    timeSignature: options.timeSignature,
    gridBeats,
    beatsHeld,
  });

  // Notes on one staff that start together form a stack, which engraves as one
  // chord per voice — a held note and a run beneath it keep their own written
  // values instead of being fused into a single stem.
  const stacks = new Map<string, LaidOutNote[]>();
  for (const note of tied) {
    const key = `${note.staff}:${note.displayStartMs}`;
    const stack = stacks.get(key);
    if (stack) stack.push(note);
    else stacks.set(key, [note]);
  }

  const chords: ChordGroup[] = [];
  const stemVotes = new Map<string, number>();
  const byStack: ChordGroup[][] = [];
  for (const stack of stacks.values()) {
    const voices = chordsInStack(stack);
    if (voices.length > 1) collectStemVotes(voices, stemVotes);
    byStack.push(voices);
    chords.push(...voices);
  }
  settleVoiceStems(chords, stemVotes);
  chords.sort((a, b) => a.displayStartMs - b.displayStartMs);

  let maxEndMs = 0;
  for (const note of tied) {
    const end = Math.max(note.displayStartMs, note.startMs) + note.durationMs;
    if (end > maxEndMs) maxEndMs = end;
  }
  const spans = tempoMap.measureSpans(maxEndMs, minMeasures);

  const chordsByMeasure: ChordGroup[][] = spans.map(() => []);
  for (const chord of chords) {
    const index = measureIndexAt(spans, chord.displayStartMs);
    if (index !== null) (chordsByMeasure[index] as ChordGroup[]).push(chord);
  }

  // The bar decides which accidentals survive, so it has to speak before the
  // ones that are left are given columns to stand in.
  applyMeasureAccidentals(chordsByMeasure);
  // Which way a head moves depends on where its stem points, so this has to
  // wait until the stems have settled.
  for (const voices of byStack) {
    displaceCollidingHeads(voices);
    stackAccidentals(voices);
  }

  // A clef stands until something replaces it, so a measure with nothing on a
  // staff keeps reading under whatever the measure before it did.
  let carried: Record<StaffKind, ClefKind> = {
    treble: defaultClefFor('treble'),
    bass: defaultClefFor('bass'),
  };
  const measures: MeasureInfo[] = spans.map((span) => {
    const inMeasure = chordsByMeasure[span.index] as ChordGroup[];
    for (const chord of inMeasure) {
      if (chord.clef !== carried[chord.staff]) carried = { ...carried, [chord.staff]: chord.clef };
    }
    return {
      index: span.index,
      startMs: span.startMs,
      endMs: span.endMs,
      bpm: span.bpm,
      empty: inMeasure.length === 0,
      clefs: carried,
    };
  });

  const rests = deriveRests(chords, measures, options.timeSignature, tempoMap);

  const last = measures[measures.length - 1];
  const totalMs = last ? last.endMs : 0;
  const pedals = pedalSpans(options.pedals ?? [], totalMs);
  return { chords, rests, pedals, measures, barMs, totalMs };
}

/**
 * Index of the measure containing `ms`, or null when it falls outside the
 * layout. Measures can differ in length, so this searches boundaries rather
 * than dividing by a bar duration.
 */
export function measureIndexAt(
  measures: readonly { startMs: number; endMs: number }[],
  ms: number,
): number | null {
  if (measures.length === 0) return null;
  const first = measures[0] as { startMs: number };
  const last = measures[measures.length - 1] as { endMs: number };
  if (ms < first.startMs || ms >= last.endMs) return null;
  let low = 0;
  let high = measures.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((measures[mid] as { startMs: number }).startMs <= ms) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** First chord index with displayStartMs >= fromMs (binary search). */
export function firstChordIndexAt(chords: readonly ChordGroup[], fromMs: number): number {
  let low = 0;
  let high = chords.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((chords[mid] as ChordGroup).displayStartMs < fromMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

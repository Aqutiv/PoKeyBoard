import { createTakeTempoMap } from '@/domain/tempoMap';
import type {
  NoteEvent,
  QuantizationSetting,
  TempoChange,
  TimeSignature,
} from '@/domain/takeTypes';
import { barDurationMs } from '@/utils/timing';
import { durationToSymbol, quantizeStartMs, type DurationSymbol } from './quantization';
import { ledgerLineSteps, midiToStaffPosition, stemGoesDown, type StaffKind } from './staffMapping';

export interface LaidOutNote {
  id: string;
  midi: number;
  /** Raw performance timing (playback truth, never quantized). */
  startMs: number;
  durationMs: number;
  /** Where the note is drawn (visual quantization only). */
  displayStartMs: number;
  staff: StaffKind;
  step: number;
  accidental: '#' | null;
  symbol: DurationSymbol;
  ledger: number[];
}

/** Notes on one staff whose quantized starts coincide share one stem. */
export interface ChordGroup {
  staff: StaffKind;
  displayStartMs: number;
  /** Sorted by step ascending (lowest note first). */
  notes: LaidOutNote[];
  stemDown: boolean;
  symbol: DurationSymbol;
}

export interface MeasureInfo {
  index: number;
  startMs: number;
  endMs: number;
  /** The tempo in force here; equal to `bpm` unless the piece changes tempo. */
  bpm: number;
  /** True when no chord starts inside the measure (draws a whole rest). */
  empty: boolean;
}

export interface ScoreLayout {
  chords: ChordGroup[];
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
  /** Tempo marks after the first, from the take (`tempo.changes`). */
  tempoChanges?: readonly TempoChange[];
  /** Never lay out fewer measures than this (empty-score scaffold). */
  minMeasures?: number;
}

export function layoutScore(notes: readonly NoteEvent[], options: LayoutOptions): ScoreLayout {
  const barMs = barDurationMs(options.bpm, options.timeSignature);
  const minMeasures = options.minMeasures ?? 4;
  const tempoMap = createTakeTempoMap({
    bpm: options.bpm,
    timeSignature: options.timeSignature,
    changes: options.tempoChanges,
  });

  const laidOut: LaidOutNote[] = notes.map((note) => {
    const position = midiToStaffPosition(note.midi);
    // Grid and note value follow the tempo the note is played at, so a bar
    // after a tempo change still reads as the eighths and quarters it is.
    const bpm = tempoMap.bpmAt(note.startMs);
    return {
      id: note.id,
      midi: note.midi,
      startMs: note.startMs,
      durationMs: note.durationMs,
      displayStartMs: quantizeStartMs(note.startMs, options.quantization, bpm),
      staff: position.staff,
      step: position.step,
      accidental: position.accidental,
      symbol: durationToSymbol(note.durationMs, bpm),
      ledger: ledgerLineSteps(position.step),
    };
  });

  const groups = new Map<string, LaidOutNote[]>();
  for (const note of laidOut) {
    const key = `${note.staff}:${note.displayStartMs}`;
    const group = groups.get(key);
    if (group) group.push(note);
    else groups.set(key, [note]);
  }

  const chords: ChordGroup[] = [...groups.values()].map((groupNotes) => {
    groupNotes.sort((a, b) => a.step - b.step || a.midi - b.midi);
    const averageStep = groupNotes.reduce((sum, note) => sum + note.step, 0) / groupNotes.length;
    let longest = groupNotes[0] as LaidOutNote;
    for (const note of groupNotes) {
      if (note.durationMs > longest.durationMs) longest = note;
    }
    return {
      staff: (groupNotes[0] as LaidOutNote).staff,
      displayStartMs: (groupNotes[0] as LaidOutNote).displayStartMs,
      notes: groupNotes,
      stemDown: stemGoesDown(averageStep),
      symbol: longest.symbol,
    };
  });
  chords.sort((a, b) => a.displayStartMs - b.displayStartMs);

  let maxEndMs = 0;
  for (const note of laidOut) {
    const end = Math.max(note.displayStartMs, note.startMs) + note.durationMs;
    if (end > maxEndMs) maxEndMs = end;
  }
  const spans = tempoMap.measureSpans(maxEndMs, minMeasures);

  const measureHasChord = new Array<boolean>(spans.length).fill(false);
  for (const chord of chords) {
    const index = measureIndexAt(spans, chord.displayStartMs);
    if (index !== null) measureHasChord[index] = true;
  }

  const measures: MeasureInfo[] = spans.map((span) => ({
    index: span.index,
    startMs: span.startMs,
    endMs: span.endMs,
    bpm: span.bpm,
    empty: !measureHasChord[span.index],
  }));

  const last = measures[measures.length - 1];
  return { chords, measures, barMs, totalMs: last ? last.endMs : 0 };
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

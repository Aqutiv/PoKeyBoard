import type { NoteEvent, QuantizationSetting, TimeSignature } from '@/domain/takeTypes';
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
  /** True when no chord starts inside the measure (draws a whole rest). */
  empty: boolean;
}

export interface ScoreLayout {
  chords: ChordGroup[];
  measures: MeasureInfo[];
  barMs: number;
  /** Layout extent in ms — always whole measures. */
  totalMs: number;
}

export interface LayoutOptions {
  bpm: number;
  timeSignature: TimeSignature;
  quantization: QuantizationSetting;
  /** Never lay out fewer measures than this (empty-score scaffold). */
  minMeasures?: number;
}

export function layoutScore(notes: readonly NoteEvent[], options: LayoutOptions): ScoreLayout {
  const barMs = barDurationMs(options.bpm, options.timeSignature);
  const minMeasures = options.minMeasures ?? 4;

  const laidOut: LaidOutNote[] = notes.map((note) => {
    const position = midiToStaffPosition(note.midi);
    return {
      id: note.id,
      midi: note.midi,
      startMs: note.startMs,
      durationMs: note.durationMs,
      displayStartMs: quantizeStartMs(note.startMs, options.quantization, options.bpm),
      staff: position.staff,
      step: position.step,
      accidental: position.accidental,
      symbol: durationToSymbol(note.durationMs, options.bpm),
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
  const measureCount = Math.max(minMeasures, Math.ceil((maxEndMs + 1) / barMs));

  const measureHasChord = new Array<boolean>(measureCount).fill(false);
  for (const chord of chords) {
    const index = Math.floor(chord.displayStartMs / barMs);
    if (index >= 0 && index < measureCount) measureHasChord[index] = true;
  }

  const measures: MeasureInfo[] = Array.from({ length: measureCount }, (_, index) => ({
    index,
    startMs: index * barMs,
    endMs: (index + 1) * barMs,
    empty: !measureHasChord[index],
  }));

  return { chords, measures, barMs, totalMs: measureCount * barMs };
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

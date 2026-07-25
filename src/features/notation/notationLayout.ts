import { createTakeTempoMap } from '@/domain/tempoMap';
import type {
  NoteEvent,
  QuantizationSetting,
  TempoChange,
  TimeSignature,
} from '@/domain/takeTypes';
import { barDurationMs } from '@/utils/timing';
import { quantizeGridBeats, symbolForBeats, type DurationSymbol } from './quantization';
import { ledgerLineSteps, midiToStaffPosition, stemGoesDown, type StaffKind } from './staffMapping';

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
  /** The voice the source numbered, if any; see `ChordGroup.voice`. */
  voice?: number;
  step: number;
  accidental: '#' | null;
  symbol: DurationSymbol;
  ledger: number[];
  headShift: HeadShift;
}

/** Notes of one voice on one staff whose quantized starts coincide. */
export interface ChordGroup {
  staff: StaffKind;
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
      displayStartMs: first.displayStartMs,
      notes: voice.notes,
      voice: first.voice ?? index,
      stemDown: stemDownFor(index, voices.length, voice.averageStep),
      symbol: voice.symbol,
    };
  });
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
 * Two noteheads a step apart cannot share a column: at best they touch, and on
 * the same step a filled head hides a hollow one entirely. Engraving moves one
 * of them a head-width clear, and that is all this does — the stem stays on
 * the chord's own column, so beams and flags are untouched.
 */
function displaceCollidingHeads(voices: ChordGroup[]): void {
  for (const chord of voices) displaceSeconds(chord);
  if (voices.length > 1) displaceUnisons(voices);
}

/**
 * Inside one chord, the note that resolves a second is the one on the far side
 * of the stem: reading up the chord when the stem points up, down it when the
 * stem points down. A displaced head clears the column for the note after it,
 * so a cluster alternates instead of marching off the staff.
 */
function displaceSeconds(chord: ChordGroup): void {
  // notes are sorted by step ascending; the stem decides which end leads.
  const order = chord.stemDown ? [...chord.notes].reverse() : chord.notes;
  const shift: HeadShift = chord.stemDown ? -1 : 1;
  let previous: LaidOutNote | null = null;
  for (const note of order) {
    if (previous !== null && previous.headShift === 0 && Math.abs(note.step - previous.step) <= 1) {
      note.headShift = shift;
    }
    previous = note;
  }
}

/**
 * Across voices, a shared step is a unison. One head keeps the column and the
 * others move right of it; the one that stays is the down-stem voice, so the
 * pair reads the way an engraver writes it — down-stem head left, up-stem head
 * right, both stems clear of each other.
 */
function displaceUnisons(voices: ChordGroup[]): void {
  const byStep = new Map<number, { chord: ChordGroup; note: LaidOutNote }[]>();
  for (const chord of voices) {
    for (const note of chord.notes) {
      const sharing = byStep.get(note.step);
      if (sharing) sharing.push({ chord, note });
      else byStep.set(note.step, [{ chord, note }]);
    }
  }
  for (const sharing of byStep.values()) {
    if (sharing.length < 2) continue;
    const stays =
      sharing.find((entry) => entry.chord.stemDown) ?? (sharing[0] as (typeof sharing)[0]);
    for (const entry of sharing) {
      // A head already moved to resolve a second inside its own chord is where
      // it needs to be; moving it again would only trade one clash for another.
      if (entry !== stays && entry.note.headShift === 0) entry.note.headShift = 1;
    }
  }
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
  /** A note's written length: beats between its endpoints, tempo map and all. */
  const beatsHeld = (note: NoteEvent): number =>
    tempoMap.beatAtMs(note.startMs + note.durationMs) - tempoMap.beatAtMs(note.startMs);

  const laidOut: LaidOutNote[] = notes.map((note) => {
    const position = midiToStaffPosition(note.midi, note.staff);
    return {
      id: note.id,
      midi: note.midi,
      startMs: note.startMs,
      durationMs: note.durationMs,
      displayStartMs: snapToGrid(note.startMs),
      staff: position.staff,
      ...(note.voice !== undefined ? { voice: note.voice } : {}),
      step: position.step,
      accidental: position.accidental,
      symbol: symbolForBeats(beatsHeld(note), denominator),
      ledger: ledgerLineSteps(position.step),
      headShift: 0,
    };
  });

  // Notes on one staff that start together form a stack, which engraves as one
  // chord per voice — a held note and a run beneath it keep their own written
  // values instead of being fused into a single stem.
  const stacks = new Map<string, LaidOutNote[]>();
  for (const note of laidOut) {
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
  // Which way a head moves depends on where its stem points, so this has to
  // wait until the stems have settled.
  for (const voices of byStack) displaceCollidingHeads(voices);
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

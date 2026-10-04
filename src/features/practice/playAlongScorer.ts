import type { Outcome } from './resultCells';
import type { DueNote } from './runTimeline';

/**
 * How a run kept in time went, note by note. Pure: the notes the run asked
 * for, each at the moment it fell due, and the keys the player pressed, each
 * at the moment the player meant it, come in; a verdict on each note, and on
 * the player's timing, comes out.
 *
 * Every window is in real time, whatever the speed: a hand is as quick at
 * half speed as at full, and a player at half speed is no more forgiven for
 * being late.
 */

/** A note the run asked for, and when it fell due on the audio clock, in seconds. */
export interface TimedNote extends DueNote {
  dueAudioTime: number;
}

/**
 * A key the player pressed. `audioTime` is on the audio clock, in seconds,
 * less the output's latency: the moment the music they heard was at.
 */
export interface Press {
  midi: number;
  audioTime: number;
}

export type Verdict = 'onTime' | 'early' | 'late' | 'missed';

/** Which way the player pulls the beat, or `steady` when they keep it. */
export type Tendency = 'rushing' | 'dragging' | 'steady';

/** A note judged: where it is, how it was played, and whether it was on time (`good`). */
export interface JudgedNote extends Outcome {
  id: string;
  midi: number;
  /** Which time round a loop it came in; see `DueNote.pass`. */
  pass: number;
  verdict: Verdict;
  /** How far from its moment its press was, to the millisecond, early below 0; null when missed. */
  offsetMs: number | null;
}

export interface PlayAlongScore {
  /** The notes judged: those the run asked for, less any it stopped too soon to tell. */
  notes: number;
  /** Notes played in their window: on time, early or late. */
  hits: number;
  onTime: number;
  early: number;
  late: number;
  missed: number;
  /** Presses in no note's window. */
  wrong: number;
  /**
   * The notes played, of the notes asked for and the wrong notes besides: a
   * wrong note costs as much as a missed one, so playing every key at once
   * does not pay. From 0 to 1; 0 when there was nothing to judge.
   */
  accuracy: number;
  /** The notes played on time, of all the notes judged; from 0 to 1. */
  onTimeShare: number;
  /** How far from their moments the notes played were, on average, in ms; null with none. */
  meanOffsetMs: number | null;
  /** Null when too few notes were played to tell (`TENDENCY_MIN_NOTES`). */
  tendency: Tendency | null;
  /**
   * The notes played were late, and all by much the same: more likely the
   * sound reaching the player late (Bluetooth headphones, say) than the player.
   */
  consistentlyLate: boolean;
  /** Every note judged, in the order they fell due. */
  outcomes: JudgedNote[];
}

/** How far either side of its moment a press may land and still play a note. */
export const MATCH_MS = 200;

/** How close to its moment a note has to be played to be on time. */
export const ON_TIME_MS = 60;

/** How far off on average, either way, the player has to be to rush or to drag. */
export const TENDENCY_MS = 30;

/** Fewest notes played to say which way the player pulls the beat. */
export const TENDENCY_MIN_NOTES = 6;

/**
 * Late in the middle (the median) by more than this, and spread across less
 * than `LATE_SPREAD_MS` (the middle half of the offsets), over at least
 * `LATE_MIN_NOTES` notes, the lateness is steadier than a player's would be.
 */
export const LATE_MEDIAN_MS = 90;
export const LATE_SPREAD_MS = 40;
export const LATE_MIN_NOTES = 8;

export interface ScoreOptions {
  /** See `MATCH_MS`. */
  matchMs?: number;
  /** See `ON_TIME_MS`. */
  onTimeMs?: number;
  /**
   * When the music stopped. A press after it plays nothing new: it counts
   * where it lands in a note's window, late for the last notes, and is not a
   * wrong note anywhere else.
   */
  endAudioTime?: number;
  /**
   * How far the presses reach: the moment the run stopped listening, for one
   * stopped short. A note whose window was still open then, and that no press
   * had played yet, is left out, neither played nor missed.
   */
  heardUntil?: number;
}

/**
 * Judge each note in `due` by the presses in its window: the closest press,
 * if any, plays it; any other press in the same window is a second strike of
 * the key, counted neither way. A note's window reaches `matchMs` either side
 * of its moment, or halfway to the next or last time the run asks for its
 * key, whichever is nearer, so a repeated note or a trill keeps each press to
 * its own strike. A press in no window is a wrong note.
 */
export function scorePlayAlong(
  due: readonly TimedNote[],
  presses: readonly Press[],
  {
    matchMs = MATCH_MS,
    onTimeMs = ON_TIME_MS,
    endAudioTime = Number.POSITIVE_INFINITY,
    heardUntil = Number.POSITIVE_INFINITY,
  }: ScoreOptions = {},
): PlayAlongScore {
  /** Each key's notes, in the order they fall due. */
  const byKey = new Map<number, TimedNote[]>();
  for (const note of due) {
    const notes = byKey.get(note.midi) ?? [];
    notes.push(note);
    byKey.set(note.midi, notes);
  }
  /** When each note's window closes, on the audio clock. */
  const windowEnds = new Map<TimedNote, number>();
  for (const notes of byKey.values()) {
    notes.sort((a, b) => a.dueAudioTime - b.dueAudioTime);
    notes.forEach((note, index) => {
      const next = notes[index + 1];
      const end = note.dueAudioTime + matchMs / 1000;
      windowEnds.set(note, next ? Math.min(end, (note.dueAudioTime + next.dueAudioTime) / 2) : end);
    });
  }

  /** The press playing each note so far: how far from its moment, in seconds. */
  const closest = new Map<TimedNote, number>();
  let wrong = 0;
  for (const press of presses) {
    if (press.audioTime > heardUntil) continue;
    const note = nearestNote(byKey.get(press.midi) ?? [], press.audioTime);
    if (!note || !withinReach(press.audioTime, note.dueAudioTime, matchMs)) {
      if (press.audioTime <= endAudioTime) wrong += 1;
      continue;
    }
    const offset = press.audioTime - note.dueAudioTime;
    const held = closest.get(note);
    if (held === undefined || Math.abs(offset) < Math.abs(held)) closest.set(note, offset);
  }

  const outcomes: JudgedNote[] = [];
  for (const note of due) {
    const offset = closest.get(note);
    // Still open, and nothing in it yet: it might have gone either way.
    if (offset === undefined && (windowEnds.get(note) as number) > heardUntil) continue;
    const offsetMs = offset === undefined ? null : toMs(offset);
    const verdict: Verdict =
      offsetMs === null
        ? 'missed'
        : Math.abs(offsetMs) <= onTimeMs
          ? 'onTime'
          : offsetMs < 0
            ? 'early'
            : 'late';
    outcomes.push({
      id: note.id,
      midi: note.midi,
      atMs: note.atMs,
      pass: note.pass,
      verdict,
      offsetMs,
      good: verdict === 'onTime',
    });
  }

  const count = (verdict: Verdict) => outcomes.filter((note) => note.verdict === verdict).length;
  const onTime = count('onTime');
  const early = count('early');
  const late = count('late');
  const missed = count('missed');
  const hits = onTime + early + late;
  const notes = outcomes.length;
  const offsets = outcomes
    .map((note) => note.offsetMs)
    .filter((offsetMs): offsetMs is number => offsetMs !== null)
    .sort((a, b) => a - b);
  const meanOffsetMs =
    offsets.length > 0
      ? offsets.reduce((sum, offsetMs) => sum + offsetMs, 0) / offsets.length
      : null;
  return {
    notes,
    hits,
    onTime,
    early,
    late,
    missed,
    wrong,
    accuracy: notes + wrong > 0 ? hits / (notes + wrong) : 0,
    onTimeShare: notes > 0 ? onTime / notes : 0,
    meanOffsetMs,
    tendency: tendencyOf(offsets, meanOffsetMs),
    consistentlyLate:
      offsets.length >= LATE_MIN_NOTES &&
      quantile(offsets, 0.5) > LATE_MEDIAN_MS &&
      quantile(offsets, 0.75) - quantile(offsets, 0.25) < LATE_SPREAD_MS,
    outcomes,
  };
}

/** Whether a press at `audioTime` is near enough a note due at `dueAudioTime` to play it. */
export function withinReach(audioTime: number, dueAudioTime: number, matchMs = MATCH_MS): boolean {
  return Math.abs(toMs(audioTime - dueAudioTime)) <= matchMs;
}

/**
 * Seconds to whole milliseconds. Two readings of a running clock are rarely a
 * round number apart, even when the moments they were meant for were.
 */
function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/**
 * The note on this key nearest `audioTime`, the earlier of two as near: the
 * one whose window, cut halfway to its neighbours, holds it. `notes` are in
 * the order they fall due.
 */
function nearestNote(notes: readonly TimedNote[], audioTime: number): TimedNote | null {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((notes[middle] as TimedNote).dueAudioTime <= audioTime) low = middle + 1;
    else high = middle;
  }
  const before = notes[low - 1];
  const after = notes[low];
  if (!before) return after ?? null;
  if (!after) return before;
  return audioTime - before.dueAudioTime <= after.dueAudioTime - audioTime ? before : after;
}

/** Which way `offsets` (sorted, in ms) pull the beat, from enough of them to tell. */
function tendencyOf(offsets: readonly number[], meanOffsetMs: number | null): Tendency | null {
  if (meanOffsetMs === null || offsets.length < TENDENCY_MIN_NOTES) return null;
  if (meanOffsetMs < -TENDENCY_MS) return 'rushing';
  if (meanOffsetMs > TENDENCY_MS) return 'dragging';
  return 'steady';
}

/** The `q` quantile of `sorted`, between its two nearest values where it falls between them. */
function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const below = sorted[Math.floor(at)] as number;
  const above = sorted[Math.ceil(at)] as number;
  return below + (above - below) * (at - Math.floor(at));
}

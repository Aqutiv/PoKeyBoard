import { noteHand, type Hand } from '@/domain/hands';
import type { NoteEvent, PlaybackLoop } from '@/domain/takeTypes';
import { asksFor, CHORD_WINDOW_MS, type TrainingHand } from '@/domain/trainingGate';

/**
 * How far ahead, in real time, the practised hand's next notes light dimly:
 * far enough to see the next chord coming and move to it, near enough that a
 * long rest does not leave a note glowing seconds before it is due.
 */
export const COMING_WINDOW_MS = 2000;

/** First index whose note starts after `ms`, over notes sorted by start. */
function firstStartingAfter(notes: readonly NoteEvent[], ms: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((notes[mid] as NoteEvent).startMs <= ms) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The hand of each key a hold waits for: the note on that key starting at the
 * hold, where the playhead stands. A key with no such note (none should be)
 * takes no hand.
 */
export function holdTargetHands(
  notes: readonly NoteEvent[],
  targets: ReadonlySet<number>,
  playheadMs: number,
): Map<number, Hand | null> {
  const hands = new Map<number, Hand | null>();
  if (targets.size === 0) return hands;
  // A hold's chord spans CHORD_WINDOW_MS from its first note; the playhead
  // can sit a rounding hair either side of it.
  const from = firstStartingAfter(notes, playheadMs - CHORD_WINDOW_MS - 1);
  for (let i = from; i < notes.length; i += 1) {
    const note = notes[i] as NoteEvent;
    if (note.startMs > playheadMs + CHORD_WINDOW_MS + 1) break;
    if (targets.has(note.midi) && !hands.has(note.midi)) hands.set(note.midi, noteHand(note));
  }
  for (const midi of targets) if (!hands.has(midi)) hands.set(midi, null);
  return hands;
}

/** A playhead this close before a chord's onset is at it: a hold parks exactly there. */
const AT_ONSET_MS = 1;

interface Chord {
  readonly onsetMs: number;
  readonly notes: Map<number, Hand>;
}

/**
 * The first chord `hand` is asked to play whose onset falls after `afterMs`
 * (at or after, when `inclusive`) and before `endMs`. A chord is its first
 * note and every note asked within `CHORD_WINDOW_MS` of that onset, so a
 * chord the playhead is inside of — one sounding, or one a hold waits on —
 * is never the next one, while a chord still to come stays next until its
 * own onset, however close the playhead gets.
 */
function nextChord(
  notes: readonly NoteEvent[],
  afterMs: number,
  hand: TrainingHand,
  endMs: number,
  inclusive: boolean,
): Chord | null {
  const after = (onsetMs: number) =>
    inclusive ? onsetMs >= afterMs : onsetMs > afterMs + AT_ONSET_MS;
  let onsetMs: number | null = null;
  let chord = new Map<number, Hand>();
  // A chord reaching past `afterMs` began within one window before it; one
  // window more keeps a chord's first note from being taken for its middle.
  for (let i = firstStartingAfter(notes, afterMs - 2 * CHORD_WINDOW_MS); i < notes.length; i += 1) {
    const note = notes[i] as NoteEvent;
    // A loop plays only the notes that start before its end.
    if (note.startMs >= endMs) break;
    if (!asksFor(note, hand)) continue;
    if (onsetMs === null || note.startMs > onsetMs + CHORD_WINDOW_MS) {
      if (onsetMs !== null && after(onsetMs)) break;
      onsetMs = note.startMs;
      chord = new Map();
    }
    if (!chord.has(note.midi)) chord.set(note.midi, noteHand(note));
  }
  return onsetMs !== null && after(onsetMs) ? { onsetMs, notes: chord } : null;
}

const NOTHING_COMING: ReadonlyMap<number, Hand> = new Map();

/**
 * The practised hand's next notes: the first chord it is asked to play after
 * the one at the playhead, if it is due within `COMING_WINDOW_MS` of real
 * time at `speed`. Inside a loop, the pass ends at the loop's end and the
 * next chord can be the loop's first, as far off as the rest of this pass and
 * the way into the next.
 */
export function comingNotes(
  notes: readonly NoteEvent[],
  playheadMs: number,
  hand: TrainingHand,
  speed: number,
  loop: PlaybackLoop | null = null,
): ReadonlyMap<number, Hand> {
  const reachMs = COMING_WINDOW_MS * Math.max(speed, 0.01);
  const looping = loop !== null && playheadMs < loop.endMs;
  const endMs = looping ? loop.endMs : Number.POSITIVE_INFINITY;
  const next = nextChord(notes, playheadMs, hand, endMs, false);
  if (next) return next.onsetMs - playheadMs <= reachMs ? next.notes : NOTHING_COMING;
  if (!looping) return NOTHING_COMING;
  const first = nextChord(notes, loop.startMs, hand, loop.endMs, true);
  if (!first) return NOTHING_COMING;
  const awayMs = loop.endMs - playheadMs + (first.onsetMs - loop.startMs);
  return awayMs <= reachMs ? first.notes : NOTHING_COMING;
}

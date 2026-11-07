import { noteHand, type Hand } from '@/domain/hands';
import type { NoteEvent, PlaybackLoop } from '@/domain/takeTypes';
import {
  asksFor,
  CHORD_WINDOW_MS,
  nextTrainingGate,
  type TrainingHand,
} from '@/domain/trainingGate';

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

/** A playhead this close before a note's onset is at it: a hold parks exactly there. */
const AT_ONSET_MS = 1;

/**
 * The hand of each key a hold waits for, from the notes the hold asks for:
 * those `hand` is asked to play in its chord, which starts where the playhead
 * parks and runs `CHORD_WINDOW_MS` on. Nothing before the hold counts, so a
 * key the other hand struck just before keeps nothing of its colour. A key
 * with no such note (none should be) takes no hand.
 */
export function holdTargetHands(
  notes: readonly NoteEvent[],
  targets: ReadonlySet<number>,
  playheadMs: number,
  hand: TrainingHand,
): Map<number, Hand | null> {
  const hands = new Map<number, Hand | null>();
  if (targets.size === 0) return hands;
  for (let i = firstStartingAfter(notes, playheadMs - AT_ONSET_MS); i < notes.length; i += 1) {
    const note = notes[i] as NoteEvent;
    if (note.startMs > playheadMs + CHORD_WINDOW_MS + AT_ONSET_MS) break;
    if (targets.has(note.midi) && asksFor(note, hand) && !hands.has(note.midi)) {
      hands.set(note.midi, noteHand(note));
    }
  }
  for (const midi of targets) if (!hands.has(midi)) hands.set(midi, null);
  return hands;
}

interface Chord {
  readonly onsetMs: number;
  readonly notes: ReadonlyMap<number, Hand>;
}

/**
 * The chord a hold placed at or after `fromMs` asks for, exactly as the
 * transport places one (`nextTrainingGate`): the first note `hand` is asked
 * for, and every one asked within `CHORD_WINDOW_MS` of it, none from `endMs`
 * on. Grouped from that first note, wherever the search starts, so the chord
 * the player sees coming is the one they will be asked for.
 */
function chordFrom(
  notes: readonly NoteEvent[],
  fromMs: number,
  hand: TrainingHand,
  endMs: number,
): Chord | null {
  const gate = nextTrainingGate(notes, fromMs, hand, endMs);
  if (!gate) return null;
  const chord = new Map<number, Hand>();
  // From the chord's own first note: `firstStartingAfter` is strict.
  for (let i = firstStartingAfter(notes, gate.atMs - 1e-6); i < notes.length; i += 1) {
    const note = notes[i] as NoteEvent;
    if (note.startMs > gate.atMs + CHORD_WINDOW_MS || note.startMs >= endMs) break;
    if (gate.midis.has(note.midi) && asksFor(note, hand) && !chord.has(note.midi)) {
      chord.set(note.midi, noteHand(note));
    }
  }
  return { onsetMs: gate.atMs, notes: chord };
}

const NOTHING_COMING: ReadonlyMap<number, Hand> = new Map();

/**
 * The practised hand's next notes, if they are due within `COMING_WINDOW_MS`
 * of real time at `speed`:
 * - playing, the chord grouped from the first note asked for after the
 *   playhead, so a key leaves the preview only as its own onset passes;
 * - at a hold (`atHold`), the chord after the one held for, from where the
 *   transport looks for its next hold once this one is played.
 *
 * Inside a loop the pass ends at the loop's end, and the next chord can then
 * be the loop's first (from its start, never before), as far off as the rest
 * of this pass and the way into the next.
 */
export function comingNotes(
  notes: readonly NoteEvent[],
  playheadMs: number,
  hand: TrainingHand,
  speed: number,
  loop: PlaybackLoop | null = null,
  atHold = false,
): ReadonlyMap<number, Hand> {
  const reachMs = COMING_WINDOW_MS * Math.max(speed, 0.01);
  const looping = loop !== null && playheadMs < loop.endMs;
  const endMs = looping ? loop.endMs : Number.POSITIVE_INFINITY;
  const fromMs = Math.min(
    atHold ? playheadMs + CHORD_WINDOW_MS + 1 : playheadMs + AT_ONSET_MS,
    endMs,
  );
  const next = chordFrom(notes, fromMs, hand, endMs);
  if (next) return next.onsetMs - playheadMs <= reachMs ? next.notes : NOTHING_COMING;
  if (!looping) return NOTHING_COMING;
  const first = chordFrom(notes, loop.startMs, hand, loop.endMs);
  if (!first) return NOTHING_COMING;
  const awayMs = loop.endMs - playheadMs + (first.onsetMs - loop.startMs);
  return awayMs <= reachMs ? first.notes : NOTHING_COMING;
}

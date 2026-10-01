import { noteHand, type Hand } from '@/domain/hands';
import { isSilentNote, lowerBoundByStart } from '@/domain/noteEvents';
import { MAX_PLAYBACK_SPEED, type NoteEvent, type PlaybackLoop } from '@/domain/takeTypes';
import type { KeyboardLayout, KeyLayout } from '@/features/keyboard/keyboardGeometry';
import { MIN_LOOP_MS } from '@/features/transport/transportClock';
import { SLOWEST_FALL_SECONDS } from './fallSpeed';

/**
 * Where each note of a take falls toward its key: the falling-notes view's
 * picture of one moment, in CSS pixels, before anything is painted.
 *
 * Time runs up the view. The key tops are now, and the top edge is `spanMs`
 * of take time later. A note's lower edge reaches the keys the moment it
 * starts, as its key lights, and its length is how long its key is held: the
 * note's own duration, as `SoundingNotes` lights it, so a bar and its key
 * never disagree about when a note sounds.
 */

/** The shortest a bar is drawn, so the briefest grace note still shows. */
export const MIN_BAR_PX = 2;

/** Taken off each bar's top, so two strikes of one key, back to back, read as two. */
export const STRIKE_GAP_PX = 1;

/** How far a white key's bar stands in from each of the key's edges… */
const WHITE_INSET_PX = 2;
/** …or this share of the key, on keys too narrow for it. */
const WHITE_INSET_SHARE = 0.06;

/**
 * The most passes of a loop drawn above its end: enough to fill the tallest
 * view — the slowest fall, at the fastest playback — with the shortest loop
 * playback will play, and a guard against anything more.
 */
export const MAX_LOOP_PASSES =
  Math.ceil((SLOWEST_FALL_SECONDS * 1000 * MAX_PLAYBACK_SPEED) / MIN_LOOP_MS) + 1;

export interface WaterfallTimeline {
  /** The moment at the key tops, in take ms; before 0 while a recording counts in. */
  readonly nowMs: number;
  /** How much take time the view shows, from the keys to its top edge. */
  readonly spanMs: number;
  /** The passage playback repeats, or null. */
  readonly loop: PlaybackLoop | null;
  /**
   * Where the pass at the keys began: where playback started, or the loop's
   * top once it came round; at rest, where it would start. Playback strikes
   * the notes from there on, so one held from before it is drawn as an
   * outline. See `TransportController.getPassStartMs`.
   */
  readonly passStartMs: number;
}

export interface WaterfallViewport {
  readonly widthPx: number;
  readonly heightPx: number;
  /** The key bed under the view, laid out as `layoutKeyboard` lays it. */
  readonly keys: KeyboardLayout;
}

/** One stretch of a note, standing over its key. */
export interface WaterfallBar {
  readonly note: NoteEvent;
  readonly hand: Hand;
  readonly black: boolean;
  /**
   * Not played on this pass, so drawn hollow: written but never struck, or
   * held from before where the pass began.
   */
  readonly silent: boolean;
  readonly x: number;
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
  /** The view's top edge cuts the bar, so its upper end is not the note's. */
  readonly cutTop: boolean;
  /**
   * The bar's lower end is not where its note starts: the note is sounding,
   * so the bar runs on into its key; or it is held into a loop from before,
   * and a later pass takes it up at the loop's top.
   */
  readonly cutBottom: boolean;
  /** 0 for the take as it plays on; 1 and up for the passes round a loop above it. */
  readonly pass: number;
}

/** A note whose key is off the key bed, shown as a mark at that edge. */
export interface WaterfallMarker {
  readonly side: 'low' | 'high';
  readonly note: NoteEvent;
  readonly hand: Hand;
  /** Not played on this pass; see `WaterfallBar.silent`. */
  readonly silent: boolean;
  readonly top: number;
  readonly bottom: number;
}

export interface WaterfallScene {
  /** White keys' bars first, then black keys', which are drawn over them. */
  readonly bars: readonly WaterfallBar[];
  readonly markers: readonly WaterfallMarker[];
  /** Where each octave starts across the view, at its C. */
  readonly octaveXs: readonly number[];
  /** Where a looped passage starts again, down the view. */
  readonly restartYs: readonly number[];
}

const EMPTY_SCENE: WaterfallScene = { bars: [], markers: [], octaveXs: [], restartYs: [] };

const reaches = new WeakMap<readonly NoteEvent[], Float64Array>();

/**
 * How far the take reaches by each note: the latest end among it and every
 * note before it. A take's notes are sorted by start but can end in any order,
 * since a long bass note outlasts the run above it, so the search for the
 * first note still sounding has to go by this. Kept per notes array, which a
 * take replaces whenever its notes change.
 */
export function noteReach(notes: readonly NoteEvent[]): Float64Array {
  const cached = reaches.get(notes);
  if (cached) return cached;
  const reach = new Float64Array(notes.length);
  let furthest = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i] as NoteEvent;
    furthest = Math.max(furthest, note.startMs + note.durationMs);
    reach[i] = furthest;
  }
  reaches.set(notes, reach);
  return reach;
}

/** The first note that may still sound after `ms`: every one before it has ended by then. */
export function firstReaching(reach: Float64Array, ms: number): number {
  let low = 0;
  let high = reach.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((reach[mid] as number) > ms) high = mid;
    else low = mid + 1;
  }
  return low;
}

const keyMaps = new WeakMap<KeyboardLayout, Map<number, KeyLayout>>();

function keysByMidi(keys: KeyboardLayout): Map<number, KeyLayout> {
  let byMidi = keyMaps.get(keys);
  if (!byMidi) {
    byMidi = new Map(keys.keys.map((key) => [key.midi, key]));
    keyMaps.set(keys, byMidi);
  }
  return byMidi;
}

/**
 * Lay out `notes`, sorted by start, as they stand at `timeline`'s moment over
 * the keys of `view`. Each frame walks only the notes that can be in view:
 * from the first still sounding to the last starting below the top edge.
 *
 * Playback strikes the notes from where its pass began (`passStartMs`), so a
 * note held across that point is drawn hollow, as one written but not played
 * is: it is in the music, but it will not sound.
 *
 * Round a loop, playback lets every key go at the loop's end and plays the
 * passage again from its start, striking the notes that start inside it. So
 * the passage is drawn again above its end, pass after pass up to the top
 * edge, with a restart line where each pass begins, and a note held into the
 * loop from before is hollow on every pass but a first begun before it. That
 * holds only while the playhead is short of the loop's end; a scrub past it
 * shows the take straight on.
 */
export function layoutWaterfall(
  notes: readonly NoteEvent[],
  timeline: WaterfallTimeline,
  view: WaterfallViewport,
): WaterfallScene {
  const { nowMs, spanMs, loop, passStartMs } = timeline;
  const { widthPx, heightPx, keys } = view;
  if (widthPx <= 0 || heightPx <= 0 || spanMs <= 0 || keys.whiteCount <= 0) return EMPTY_SCENE;

  const keyWidth = widthPx / keys.whiteCount;
  const inset = Math.min(WHITE_INSET_PX, WHITE_INSET_SHARE * keyWidth);
  const pxPerMs = heightPx / spanMs;
  const topMs = nowMs + spanMs;
  const byMidi = keysByMidi(keys);
  const y = (ms: number) => heightPx - (ms - nowMs) * pxPerMs;
  const fold = loop !== null && nowMs < loop.endMs && loop.endMs > loop.startMs ? loop : null;
  const lengthMs = fold ? fold.endMs - fold.startMs : 0;

  const whites: WaterfallBar[] = [];
  const blacks: WaterfallBar[] = [];
  const markers: WaterfallMarker[] = [];
  const restartYs: number[] = [];

  /**
   * Lay out the stretch of `note` from `fromMs` to `toMs` on `pass`, if any of
   * it is in view: `struck` when playback plays it there.
   */
  const place = (
    note: NoteEvent,
    fromMs: number,
    toMs: number,
    pass: number,
    struck: boolean,
  ): void => {
    if (fromMs >= topMs || toMs <= nowMs || toMs <= fromMs) return;
    const lower = y(fromMs);
    const upper = y(toMs);
    const cutTop = upper < 0;
    const cutBottom = lower > heightPx || fromMs > note.startMs + pass * lengthMs;
    const bottom = Math.min(heightPx, lower);
    let top = cutTop ? 0 : upper + STRIKE_GAP_PX;
    if (bottom - top < MIN_BAR_PX) top = bottom - MIN_BAR_PX;
    const hand = noteHand(note);
    const silent = !struck || isSilentNote(note);
    const key = byMidi.get(note.midi);
    if (!key) {
      const side = note.midi < keys.lowMidi ? 'low' : 'high';
      markers.push({ side, note, hand, silent, top, bottom });
      return;
    }
    const stretch = { note, hand, silent, top, bottom, cutTop, cutBottom, pass };
    if (key.isBlack) {
      blacks.push({ ...stretch, black: true, x: key.x * keyWidth, width: key.width * keyWidth });
    } else {
      whites.push({
        ...stretch,
        black: false,
        x: key.x * keyWidth + inset,
        width: keyWidth - 2 * inset,
      });
    }
  };

  const reach = noteReach(notes);
  const passEndMs = fold ? Math.min(topMs, fold.endMs) : topMs;
  for (
    let i = firstReaching(reach, nowMs), end = lowerBoundByStart(notes, passEndMs);
    i < end;
    i += 1
  ) {
    const note = notes[i] as NoteEvent;
    const endMs = note.startMs + note.durationMs;
    const toMs = fold ? Math.min(endMs, fold.endMs) : endMs;
    place(note, note.startMs, toMs, 0, note.startMs >= passStartMs);
  }
  if (fold) {
    // Each pass strikes only the notes that start inside the loop, as playback
    // does; one held into it from before comes round hollow, from its top.
    // Those are found once, not once a pass.
    const inside = lowerBoundByStart(notes, fold.startMs);
    const heldIn: NoteEvent[] = [];
    for (let i = firstReaching(reach, fold.startMs); i < inside; i += 1) {
      const note = notes[i] as NoteEvent;
      if (note.startMs + note.durationMs > fold.startMs) heldIn.push(note);
    }
    const end = lowerBoundByStart(notes, fold.endMs);
    for (let pass = 1; pass <= MAX_LOOP_PASSES; pass += 1) {
      const offsetMs = pass * lengthMs;
      if (fold.startMs + offsetMs >= topMs) break;
      restartYs.push(y(fold.startMs + offsetMs));
      for (const note of heldIn) {
        const endMs = Math.min(note.startMs + note.durationMs, fold.endMs);
        place(note, fold.startMs + offsetMs, endMs + offsetMs, pass, false);
      }
      for (let i = inside; i < end; i += 1) {
        const note = notes[i] as NoteEvent;
        const endMs = Math.min(note.startMs + note.durationMs, fold.endMs);
        place(note, note.startMs + offsetMs, endMs + offsetMs, pass, true);
      }
    }
  }

  const octaveXs: number[] = [];
  for (const key of keys.keys) {
    if (!key.isBlack && key.midi % 12 === 0 && key.x > 0) octaveXs.push(key.x * keyWidth);
  }
  return { bars: [...whites, ...blacks], markers, octaveXs, restartYs };
}

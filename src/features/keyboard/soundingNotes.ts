import { noteHand, type Hand } from '@/domain/hands';
import type { NoteEvent } from '@/domain/takeTypes';

/**
 * Past this far forward in one step, the notes sounding are found afresh
 * rather than walked to: a seek, a loop's jump back, a hold released.
 */
const WALK_LIMIT_MS = 2_000;

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
 * Which of a take's notes are sounding under the playhead, and in which hand.
 *
 * Asked every frame, so it walks rather than scans: while the playhead moves
 * forward, notes join as it passes their start and leave as it passes their
 * end, and only those are looked at. A take of tens of thousands of notes
 * costs no more a frame than the handful that are sounding. Anything else —
 * a step back, a jump — finds them afresh, looking back no further than the
 * take's longest note could reach.
 */
export class SoundingNotes {
  private notes: readonly NoteEvent[] = [];
  private longestMs = 0;
  /** First note starting after `lastMs`. */
  private cursor = 0;
  /** Notes sounding at `lastMs`, in the order they started. */
  private sounding: number[] = [];
  private lastMs = Number.NEGATIVE_INFINITY;

  /** The take's notes, sorted by start; the same array again is free. */
  setNotes(notes: readonly NoteEvent[]): void {
    if (notes === this.notes) return;
    this.notes = notes;
    this.longestMs = 0;
    for (const note of notes) this.longestMs = Math.max(this.longestMs, note.durationMs);
    this.lastMs = Number.NEGATIVE_INFINITY;
  }

  /**
   * The keys sounding at `ms`, each with the hand that plays it. Where both
   * hands sound one key, the earlier note owns it rather than the light
   * flickering between two shades.
   */
  handsAt(ms: number): Map<number, Hand> {
    this.advanceTo(ms);
    const hands = new Map<number, Hand>();
    for (const index of this.sounding) {
      const note = this.notes[index] as NoteEvent;
      if (!hands.has(note.midi)) hands.set(note.midi, noteHand(note));
    }
    return hands;
  }

  /**
   * The keys of the notes starting after `ms` and no later than `ms + spanMs`:
   * what is about to play. Call after `handsAt(ms)`, which it walks on from.
   */
  startingWithin(ms: number, spanMs: number): number[] {
    const midis: number[] = [];
    for (let i = this.cursor; i < this.notes.length; i += 1) {
      const note = this.notes[i] as NoteEvent;
      if (note.startMs > ms + spanMs) break;
      midis.push(note.midi);
    }
    return midis;
  }

  private advanceTo(ms: number): void {
    const notes = this.notes;
    if (ms < this.lastMs || ms - this.lastMs > WALK_LIMIT_MS) {
      this.cursor = firstStartingAfter(notes, ms);
      this.sounding = [];
      for (let i = firstStartingAfter(notes, ms - this.longestMs - 1); i < this.cursor; i += 1) {
        const note = notes[i] as NoteEvent;
        if (note.startMs + note.durationMs > ms) this.sounding.push(i);
      }
    } else {
      while (this.cursor < notes.length && (notes[this.cursor] as NoteEvent).startMs <= ms) {
        this.sounding.push(this.cursor);
        this.cursor += 1;
      }
      this.sounding = this.sounding.filter((index) => {
        const note = notes[index] as NoteEvent;
        return note.startMs + note.durationMs > ms;
      });
    }
    this.lastMs = ms;
  }
}

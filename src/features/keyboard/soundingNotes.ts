import { noteHand, type KeyCue } from '@/domain/hands';
import { isSilentNote } from '@/domain/noteEvents';
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
 * Whether `next`, struck on the same key no earlier than `heard`, is the one
 * heard from then on. A struck key gives way to the new strike, and of two
 * copies struck at one moment the louder is struck last (`compareStrikes`), so
 * the later strike wins and, at the same moment, the louder. A note written but
 * not played is never struck, so any note that sounds wins over one that does
 * not, whenever it came.
 */
function heardOver(next: NoteEvent, heard: NoteEvent): boolean {
  const silent = isSilentNote(next);
  if (silent !== isSilentNote(heard)) return !silent;
  return next.startMs > heard.startMs || next.velocity > heard.velocity;
}

/**
 * Which of a take's notes are sounding under the playhead, in which hand, and
 * how hard the strike heard on each key was played.
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
  /**
   * Each key's strike heard last among the notes started by `lastMs`; see
   * `heardOver`. Kept past its own note's end: a note struck inside a longer one
   * on the same key is heard until that one lets the key go too, the way
   * `VoiceManager.scheduleNote` holds it.
   */
  private readonly heard = new Map<number, NoteEvent>();
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
   * The keys sounding at `ms`, each with the hand that plays it and the
   * velocity it is heard at. Where both hands sound one key, the earlier note
   * owns it rather than the light flickering between two shades; the velocity
   * is the strike heard there, which is the later one. A key lit only by notes
   * written but not played has none to show, and says 0.
   */
  keysAt(ms: number): Map<number, KeyCue> {
    this.advanceTo(ms);
    const keys = new Map<number, KeyCue>();
    for (const index of this.sounding) {
      const note = this.notes[index] as NoteEvent;
      if (keys.has(note.midi)) continue;
      // The key's earliest note still sounding. A strike before it belongs to
      // an earlier press of the key, heard only because no note since has been.
      const heard = this.heard.get(note.midi);
      const velocity = heard && heard.startMs >= note.startMs ? heard.velocity : 0;
      keys.set(note.midi, { hand: noteHand(note), velocity });
    }
    return keys;
  }

  /**
   * The keys of the notes starting after `ms` and no later than `ms + spanMs`:
   * what is about to play. Call after `keysAt(ms)`, which it walks on from.
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
      this.heard.clear();
      // Every note still sounding starts in this window, and so does every
      // strike that could be heard on one of their keys.
      for (let i = firstStartingAfter(notes, ms - this.longestMs - 1); i < this.cursor; i += 1) {
        const note = notes[i] as NoteEvent;
        this.strike(note);
        if (note.startMs + note.durationMs > ms) this.sounding.push(i);
      }
    } else {
      while (this.cursor < notes.length && (notes[this.cursor] as NoteEvent).startMs <= ms) {
        this.strike(notes[this.cursor] as NoteEvent);
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

  /** Notes arrive in start order, so each is struck no earlier than the last. */
  private strike(note: NoteEvent): void {
    const heard = this.heard.get(note.midi);
    if (!heard || heardOver(note, heard)) this.heard.set(note.midi, note);
  }
}

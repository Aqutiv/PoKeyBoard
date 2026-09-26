import { newId } from '@/utils/ids';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_INSTRUMENT_ID,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_REVERB_MIX,
  DEFAULT_REVERB_ROOM,
  DEFAULT_SAMPLE_PACK_VERSION,
  type NoteEvent,
  type PedalEvent,
  type Take,
} from './takeTypes';

/** Deterministic ordering: startMs, then pitch, then id as a stable tiebreak. */
export function compareNoteEvents(a: NoteEvent, b: NoteEvent): number {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  if (a.midi !== b.midi) return a.midi - b.midi;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortNotes(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort(compareNoteEvents);
}

/**
 * The order the piano strikes notes in: `compareNoteEvents`, except that of two
 * copies of one key at one moment the quieter comes first. A key struck again
 * gives way to the new strike (`VoiceManager.restrike`, `scheduleTakeVoices`),
 * so the copy struck last is the only one heard, and this makes it the louder —
 * as a pianist plays a note two voices share — rather than whichever the
 * stored order happens to put second. The stored order is left alone: the
 * notation reads it, and wants a score's first voice first.
 */
export function compareStrikes(a: NoteEvent, b: NoteEvent): number {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  if (a.midi !== b.midi) return a.midi - b.midi;
  if (a.velocity !== b.velocity) return a.velocity - b.velocity;
  return compareNoteEvents(a, b);
}

export function sortStrikes(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort(compareStrikes);
}

/**
 * Whether a note is written but not played. A score marks one with velocity 0 —
 * MuseScore's `dynamics="0"`, on a trill's written note whose trill a hidden
 * voice plays out, or on the silent twin of a note two voices share — so
 * playback, scrubbing and export leave it out, while the notation still draws
 * it and practice still asks for its key.
 */
export function isSilentNote(note: Pick<NoteEvent, 'velocity'>): boolean {
  return note.velocity <= 0;
}

/**
 * Whether a note is played but not written — the mirror of `isSilentNote`. A
 * score hides one (`print-object="no"`, or a note with no head) to play what it
 * writes some other way: a trill or a turn written out beside the note that
 * carries its sign, or a copy of a note one voice shares with another. So
 * playback, scrubbing, export and the keyboard sound it like any other, while
 * the notation never draws it and practice never stops to ask for it.
 */
export function isHiddenNote(note: Pick<NoteEvent, 'hidden'>): boolean {
  return note.hidden === true;
}

/**
 * The notes a score draws: every one but the hidden. The array itself when
 * none is hidden, as in every recorded take.
 */
export function writtenNotes(notes: readonly NoteEvent[]): readonly NoteEvent[] {
  return notes.some(isHiddenNote) ? notes.filter((note) => !isHiddenNote(note)) : notes;
}

/**
 * First index whose startMs is >= t, over notes sorted by startMs. Anything
 * that walks a take forward from a time — scrubbing, the training gate —
 * starts here rather than scanning a take that may hold tens of thousands of
 * notes.
 */
export function lowerBoundByStart(notes: readonly NoteEvent[], t: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((notes[mid] as NoteEvent).startMs < t) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function comparePedalEvents(a: PedalEvent, b: PedalEvent): number {
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  return Number(a.down) - Number(b.down);
}

export function sortPedalEvents(pedals: readonly PedalEvent[]): PedalEvent[] {
  return [...pedals].sort(comparePedalEvents);
}

/** Musical duration of a take: the latest note end, 0 for an empty take. */
export function computeTakeDurationMs(notes: readonly NoteEvent[]): number {
  let max = 0;
  for (const note of notes) {
    const end = note.startMs + note.durationMs;
    if (end > max) max = end;
  }
  return max;
}

export function removeNotesByIds(
  notes: readonly NoteEvent[],
  ids: ReadonlySet<string>,
): NoteEvent[] {
  return notes.filter((note) => !ids.has(note.id));
}

export const UNTITLED_TAKE_TITLE = 'Untitled take';

export function createEmptyTake(overrides: Partial<Take> = {}): Take {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId(),
    title: UNTITLED_TAKE_TITLE,
    createdAt: now,
    updatedAt: now,
    durationMs: 0,
    samplePackVersion: DEFAULT_SAMPLE_PACK_VERSION,
    tempo: {
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      countInBars: 1,
    },
    instrument: {
      id: DEFAULT_INSTRUMENT_ID,
      masterVolume: DEFAULT_MASTER_VOLUME,
      reverbMix: DEFAULT_REVERB_MIX,
      reverbRoom: DEFAULT_REVERB_ROOM,
    },
    notes: [],
    pedalEvents: [],
    display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
    ...overrides,
  };
}

export function touchUpdated(take: Take): Take {
  return { ...take, updatedAt: new Date().toISOString() };
}

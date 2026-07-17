import { newId } from '@/utils/ids';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_INSTRUMENT_ID,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_REVERB_MIX,
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

export function removeNotesByIds(notes: readonly NoteEvent[], ids: ReadonlySet<string>): NoteEvent[] {
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

import type { NoteEvent, PedalEvent } from '@/domain/takeTypes';
import { MAX_NOTE_DURATION_MS } from '@/domain/takeTypes';

/**
 * Apply sustain-pedal events to note durations for playback and offline
 * rendering: while the pedal is down at a note's release, the note rings on
 * until the next pedal-up (or the note's max length). Pure and testable —
 * playback then schedules plain fixed-duration notes.
 */
export function applySustainToNotes(
  notes: readonly NoteEvent[],
  pedals: readonly PedalEvent[],
): NoteEvent[] {
  if (pedals.length === 0) return [...notes];

  const sortedPedals = [...pedals].sort((a, b) => a.atMs - b.atMs || Number(a.down) - Number(b.down));

  const isPedalDownAt = (timeMs: number): boolean => {
    let down = false;
    for (const pedal of sortedPedals) {
      if (pedal.atMs > timeMs) break;
      down = pedal.down;
    }
    return down;
  };

  const nextPedalUpAfter = (timeMs: number): number | null => {
    for (const pedal of sortedPedals) {
      if (!pedal.down && pedal.atMs > timeMs) return pedal.atMs;
    }
    return null;
  };

  return notes.map((note) => {
    const releaseAt = note.startMs + note.durationMs;
    if (!isPedalDownAt(releaseAt)) return note;
    const pedalUp = nextPedalUpAfter(releaseAt);
    if (pedalUp === null) {
      // Pedal never released: ring to the cap.
      return { ...note, durationMs: Math.min(MAX_NOTE_DURATION_MS, note.durationMs + 8_000) };
    }
    const extended = pedalUp - note.startMs;
    return { ...note, durationMs: Math.min(MAX_NOTE_DURATION_MS, Math.max(note.durationMs, extended)) };
  });
}

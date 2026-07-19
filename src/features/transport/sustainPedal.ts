import type { NoteEvent, PedalEvent, Take } from '@/domain/takeTypes';
import { MAX_NOTE_DURATION_MS } from '@/domain/takeTypes';

interface SustainInterval {
  startMs: number;
  endMs: number | null;
}

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

  const sortedPedals = [...pedals].sort(
    (a, b) => a.atMs - b.atMs || Number(a.down) - Number(b.down),
  );

  const intervals: SustainInterval[] = [];
  let downAt: number | null = null;
  for (const pedal of sortedPedals) {
    if (pedal.down) {
      if (downAt === null) downAt = pedal.atMs;
    } else if (downAt !== null) {
      intervals.push({ startMs: downAt, endMs: pedal.atMs });
      downAt = null;
    }
  }
  if (downAt !== null) intervals.push({ startMs: downAt, endMs: null });

  const intervalAt = (timeMs: number): SustainInterval | null => {
    let low = 0;
    let high = intervals.length - 1;
    let candidate: SustainInterval | null = null;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const interval = intervals[middle] as SustainInterval;
      if (interval.startMs <= timeMs) {
        candidate = interval;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return candidate && (candidate.endMs === null || timeMs < candidate.endMs) ? candidate : null;
  };

  return notes.map((note) => {
    const releaseAt = note.startMs + note.durationMs;
    const interval = intervalAt(releaseAt);
    if (!interval) return note;
    if (interval.endMs === null) {
      // Pedal never released: ring to the cap.
      return { ...note, durationMs: Math.min(MAX_NOTE_DURATION_MS, note.durationMs + 8_000) };
    }
    const extended = interval.endMs - note.startMs;
    return {
      ...note,
      durationMs: Math.min(MAX_NOTE_DURATION_MS, Math.max(note.durationMs, extended)),
    };
  });
}

/** Audible end of a take, including sustain tails while preserving v1 duration. */
export function effectivePlaybackDurationMs(take: Take): number {
  let durationMs = take.durationMs;
  for (const note of applySustainToNotes(take.notes, take.pedalEvents)) {
    durationMs = Math.max(durationMs, note.startMs + note.durationMs);
  }
  return durationMs;
}

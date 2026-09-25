import { sortNotes } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { createBeatTempoMap } from '@/domain/tempoMap';
import { noteNameToMidi } from '@/utils/midi';
import type { LearnPhrase } from './types';

const DEFAULT_VELOCITY = 0.7;

/**
 * Turn an authored phrase into note events.
 *
 * One conversion serves both consumers — the Listen demo schedules these, and
 * the staff snippet engraves them — so a written example can never sound like
 * one thing and look like another.
 */
export function phraseToNotes(phrase: LearnPhrase): NoteEvent[] {
  const map = createBeatTempoMap(phrase.bpm, phrase.timeSignature);
  const notes: NoteEvent[] = [];

  phrase.events.forEach((event, index) => {
    const [beat, noteOrChord, durationBeats, velocity, staff] = event;
    const names = Array.isArray(noteOrChord) ? noteOrChord : [noteOrChord];
    // Endpoints go through the map, not durations, so a note reads as written.
    const startMs = Math.round(map.msAtBeat(beat));
    const durationMs = Math.max(1, Math.round(map.msAtBeat(beat + durationBeats)) - startMs);
    names.forEach((name, chordIndex) => {
      const midi = noteNameToMidi(name);
      if (midi === null) {
        throw new Error(`Learn phrase: invalid note "${name}" in event ${index}`);
      }
      notes.push({
        id: `learn-n${index}-${chordIndex}`,
        midi,
        startMs,
        durationMs,
        velocity: velocity ?? DEFAULT_VELOCITY,
        // Without this, `midiToStaffPosition` splits purely on middle C, so a
        // lesson could never show a low note on the treble staff. Omitted
        // entirely when unsaid, so phrases that never mention a staff lay out
        // exactly as they did before.
        ...(staff !== undefined ? { staff } : {}),
      });
    });
  });

  return sortNotes(notes);
}

export function phraseDurationMs(notes: readonly NoteEvent[]): number {
  return notes.reduce((end, note) => Math.max(end, note.startMs + note.durationMs), 0);
}

/** Everything a written line asks to be struck on one beat. */
export interface PhraseMoment {
  /** Beats from the phrase's first bar line, exactly as authored. */
  beat: number;
  /** Ascending, without repeats. */
  midis: readonly number[];
  /**
   * Each written note with the id `phraseToNotes` gives it, so the stave can
   * light exactly the heads that have been played — including half a chord.
   */
  notes: readonly { midi: number; id: string }[];
}

const momentCache = new WeakMap<LearnPhrase, readonly PhraseMoment[]>();

/**
 * A phrase as the line a `playAlong` step walks: one moment per onset beat.
 *
 * Read from the authored events rather than from `phraseToNotes`, so a beat is
 * the number the chapter wrote and never a millisecond rounded back — while
 * the ids are built by the same rule, so a moment names exactly the heads the
 * snippet draws. Cached by phrase identity: the reducer asks on every press.
 */
export function momentsOf(phrase: LearnPhrase): readonly PhraseMoment[] {
  const cached = momentCache.get(phrase);
  if (cached) return cached;

  const byBeat = new Map<number, { midi: number; id: string }[]>();
  phrase.events.forEach((event, index) => {
    const [beat, noteOrChord] = event;
    const names = Array.isArray(noteOrChord) ? noteOrChord : [noteOrChord];
    const notes = byBeat.get(beat) ?? [];
    names.forEach((name, chordIndex) => {
      const midi = noteNameToMidi(name);
      if (midi === null) throw new Error(`Learn phrase: invalid note "${name}" in event ${index}`);
      notes.push({ midi, id: `learn-n${index}-${chordIndex}` });
    });
    byBeat.set(beat, notes);
  });

  const moments = [...byBeat]
    .sort(([a], [b]) => a - b)
    .map(([beat, notes]) => ({
      beat,
      midis: [...new Set(notes.map((note) => note.midi))].sort((a, b) => a - b),
      notes,
    }));
  momentCache.set(phrase, moments);
  return moments;
}

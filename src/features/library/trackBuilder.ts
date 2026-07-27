import { libraryTakeId } from '@/domain/libraryTakes';
import { computeTakeDurationMs, createEmptyTake, sortNotes } from '@/domain/noteEvents';
import { createBeatTempoMap, tempoChangesFrom, type TempoMap } from '@/domain/tempoMap';
import type {
  CountInBars,
  NoteEvent,
  NoteStaff,
  PedalEvent,
  QuantizationSetting,
  Take,
  TimeSignature,
} from '@/domain/takeTypes';
import type { Messages } from '@/i18n/types';
import { noteNameToMidi } from '@/utils/midi';

/**
 * One authored event: `[beat, note(s), durationBeats, velocity?, staff?]`.
 * `beat` counts from 0 in units of the time signature's denominator note
 * (quarters in 4/4, eighths in 3/8); fractional beats express sixteenths and
 * swing placement. A string array sounds a chord.
 *
 * `staff` says which side of the grand staff the source score wrote the event
 * on. Leaving it off — as every track written straight into this format does —
 * lets the notation split at middle C, which is right for a piece composed
 * that way and wrong for one whose left hand climbs above it.
 */
export type TrackEvent = [
  beat: number,
  note: string | string[],
  durationBeats: number,
  velocity?: number,
  staff?: NoteStaff,
];

export interface LibraryTrackDef {
  trackId: string;
  title: string;
  composer: string;
  descriptionKey: keyof Messages['library']['descriptions'];
  bpm: number;
  timeSignature: TimeSignature;
  countInBars?: CountInBars;
  quantization?: QuantizationSetting;
  /** 'bar' lays a sustain-pedal cycle under every bar (lifting just before the next). */
  pedal?: 'bar' | 'none';
  /**
   * Tempo marks after the opening one, as `[beat, bpm]` — the beat is in the
   * same units as the events. Event beats stay musical; only the milliseconds
   * they land on change.
   */
  tempoChanges?: readonly (readonly [beat: number, bpm: number])[];
  events: TrackEvent[];
}

const LIBRARY_TIMESTAMP = '2026-07-18T00:00:00.000Z';
const DEFAULT_VELOCITY = 0.7;
/** Pedal lifts this long before the next bar line so harmonies stay clean. */
const PEDAL_LIFT_MS = 40;

function barPedalEvents(def: LibraryTrackDef, map: TempoMap, durationMs: number): PedalEvent[] {
  const { numerator } = def.timeSignature;
  const bars = Math.ceil(map.beatAtMs(durationMs) / numerator);
  const events: PedalEvent[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const downMs = Math.round(map.msAtBeat(bar * numerator));
    const upMs = Math.min(
      durationMs,
      Math.round(map.msAtBeat((bar + 1) * numerator)) - PEDAL_LIFT_MS,
    );
    if (upMs <= downMs) continue;
    events.push({ atMs: downMs, down: true }, { atMs: upMs, down: false });
  }
  return events;
}

/**
 * Build the canonical `Take` for a library track. Times are rounded to the
 * integer milliseconds the take schema requires; note ids are deterministic
 * so rebuilding the catalog always yields identical content.
 */
export function buildLibraryTake(def: LibraryTrackDef): Take {
  const map = createBeatTempoMap(def.bpm, def.timeSignature, def.tempoChanges);
  const notes: NoteEvent[] = [];

  def.events.forEach((event, index) => {
    const [beat, noteOrChord, durationBeats, velocity, staff] = event;
    const names = Array.isArray(noteOrChord) ? noteOrChord : [noteOrChord];
    // Endpoints, not durations, go through the map: a note held across a tempo
    // change then sounds exactly as long as it is written.
    const startMs = Math.round(map.msAtBeat(beat));
    const durationMs = Math.max(1, Math.round(map.msAtBeat(beat + durationBeats)) - startMs);
    names.forEach((name, chordIndex) => {
      const midi = noteNameToMidi(name);
      if (midi === null) {
        throw new Error(`Library track "${def.trackId}": invalid note "${name}" in event ${index}`);
      }
      notes.push({
        id: `${def.trackId}-n${index}-${chordIndex}`,
        midi,
        startMs,
        durationMs,
        velocity: velocity ?? DEFAULT_VELOCITY,
        // Omitted entirely when unsaid, so tracks that never mention a staff
        // serialize exactly as they did before.
        ...(staff !== undefined ? { staff } : {}),
      });
    });
  });

  const sorted = sortNotes(notes);
  const durationMs = computeTakeDurationMs(sorted);
  const changes = tempoChangesFrom(map);

  return createEmptyTake({
    id: libraryTakeId(def.trackId),
    title: def.title,
    createdAt: LIBRARY_TIMESTAMP,
    updatedAt: LIBRARY_TIMESTAMP,
    durationMs,
    tempo: {
      bpm: def.bpm,
      timeSignature: def.timeSignature,
      countInBars: def.countInBars ?? 1,
      ...(changes.length > 0 ? { changes } : {}),
    },
    notes: sorted,
    pedalEvents: def.pedal === 'bar' ? barPedalEvents(def, map, durationMs) : [],
    display: { quantization: def.quantization ?? '1/16', zoom: 1, playheadMs: 0 },
  });
}

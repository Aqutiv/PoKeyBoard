import { libraryTakeId } from '@/domain/libraryTakes';
import { computeTakeDurationMs, createEmptyTake, sortNotes } from '@/domain/noteEvents';
import type {
  CountInBars,
  NoteEvent,
  PedalEvent,
  QuantizationSetting,
  Take,
  TimeSignature,
} from '@/domain/takeTypes';
import type { Messages } from '@/i18n/types';
import { noteNameToMidi } from '@/utils/midi';
import { barDurationMs, beatDurationMs } from '@/utils/timing';

/**
 * One authored event: `[beat, note(s), durationBeats, velocity?]`.
 * `beat` counts from 0 in units of the time signature's denominator note
 * (quarters in 4/4, eighths in 3/8); fractional beats express sixteenths and
 * swing placement. A string array sounds a chord.
 */
export type TrackEvent = [
  beat: number,
  note: string | string[],
  durationBeats: number,
  velocity?: number,
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
  events: TrackEvent[];
}

const LIBRARY_TIMESTAMP = '2026-07-18T00:00:00.000Z';
const DEFAULT_VELOCITY = 0.7;
/** Pedal lifts this long before the next bar line so harmonies stay clean. */
const PEDAL_LIFT_MS = 40;

function barPedalEvents(def: LibraryTrackDef, durationMs: number): PedalEvent[] {
  const barMs = barDurationMs(def.bpm, def.timeSignature);
  const bars = Math.ceil(durationMs / barMs);
  const events: PedalEvent[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const downMs = Math.round(bar * barMs);
    const upMs = Math.min(durationMs, Math.round((bar + 1) * barMs) - PEDAL_LIFT_MS);
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
  const beatMs = beatDurationMs(def.bpm, def.timeSignature);
  const notes: NoteEvent[] = [];

  def.events.forEach((event, index) => {
    const [beat, noteOrChord, durationBeats, velocity] = event;
    const names = Array.isArray(noteOrChord) ? noteOrChord : [noteOrChord];
    const startMs = Math.round(beat * beatMs);
    const durationMs = Math.max(1, Math.round(durationBeats * beatMs));
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
      });
    });
  });

  const sorted = sortNotes(notes);
  const durationMs = computeTakeDurationMs(sorted);

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
    },
    notes: sorted,
    pedalEvents: def.pedal === 'bar' ? barPedalEvents(def, durationMs) : [],
    display: { quantization: def.quantization ?? '1/16', zoom: 1, playheadMs: 0 },
  });
}

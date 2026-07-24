export const CURRENT_SCHEMA_VERSION = 1;

/** Sample-pack identifier stored in every take so exports stay reproducible. */
export const DEFAULT_SAMPLE_PACK_VERSION = 'salamander-grand-v2';

export const DEFAULT_INSTRUMENT_ID = 'grand-piano';
export const DEFAULT_MASTER_VOLUME = 0.85;
export const DEFAULT_REVERB_MIX = 0.18;

/** Upper bound for any timeline position; guards absurd imports (6 hours). */
export const MAX_TAKE_MS = 6 * 60 * 60 * 1000;
/** Upper bound for a single held note (2 minutes). */
export const MAX_NOTE_DURATION_MS = 2 * 60 * 1000;
export const MAX_NOTE_COUNT = 50_000;
/** Upper bound on a take's tempo map; scores rarely mark more than a few. */
export const MAX_TEMPO_CHANGES = 1_024;

export type QuantizationSetting = 'off' | '1/8' | '1/16';

export type CountInBars = 0 | 1 | 2;

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/**
 * A tempo that takes over partway through a take. Note timing is always
 * absolute milliseconds, so changes never move a note — they tell the notation
 * where bar lines fall and which note values to draw.
 */
export interface TempoChange {
  atMs: number;
  bpm: number;
}

export interface TempoSettings {
  bpm: number;
  timeSignature: TimeSignature;
  countInBars: CountInBars;
  /** Sorted, all `atMs > 0`; absent (or empty) means one tempo throughout. */
  changes?: readonly TempoChange[];
}

export interface InstrumentSettings {
  id: string;
  masterVolume: number;
  reverbMix: number;
}

export interface NoteEvent {
  id: string;
  midi: number;
  startMs: number;
  durationMs: number;
  velocity: number;
}

export interface PedalEvent {
  atMs: number;
  down: boolean;
}

export interface DisplaySettings {
  quantization: QuantizationSetting;
  zoom: number;
  playheadMs: number;
}

/**
 * The canonical take. Parsed takes may physically carry unknown
 * forward-compatible keys at runtime (the schema is a loose object); the
 * static type stays strict so typos are still caught.
 */
export interface Take {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  samplePackVersion: string;
  tempo: TempoSettings;
  instrument: InstrumentSettings;
  notes: NoteEvent[];
  pedalEvents: PedalEvent[];
  display: DisplaySettings;
}

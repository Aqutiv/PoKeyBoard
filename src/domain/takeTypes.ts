export const CURRENT_SCHEMA_VERSION = 1;

/** Sample-pack identifier stored in every take so exports stay reproducible. */
export const DEFAULT_SAMPLE_PACK_VERSION = 'salamander-grand-v3';

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
/** Highest voice number a note may claim; engravings never need more. */
export const MAX_NOTE_VOICE = 15;
/** Furthest a key signature goes round the circle of fifths (C sharp/flat major). */
export const MAX_FIFTHS = 7;

/** Every grid the notation offers, coarsest first; the type follows from it. */
export const QUANTIZATION_SETTINGS = ['off', '1/8', '1/16', '1/32', '1/64'] as const;

export type QuantizationSetting = (typeof QUANTIZATION_SETTINGS)[number];

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
  /**
   * Sharps (positive) or flats (negative) in the key signature, −7..7. Purely
   * notational, like `changes` — it decides how a pitch is spelled and what the
   * system prefix prints, and never moves or retunes a note. Absent means the
   * score never said, and the notation reads a key from the pitches instead.
   */
  keySignature?: number;
}

export interface InstrumentSettings {
  id: string;
  masterVolume: number;
  reverbMix: number;
}

/** The two staffs of the grand staff, in the order they are drawn. */
export type NoteStaff = 'treble' | 'bass';

/**
 * The clef a staff is read under. Named for the staff each one normally
 * carries; either can appear on either staff, which is how a left-hand passage
 * written high stays on the bass staff without a ladder of ledger lines.
 */
export type NoteClef = 'treble' | 'bass';

export interface NoteEvent {
  id: string;
  midi: number;
  startMs: number;
  durationMs: number;
  velocity: number;
  /**
   * The staff the source score wrote this note on. Absent for recorded takes
   * and for sources that say nothing, where the notation falls back to
   * splitting the grand staff at middle C.
   */
  staff?: NoteStaff;
  /**
   * The note's voice within that staff, as numbered by the source (0-based).
   * Notes sharing a voice share a stem; absent means the notation derives
   * voices from the written note values instead.
   */
  voice?: number;
  /**
   * The clef in force where the source drew this note, when it is not the one
   * the staff normally carries. Absent means the staff's own clef, which is
   * what every recorded take and most imports use.
   */
  clef?: NoteClef;
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

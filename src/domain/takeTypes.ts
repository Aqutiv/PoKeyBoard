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
/**
 * The tempos a take may carry.
 *
 * The floor is not a musical opinion, it is the slowest a metronome is worth
 * following. It reaches below the slow end of the repertoire on purpose:
 * Beethoven's Adagio cantabile is marked ♩=31.5, and a take that cannot hold
 * that has to store the music at some other speed — which is how the notation
 * and the sound come to disagree.
 */
export const MIN_TEMPO_BPM = 20;
export const MAX_TEMPO_BPM = 240;
/** Highest voice number a note may claim; engravings never need more. */
export const MAX_NOTE_VOICE = 15;
/** Most notes a tuplet may squeeze in; the widest in the vendored corpus is 39. */
export const MAX_TUPLET_NOTES = 64;
/** Finest note a tuplet may be counted in, as a whole-note divisor (a 128th). */
export const MAX_TUPLET_UNIT = 128;
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

/**
 * The tuplet a source score declared a note to be part of — its
 * `<time-modification>`, kept as written rather than as a conclusion drawn from
 * it.
 *
 * Engraving-only and never audible, like `staff` and `voice`: the note already
 * sounds for as long as it sounds. What this adds is *why* — that the beat it
 * falls in is divided into thirds or sixths rather than halves — which the
 * notation would otherwise have to guess back out of where the onsets landed,
 * and which it guesses wrong often enough to matter.
 *
 * The declaration and not the division it implies: a division is slots per
 * beat, and a take's time signature can be edited after import, which would
 * quietly invalidate it. This says only what note values were written, so the
 * division is re-derived correctly under whatever meter is in force.
 */
export interface NoteTuplet {
  /** `<actual-notes>`: how many notes are squeezed in. */
  actual: number;
  /** `<normal-notes>`: in the time of how many. */
  normal: number;
  /**
   * What those normal notes are, as the number a whole note divides into — 4
   * for a quarter, 8 for an eighth, 16 for a sixteenth. From `<normal-type>`
   * where the score gives one and from the note's own `<type>` where it does
   * not, which is what an omitted `<normal-type>` means.
   */
  unit: number;
  /**
   * Which written `<tuplet>` bracket this note belongs to, numbered in reading
   * order. Beams break where one group ends and the next begins, so a beat of
   * six written as two groups of three is beamed and numbered that way instead
   * of as one six. Absent where the score declared the ratio but bracketed
   * nothing, and the beat's own grouping stands in.
   */
  group?: number;
}

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
  /**
   * The tuplet the source wrote this note inside; see `NoteTuplet`. Absent for
   * recorded takes and for scores that declare none, where the notation reads
   * tuplets from the playing instead.
   */
  tuplet?: NoteTuplet;
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

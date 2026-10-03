import { newId } from '@/utils/ids';
import { createEmptyTake, UNTITLED_TAKE_TITLE } from './noteEvents';
import { normalizeTake } from './takeSchema';
import { tempoChangesFrom, type TempoMap } from './tempoMap';
import {
  MAX_NOTE_DURATION_MS,
  MAX_TAKE_MS,
  MAX_TEMPO_BPM,
  MAX_TEMPO_CHANGES,
  MIN_TEMPO_BPM,
  type Finger,
  type NoteClef,
  type NoteEvent,
  type NoteSpelling,
  type NoteStaff,
  type NoteTuplet,
  type PedalEvent,
  type QuantizationSetting,
  type Take,
  type TimeSignature,
} from './takeTypes';

/**
 * The last step every score import shares: notes already placed in time,
 * turned into a take.
 *
 * Each importer reads its own format and decides what only it can — how its
 * positions become milliseconds, which grid its notation needs — and hands over
 * the result here, in unrounded milliseconds. Everything from there on is the
 * same whatever the file was: how notes are named and rounded, what a take can
 * hold, and what it is called.
 */

/** A note in place, its endpoints still unrounded. */
export interface ImportedNote {
  midi: number;
  startMs: number;
  endMs: number;
  velocity: number;
  /**
   * Where the note began in the source's reading order, across the whole piece.
   * Named in the id, so two notes at one moment keep that order (see below).
   */
  seq: number;
  /** Engraving-only hints; left undefined when the source does not say. */
  staff?: NoteStaff | undefined;
  voice?: number | undefined;
  clef?: NoteClef | undefined;
  tuplet?: NoteTuplet | undefined;
  spelling?: NoteSpelling | undefined;
  finger?: Finger | undefined;
  hidden?: boolean | undefined;
}

export interface ImportedPedal {
  atMs: number;
  down: boolean;
}

/** Everything a source has to say for itself, once its notes are in time. */
export interface ImportedScore {
  notes: readonly ImportedNote[];
  /** One past the highest `seq`, which sets how wide the ids' numbers are. */
  nextSeq: number;
  pedals: readonly ImportedPedal[];
  /** The tempo the take will carry: its first bpm and its changes. */
  tempoMap: TempoMap;
  /** As the source declared it; `importedTimeSignature` settles what is kept. */
  timeSignature: TimeSignature | null;
  keySignature: number | null;
  keyMode: 'major' | 'minor' | null;
  /** The source's own name for the piece, when it has one. */
  title: string | null;
  /** The display grid the importer chose for its notation. */
  quantization: QuantizationSetting;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A file's name without its extension, or null when nothing is left. */
export function fileTitle(fileName: string | undefined): string | null {
  if (!fileName) return null;
  const base = fileName.replace(/\.[^.]*$/, '').trim();
  return base.length > 0 ? base : null;
}

/**
 * The meter a take keeps from a source: the declared one when a take can hold
 * it, otherwise common time. Importers ask before choosing a grid, which
 * depends on it, and the builder asks again.
 */
export function importedTimeSignature(ts: TimeSignature | null): TimeSignature {
  return ts !== null &&
    Number.isInteger(ts.numerator) &&
    ts.numerator >= 1 &&
    ts.numerator <= 16 &&
    (ts.denominator === 2 || ts.denominator === 4 || ts.denominator === 8 || ts.denominator === 16)
    ? ts
    : { numerator: 4, denominator: 4 };
}

/**
 * The take an import produces. `fail` makes the importer's own error for a
 * piece the take cannot hold, so the message names the right kind of file.
 */
export function buildImportedTake(
  score: ImportedScore,
  fileName: string | undefined,
  fail: (issue: string) => Error,
): Take {
  // One random stem per import, and each note's place in reading order (where
  // it began, tied or not): ids as unique as ever, but `normalizeTake` breaks a
  // tie by id, so two copies of one key at one moment — two voices sharing a
  // note — come out in the order the score wrote them, and the notation stems
  // them, gives one the accidental and ties them the same way on every import,
  // not as random ids fall.
  const idStem = newId();
  const idDigits = String(score.nextSeq).length;
  // Rounding endpoints (not durations) keeps adjacent notes seamless.
  const notes: NoteEvent[] = score.notes.map((note) => {
    const startMs = Math.round(note.startMs);
    const endMs = Math.round(note.endMs);
    return {
      id: `${idStem}-${String(note.seq).padStart(idDigits, '0')}`,
      midi: note.midi,
      startMs,
      durationMs: clamp(endMs - startMs, 1, MAX_NOTE_DURATION_MS),
      velocity: note.velocity,
      // Left off entirely when the source is silent about them, so takes from
      // single-staff sources stay byte-identical to what they were before.
      ...(note.staff !== undefined ? { staff: note.staff } : {}),
      ...(note.voice !== undefined ? { voice: note.voice } : {}),
      ...(note.clef !== undefined ? { clef: note.clef } : {}),
      ...(note.tuplet !== undefined ? { tuplet: note.tuplet } : {}),
      ...(note.spelling !== undefined ? { spelling: note.spelling } : {}),
      ...(note.finger !== undefined ? { finger: note.finger } : {}),
      ...(note.hidden ? { hidden: true } : {}),
    };
  });
  let maxEndMs = 0;
  for (const note of notes) maxEndMs = Math.max(maxEndMs, note.startMs + note.durationMs);
  if (maxEndMs > MAX_TAKE_MS) {
    throw fail('The score is longer than the 6-hour take limit.');
  }
  const pedalEvents: PedalEvent[] = score.pedals
    .map((pedal) => ({ atMs: Math.round(pedal.atMs), down: pedal.down }))
    .filter((pedal) => pedal.atMs <= MAX_TAKE_MS);

  const timeSignature = importedTimeSignature(score.timeSignature);

  const title =
    (score.title ?? fileTitle(fileName) ?? UNTITLED_TAKE_TITLE).trim().slice(0, 200) ||
    UNTITLED_TAKE_TITLE;

  const tempoChanges = tempoChangesFrom(score.tempoMap)
    .filter((change) => change.atMs <= MAX_TAKE_MS)
    .slice(0, MAX_TEMPO_CHANGES)
    .map((change) => ({ ...change, bpm: clamp(change.bpm, MIN_TEMPO_BPM, MAX_TEMPO_BPM) }));

  return normalizeTake(
    createEmptyTake({
      title,
      tempo: {
        bpm: clamp(score.tempoMap.baseBpm, MIN_TEMPO_BPM, MAX_TEMPO_BPM),
        timeSignature,
        countInBars: 1,
        ...(tempoChanges.length > 0 ? { changes: tempoChanges } : {}),
        ...(score.keySignature !== null ? { keySignature: score.keySignature } : {}),
        ...(score.keyMode !== null ? { keyMode: score.keyMode } : {}),
      },
      notes,
      pedalEvents,
      display: { quantization: score.quantization, zoom: 1, playheadMs: 0 },
    }),
  );
}

import { z } from 'zod';
import { ImportValidationError } from '@/utils/errors';
import { newId } from '@/utils/ids';
import { migrateRawTake, type RawTakeData } from './takeMigrations';
import { computeTakeDurationMs, sortNotes, sortPedalEvents, UNTITLED_TAKE_TITLE } from './noteEvents';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_INSTRUMENT_ID,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_REVERB_MIX,
  DEFAULT_SAMPLE_PACK_VERSION,
  MAX_NOTE_COUNT,
  MAX_NOTE_DURATION_MS,
  MAX_TAKE_MS,
  type Take,
} from './takeTypes';

const timelineMs = z.number().int().min(0).max(MAX_TAKE_MS);

export const noteEventSchema = z.object({
  id: z.string().min(1).max(128),
  midi: z.number().int().min(0).max(127),
  startMs: timelineMs,
  durationMs: z.number().int().min(1).max(MAX_NOTE_DURATION_MS),
  velocity: z.number().min(0).max(1),
});

export const pedalEventSchema = z.object({
  atMs: timelineMs,
  down: z.boolean(),
});

export const tempoSchema = z.object({
  bpm: z.number().min(40).max(240),
  timeSignature: z.object({
    numerator: z.number().int().min(1).max(16),
    denominator: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
  }),
  countInBars: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

export const instrumentSchema = z.object({
  id: z.string().min(1).max(64),
  masterVolume: z.number().min(0).max(1),
  reverbMix: z.number().min(0).max(1),
});

export const displaySchema = z.object({
  quantization: z.enum(['off', '1/8', '1/16']),
  zoom: z.number().min(0.25).max(4),
  playheadMs: timelineMs,
});

/**
 * Loose object: unknown forward-compatible top-level keys survive parsing so
 * exports from newer minor versions round-trip without data loss.
 */
export const takeSchema = z.looseObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  durationMs: timelineMs,
  samplePackVersion: z.string().min(1).max(64),
  tempo: tempoSchema,
  instrument: instrumentSchema,
  notes: z.array(noteEventSchema).max(MAX_NOTE_COUNT),
  pedalEvents: z.array(pedalEventSchema).max(MAX_NOTE_COUNT),
  display: displaySchema,
});

const EPSILON = 1e-6;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundMs(value: unknown): number | undefined {
  return isFiniteNumber(value) ? Math.round(value) : undefined;
}

function clampWithinEpsilon(value: number, min: number, max: number): number {
  if (value < min && value >= min - EPSILON) return min;
  if (value > max && value <= max + EPSILON) return max;
  return value;
}

/**
 * Repair only clearly recoverable problems before validation: rounding
 * fractional milliseconds, filling defaulted containers, generating missing
 * ids, and clamping float-precision drift. Anything genuinely invalid is left
 * for the schema to reject with a useful message.
 */
export function repairRawTake(input: RawTakeData): { data: RawTakeData; repairs: string[] } {
  const repairs: string[] = [];
  const data: RawTakeData = { ...input };

  if (typeof data.id !== 'string' || data.id.length === 0) {
    data.id = newId();
    repairs.push('Assigned a new take id.');
  }
  if (typeof data.title !== 'string' || data.title.trim().length === 0) {
    data.title = UNTITLED_TAKE_TITLE;
    repairs.push('Defaulted a missing title.');
  }
  for (const field of ['createdAt', 'updatedAt'] as const) {
    const value = data[field];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      data[field] = new Date().toISOString();
      repairs.push(`Defaulted an invalid ${field} timestamp.`);
    }
  }
  if (typeof data.samplePackVersion !== 'string' || data.samplePackVersion.length === 0) {
    data.samplePackVersion = DEFAULT_SAMPLE_PACK_VERSION;
    repairs.push('Defaulted the sample-pack version.');
  }

  if (data.tempo === undefined) {
    data.tempo = { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 1 };
    repairs.push('Defaulted missing tempo settings.');
  } else if (typeof data.tempo === 'object' && data.tempo !== null) {
    const tempo = { ...(data.tempo as RawTakeData) };
    if (isFiniteNumber(tempo.bpm) && (tempo.bpm < 40 || tempo.bpm > 240)) {
      tempo.bpm = Math.min(240, Math.max(40, tempo.bpm));
      repairs.push('Clamped BPM into the 40–240 range.');
    }
    if (
      isFiniteNumber(tempo.countInBars) &&
      Number.isInteger(tempo.countInBars) &&
      (tempo.countInBars < 0 || tempo.countInBars > 2)
    ) {
      tempo.countInBars = Math.min(2, Math.max(0, tempo.countInBars));
      repairs.push('Clamped count-in length.');
    }
    data.tempo = tempo;
  }

  if (data.instrument === undefined) {
    data.instrument = {
      id: DEFAULT_INSTRUMENT_ID,
      masterVolume: DEFAULT_MASTER_VOLUME,
      reverbMix: DEFAULT_REVERB_MIX,
    };
    repairs.push('Defaulted missing instrument settings.');
  } else if (typeof data.instrument === 'object' && data.instrument !== null) {
    const instrument = { ...(data.instrument as RawTakeData) };
    for (const field of ['masterVolume', 'reverbMix'] as const) {
      const value = instrument[field];
      if (isFiniteNumber(value)) instrument[field] = clampWithinEpsilon(value, 0, 1);
    }
    data.instrument = instrument;
  }

  if (data.pedalEvents === undefined) {
    data.pedalEvents = [];
  } else if (Array.isArray(data.pedalEvents)) {
    data.pedalEvents = data.pedalEvents.map((entry) => {
      if (typeof entry !== 'object' || entry === null) return entry;
      const pedal = { ...(entry as RawTakeData) };
      const rounded = roundMs(pedal.atMs);
      if (rounded !== undefined && rounded !== pedal.atMs) {
        pedal.atMs = rounded;
      }
      return pedal;
    });
  }

  if (Array.isArray(data.notes)) {
    let roundedAny = false;
    let assignedIds = 0;
    data.notes = data.notes.map((entry) => {
      if (typeof entry !== 'object' || entry === null) return entry;
      const note = { ...(entry as RawTakeData) };
      for (const field of ['startMs', 'durationMs'] as const) {
        const rounded = roundMs(note[field]);
        if (rounded !== undefined && rounded !== note[field]) {
          note[field] = rounded;
          roundedAny = true;
        }
      }
      if (isFiniteNumber(note.durationMs) && note.durationMs === 0) {
        note.durationMs = 1;
        roundedAny = true;
      }
      if (isFiniteNumber(note.velocity)) {
        note.velocity = clampWithinEpsilon(note.velocity, 0, 1);
      }
      if (typeof note.id !== 'string' || note.id.length === 0) {
        note.id = newId();
        assignedIds += 1;
      }
      return note;
    });
    if (roundedAny) repairs.push('Rounded fractional note timing to whole milliseconds.');
    if (assignedIds > 0) repairs.push(`Assigned ids to ${assignedIds} note(s).`);
  }

  if (data.display === undefined || typeof data.display !== 'object' || data.display === null) {
    data.display = { quantization: '1/16', zoom: 1, playheadMs: 0 };
    if (input.display !== undefined) repairs.push('Reset invalid display settings.');
  } else {
    const display = { ...(data.display as RawTakeData) };
    if (!['off', '1/8', '1/16'].includes(display.quantization as string)) {
      display.quantization = '1/16';
    }
    if (!isFiniteNumber(display.zoom)) display.zoom = 1;
    else display.zoom = Math.min(4, Math.max(0.25, display.zoom));
    const playhead = roundMs(display.playheadMs);
    display.playheadMs = playhead !== undefined && playhead >= 0 ? playhead : 0;
    data.display = display;
  }

  const roundedDuration = roundMs(data.durationMs);
  if (roundedDuration === undefined || roundedDuration < 0) {
    data.durationMs = 0; // normalizeTake recomputes from the notes below
  } else if (roundedDuration !== data.durationMs) {
    data.durationMs = roundedDuration;
  }

  return { data, repairs };
}

/** Sorted notes/pedals, recomputed duration, playhead clamped into range. */
export function normalizeTake(take: Take): Take {
  const notes = sortNotes(take.notes);
  const durationMs = computeTakeDurationMs(notes);
  return {
    ...take,
    notes,
    pedalEvents: sortPedalEvents(take.pedalEvents),
    durationMs,
    display: {
      ...take.display,
      playheadMs: Math.min(take.display.playheadMs, durationMs),
    },
  };
}

function formatZodIssues(error: z.ZodError): string[] {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'take';
    return `${path}: ${issue.message}`;
  });
  const MAX_ISSUES = 20;
  if (issues.length > MAX_ISSUES) {
    const extra = issues.length - MAX_ISSUES;
    return [...issues.slice(0, MAX_ISSUES), `…and ${extra} more problem(s).`];
  }
  return issues;
}

export interface ParsedTake {
  take: Take;
  repairs: string[];
}

/**
 * Full import pipeline: migrate → repair → validate → normalize.
 * Throws ImportValidationError with human-readable issues on failure.
 */
export function parseTakeJson(raw: unknown): ParsedTake {
  const migrated = migrateRawTake(raw);
  const { data, repairs } = repairRawTake(migrated);
  const result = takeSchema.safeParse(data);
  if (!result.success) {
    throw new ImportValidationError(formatZodIssues(result.error));
  }
  const take = normalizeTake(result.data as unknown as Take);
  return { take, repairs };
}

/** Parse a JSON string (e.g. file contents) into a validated take. */
export function parseTakeJsonString(text: string): ParsedTake {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportValidationError(['The file is not valid JSON.']);
  }
  return parseTakeJson(raw);
}

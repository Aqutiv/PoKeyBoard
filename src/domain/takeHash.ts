import type { NoteEvent, Take } from './takeTypes';

/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in order.
 * Only JSON-safe values are expected (the inputs are schema-validated).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => `${JSON.stringify(key)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface CanonicalNote {
  midi: number;
  startMs: number;
  durationMs: number;
  velocity: number;
}

function canonicalNotes(notes: readonly NoteEvent[]): CanonicalNote[] {
  return notes
    .map(({ midi, startMs, durationMs, velocity }) => ({ midi, startMs, durationMs, velocity }))
    .sort(
      (a, b) =>
        a.startMs - b.startMs ||
        a.midi - b.midi ||
        a.durationMs - b.durationMs ||
        a.velocity - b.velocity,
    );
}

/**
 * The audible content of a take: everything that changes the rendered audio,
 * nothing that does not (title, timestamps, display state, note ids).
 */
export function canonicalAudioContent(take: Take): Record<string, unknown> {
  return {
    samplePackVersion: take.samplePackVersion,
    tempo: {
      bpm: take.tempo.bpm,
      timeSignature: take.tempo.timeSignature,
    },
    instrument: {
      id: take.instrument.id,
      masterVolume: take.instrument.masterVolume,
      reverbMix: take.instrument.reverbMix,
    },
    notes: canonicalNotes(take.notes),
    pedalEvents: [...take.pedalEvents].sort(
      (a, b) => a.atMs - b.atMs || Number(a.down) - Number(b.down),
    ),
  };
}

export interface ExportHashInput {
  take: Take;
  exporterVersion: number;
  bitrateKbps: number;
  includeMetronome: boolean;
  metronomeVolume: number;
}

/**
 * Deterministic cache key for a rendered export. Reuse a cached MP3 only
 * while this hash matches; any relevant edit changes it.
 */
export async function computeExportHash(input: ExportHashInput): Promise<string> {
  return sha256Hex(
    stableStringify({
      exporterVersion: input.exporterVersion,
      bitrateKbps: input.bitrateKbps,
      includeMetronome: input.includeMetronome,
      metronomeVolume: input.includeMetronome ? input.metronomeVolume : null,
      content: canonicalAudioContent(input.take),
    }),
  );
}

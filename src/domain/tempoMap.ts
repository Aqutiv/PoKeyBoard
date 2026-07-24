import { barDurationMs, beatDurationMs } from '@/utils/timing';
import type { TempoChange, TempoSettings, TimeSignature } from './takeTypes';

/**
 * Piecewise-constant tempo, shared by every part of the app that has to relate
 * musical positions to milliseconds: the MusicXML importer, the library track
 * builder, and both score renderers.
 *
 * A take's note timing is always absolute milliseconds — the tempo map never
 * moves a note. It exists so the *notation* can find bar lines and note values
 * when the tempo moves partway through a piece.
 */
export interface TempoSegment {
  /** Beat position (time-signature beats) where this tempo takes over. */
  startBeat: number;
  startMs: number;
  bpm: number;
  /** Duration of one beat under this tempo. */
  beatMs: number;
}

export interface MeasureSpan {
  index: number;
  startMs: number;
  endMs: number;
  /** The tempo in force at the measure's start. */
  bpm: number;
}

export interface TempoMap {
  readonly segments: readonly TempoSegment[];
  /** The first segment's tempo — a take's nominal `tempo.bpm`. */
  readonly baseBpm: number;
  bpmAt(ms: number): number;
  msAtBeat(beat: number): number;
  beatAtMs(ms: number): number;
  /**
   * Whole measures covering `[0, uptoMs]`, at least `minMeasures` of them.
   * Boundaries are walked in beat space, so a tempo change inside a bar still
   * yields a correctly sized bar.
   */
  measureSpans(uptoMs: number, minMeasures: number): MeasureSpan[];
}

/** Positions within this distance count as the same one (float tolerance). */
const EPSILON = 1e-6;

/**
 * Measure boundaries are reported as whole milliseconds while a change may sit
 * on a fraction, so a bar line and the change that lands on it can round to
 * either side of each other. Half a millisecond is below anything audible and
 * settles it.
 */
const BOUNDARY_TOLERANCE_MS = 0.5;

const QUARTER_TIME: TimeSignature = { numerator: 4, denominator: 4 };

/** Tempo when a score or take names none. */
export const FALLBACK_BPM = 120;

function segment(startBeat: number, startMs: number, bpm: number, beatMs: number): TempoSegment {
  return { startBeat, startMs, bpm, beatMs };
}

function isUsableBpm(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm > 0;
}

/** The last segment starting at or before `value`, keyed by ms or beat. */
function segmentAt(
  segments: readonly TempoSegment[],
  value: number,
  key: 'startMs' | 'startBeat',
): TempoSegment {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((segments[mid] as TempoSegment)[key] <= value) low = mid;
    else high = mid - 1;
  }
  return segments[low] as TempoSegment;
}

function fromSegments(segments: readonly TempoSegment[], timeSignature: TimeSignature): TempoMap {
  const first = segments[0] as TempoSegment;
  const bpmAt = (ms: number): number => segmentAt(segments, Math.max(0, ms), 'startMs').bpm;

  const msAtBeat = (beat: number): number => {
    const target = Math.max(0, beat);
    const found = segmentAt(segments, target, 'startBeat');
    return found.startMs + (target - found.startBeat) * found.beatMs;
  };

  const beatAtMs = (ms: number): number => {
    const target = Math.max(0, ms);
    const found = segmentAt(segments, target, 'startMs');
    return found.startBeat + (target - found.startMs) / found.beatMs;
  };

  return {
    segments,
    baseBpm: first.bpm,
    bpmAt,
    msAtBeat,
    beatAtMs,
    measureSpans: (uptoMs, minMeasures) => {
      const { numerator } = timeSignature;
      // `+1` mirrors the constant-tempo rule this replaced: a piece ending
      // exactly on a bar line still gets an empty measure after it.
      const beats = beatAtMs(Math.max(0, uptoMs) + 1);
      const count = Math.max(minMeasures, Math.ceil(beats / numerator));
      const spans: MeasureSpan[] = [];
      let startMs = Math.round(msAtBeat(0));
      for (let index = 0; index < count; index += 1) {
        const endMs = Math.round(msAtBeat((index + 1) * numerator));
        spans.push({
          index,
          startMs,
          endMs,
          // Looked up in the millisecond domain, and half a millisecond in, so
          // that a change landing on this bar line counts as inside the bar
          // however the two sides rounded.
          bpm: bpmAt(startMs + BOUNDARY_TOLERANCE_MS),
        });
        startMs = endMs;
      }
      return spans;
    },
  };
}

/**
 * A map whose tempo changes are given in beats — the authoring domain, used by
 * the library track builder and the MusicXML importer (quarter-note domain,
 * via `createQuarterTempoMap`).
 */
export function createBeatTempoMap(
  baseBpm: number,
  timeSignature: TimeSignature,
  changes: readonly (readonly [beat: number, bpm: number])[] = [],
): TempoMap {
  const beatMsOf = (bpm: number): number => beatDurationMs(bpm, timeSignature);
  const base = isUsableBpm(baseBpm) ? baseBpm : FALLBACK_BPM;
  const segments: TempoSegment[] = [segment(0, 0, base, beatMsOf(base))];

  const sorted = changes
    .filter(([beat, bpm]) => Number.isFinite(beat) && beat > 0 && isUsableBpm(bpm))
    .slice()
    .sort((a, b) => a[0] - b[0]);

  for (const [beat, bpm] of sorted) {
    const previous = segments[segments.length - 1] as TempoSegment;
    if (beat - previous.startBeat < EPSILON) {
      // Two marks at one position: the later one wins.
      previous.bpm = bpm;
      previous.beatMs = beatMsOf(bpm);
      continue;
    }
    segments.push(
      segment(
        beat,
        previous.startMs + (beat - previous.startBeat) * previous.beatMs,
        bpm,
        beatMsOf(bpm),
      ),
    );
  }
  return fromSegments(segments, timeSignature);
}

/**
 * The quarter-note flavour the MusicXML importer works in: `<sound tempo>` and
 * metronome marks are collected at quarter-note positions, and a mark after the
 * start also governs everything before it (scores rarely restate the opening
 * tempo).
 */
export function createQuarterTempoMap(entries: readonly { atQ: number; bpm: number }[]): TempoMap {
  const sorted = entries
    .filter((entry) => isUsableBpm(entry.bpm) && Number.isFinite(entry.atQ) && entry.atQ >= 0)
    .slice()
    .sort((a, b) => a.atQ - b.atQ);
  const first = sorted[0];
  return createBeatTempoMap(
    first?.bpm ?? FALLBACK_BPM,
    QUARTER_TIME,
    sorted.map((entry) => [entry.atQ, entry.bpm] as const),
  );
}

/** Everything a tempo map needs from a take (or from layout options). */
export type TempoMapInput = Pick<TempoSettings, 'bpm' | 'timeSignature' | 'changes'>;

/** A take's tempo map: the nominal bpm plus its millisecond-positioned changes. */
export function createTakeTempoMap(tempo: TempoMapInput): TempoMap {
  const beatMsOf = (bpm: number): number => beatDurationMs(bpm, tempo.timeSignature);
  const base = isUsableBpm(tempo.bpm) ? tempo.bpm : FALLBACK_BPM;
  const segments: TempoSegment[] = [segment(0, 0, base, beatMsOf(base))];

  const sorted = (tempo.changes ?? [])
    .filter((change) => Number.isFinite(change.atMs) && change.atMs > 0 && isUsableBpm(change.bpm))
    .slice()
    .sort((a, b) => a.atMs - b.atMs);

  for (const change of sorted) {
    const previous = segments[segments.length - 1] as TempoSegment;
    if (change.atMs - previous.startMs < EPSILON) {
      previous.bpm = change.bpm;
      previous.beatMs = beatMsOf(change.bpm);
      continue;
    }
    segments.push(
      segment(
        previous.startBeat + (change.atMs - previous.startMs) / previous.beatMs,
        change.atMs,
        change.bpm,
        beatMsOf(change.bpm),
      ),
    );
  }
  return fromSegments(segments, tempo.timeSignature);
}

/**
 * The bar line closest to `ms`. A tempo change belongs on one: the new tempo
 * then starts a bar, as it does in printed music, and the next recorded part
 * begins on a downbeat.
 */
export function barLineNearMs(map: TempoMap, timeSignature: TimeSignature, ms: number): number {
  const { numerator } = timeSignature;
  const bar = Math.max(0, Math.round(map.beatAtMs(ms) / numerator));
  return Math.round(map.msAtBeat(bar * numerator));
}

/** How long a count-in lasts when it precedes `atMs`, at the tempo in force there. */
export function countInMsAt(
  map: TempoMap,
  timeSignature: TimeSignature,
  countInBars: number,
  atMs: number,
): number {
  return barDurationMs(map.bpmAt(atMs), timeSignature) * countInBars;
}

/**
 * The take's tempo with `bpm` in force from `atMs` onward: the base tempo when
 * that is the start, otherwise a change there. A tempo that already matches
 * what is in force just before `atMs` removes the mark instead of adding a
 * redundant one, so setting a value back undoes it.
 */
export function withTempoAt(tempo: TempoSettings, atMs: number, bpm: number): TempoSettings {
  const at = Math.round(atMs);
  const others = (tempo.changes ?? []).filter((change) => change.atMs !== at);
  if (at <= 0) {
    return { ...tempo, bpm, changes: others.length > 0 ? others : undefined };
  }
  // What the tempo would be here without a mark of its own.
  const inherited = createTakeTempoMap({ ...tempo, changes: others }).bpmAt(at - 1);
  const changes =
    bpm === inherited ? others : [...others, { atMs: at, bpm }].sort((a, b) => a.atMs - b.atMs);
  return { ...tempo, changes: changes.length > 0 ? changes : undefined };
}

/** Tempo changes as a take stores them: millisecond positions, first one dropped. */
export function tempoChangesFrom(map: TempoMap): TempoChange[] {
  return map.segments
    .slice(1)
    .map((entry) => ({ atMs: Math.round(entry.startMs), bpm: entry.bpm }))
    .filter((change) => change.atMs > 0);
}

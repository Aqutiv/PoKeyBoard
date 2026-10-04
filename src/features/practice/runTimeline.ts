import { CHORD_WINDOW_MS, type AskedNote } from '@/domain/trainingGate';
import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';

/**
 * Where a Keep-time run is at any moment of the audio clock, and when it
 * reaches any note it asks for. Pure.
 *
 * Read from what the run told its listeners — where and when it set off, and
 * each change of speed since — rather than from the transport's clock: the
 * clock starts its unwrapped timeline again from the playhead at every change
 * of speed (`TransportController.retimeRun`), so it can no longer say when a
 * note before the change fell due, and the run's last notes are judged after
 * it has stopped.
 */

/**
 * A stretch of a run at one speed. From `audioTime` on, the run moves on from
 * `runMs` at `rate`, until the next stretch takes over.
 */
export interface TimelineSegment {
  /** When the stretch begins, on the audio clock, in seconds. */
  audioTime: number;
  /**
   * Where the run is then, on its unwrapped timeline: take time until it first
   * reaches a loop's end, and a loop's length further on for every pass after,
   * as the transport's virtual time runs (`TransportClock`).
   */
  runMs: number;
  /** Take milliseconds per real millisecond: 0.5 plays at half speed. */
  rate: number;
}

/** A note a Keep-time run asks the player for, at one moment of the run. */
export interface DueNote {
  /** The asked note's id: the first of a unison, which asks for one key. */
  id: string;
  midi: number;
  /** Where it is in the take. */
  atMs: number;
  /** Where it is on the run's unwrapped timeline; see `TimelineSegment.runMs`. */
  runMs: number;
  /** Which time round a loop: 0 from where the run started, as it always is without one. */
  pass: number;
}

/**
 * The run's timeline: from its start, `run.fromMs` reached at its anchor (past
 * any count-in) at its first speed; then, at each change of speed told with
 * its moment, a stretch at the new speed from wherever the run had got to.
 * A change told without a moment comes from a run waiting at a hold, which a
 * run keeping time never does.
 */
export function runTimeline(
  run: PracticeRun,
  events: readonly PracticeEvent[] = [],
): TimelineSegment[] {
  const segments: TimelineSegment[] = [
    { audioTime: run.anchorAudioTime, runMs: run.fromMs, rate: run.speed },
  ];
  for (const event of events) {
    if (event.runId !== run.runId || event.type !== 'speed' || event.audioTime === null) continue;
    // In the order they happened. A change before the run set off would start
    // it again (`restart`), so none comes before the anchor.
    const audioTime = Math.max(event.audioTime, (segments.at(-1) as TimelineSegment).audioTime);
    segments.push({ audioTime, runMs: runMsAt(segments, audioTime), rate: event.speed });
  }
  return segments;
}

/**
 * Where the run is at `audioTime`. Before its anchor, it is short of where it
 * started: a count-in, the run's own beat ahead of its first note.
 */
export function runMsAt(segments: readonly TimelineSegment[], audioTime: number): number {
  const segment = lastWhere(segments, (each) => each.audioTime <= audioTime);
  return segment.runMs + (audioTime - segment.audioTime) * 1000 * segment.rate;
}

/** When the run reaches `runMs`, on the audio clock, at the speed it has from there. */
export function audioTimeAt(segments: readonly TimelineSegment[], runMs: number): number {
  const segment = lastWhere(segments, (each) => each.runMs <= runMs);
  return segment.audioTime + (runMs - segment.runMs) / 1000 / segment.rate;
}

/** The last segment `test` holds for, or the first, which reaches back before the run. */
function lastWhere(
  segments: readonly TimelineSegment[],
  test: (segment: TimelineSegment) => boolean,
): TimelineSegment {
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const segment = segments[index] as TimelineSegment;
    if (test(segment)) return segment;
  }
  return segments[0] as TimelineSegment;
}

/**
 * The notes the run has asked for by the time it reaches `untilRunMs`, in the
 * order they fall due, pass by pass. The first pass asks for what the take
 * asks from where the run started, up to a loop's end where there is one, the
 * way playback plays it; every pass after asks for the loop's notes again,
 * its length further on each time. A loop goes round for ever, so a run round
 * one needs a finite `untilRunMs`.
 *
 * A key is asked for once however many voices strike it at a moment, or a
 * chord's width apart (`CHORD_WINDOW_MS`): a unison in two voices is one key
 * to play, and a hand cannot strike a key twice in that time.
 */
export function dueNotes(run: PracticeRun, untilRunMs: number): DueNote[] {
  const { fromMs, loop } = run;
  const notes: DueNote[] = [];
  const due = (note: AskedNote, pass: number, runMs: number) =>
    notes.push({ id: note.id, midi: note.midi, atMs: note.startMs, runMs, pass });

  const firstEndMs = loop ? loop.endMs : Number.POSITIVE_INFINITY;
  for (const note of run.asked) {
    if (note.startMs >= fromMs && note.startMs < firstEndMs && note.startMs <= untilRunMs) {
      due(note, 0, note.startMs);
    }
  }
  if (loop) {
    const lengthMs = loop.endMs - loop.startMs;
    const inLoop = run.asked.filter(
      (note) => note.startMs >= loop.startMs && note.startMs < loop.endMs,
    );
    if (inLoop.length > 0 && lengthMs > 0) {
      if (!Number.isFinite(untilRunMs)) {
        throw new RangeError('A loop asks for its notes for ever: say how far to list them.');
      }
      const lastPass = Math.floor((untilRunMs - loop.startMs) / lengthMs);
      for (let pass = 1; pass <= lastPass; pass += 1) {
        for (const note of inLoop) {
          const runMs = note.startMs + pass * lengthMs;
          if (runMs <= untilRunMs) due(note, pass, runMs);
        }
      }
    }
  }
  // In the order they fall due. The sort is stable, so a chord keeps the order
  // the run asked for its notes in, and a unison keeps its first.
  notes.sort((a, b) => a.runMs - b.runMs);
  return oneStrikeEach(notes);
}

/** Drop each strike within a chord's width of the last one kept on its key. */
function oneStrikeEach(notes: readonly DueNote[]): DueNote[] {
  const lastOnKey = new Map<number, number>();
  return notes.filter((note) => {
    const last = lastOnKey.get(note.midi);
    if (last !== undefined && note.runMs - last <= CHORD_WINDOW_MS) return false;
    lastOnKey.set(note.midi, note.runMs);
    return true;
  });
}

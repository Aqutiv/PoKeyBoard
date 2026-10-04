import type { InputNoteEvent } from '@/audio/AudioEngine';
import type { PracticeEvent, PracticeRun, RunEndReason } from '@/features/transport/practiceEvents';
import {
  MATCH_MS,
  scorePlayAlong,
  withinReach,
  type JudgedNote,
  type PlayAlongScore,
  type Press,
} from './playAlongScorer';
import { passCells, resultCells, type ResultCell } from './resultCells';
import { audioTimeAt, dueNotes, runMsAt, runTimeline, type DueNote } from './runTimeline';

/**
 * How long a run played to its end listens on, past the latency, for its last
 * notes played late: a note's window reaches 200 ms past it, and the end is
 * noticed on a scheduler tick, which can come a little after the music stops.
 */
export const END_GRACE_MS = 230;

/** How a Keep-time run went: the score less its notes, the slowest speed, and the cells. */
export interface KeepTimeReport extends Omit<PlayAlongScore, 'outcomes'> {
  /** The slowest the run went: the speed it started at, or one it was turned down to. */
  slowestSpeed: number;
  cells: ResultCell[];
}

/** What a Keep-time run needs of the engine and the transport; injected, for the tests. */
export interface PlayAlongDeps {
  /** Hears every key played, by any hand on any input: `audioEngine.subscribeInput`. */
  subscribeInput(listener: (event: InputNoteEvent) => void): () => void;
  /** How late the sound reaches the player, in ms: `audioEngine.getOutputLatencyMs`. */
  outputLatencyMs(): number;
  /** The audio clock, in seconds. */
  audioTime(): number;
  /** The page's clock, in ms: `performance.now`. */
  now(): number;
  /** Flash a key the run never asked for there: `transportController.flashWrongKey`. */
  flashWrongKey(midi: number): void;
}

/** How a run ended, as its `run-end` says. */
export interface RunEnd {
  reason: RunEndReason;
  audioTime: number | null;
}

/** A Keep-time run being listened to; see `startPlayAlongRun`. */
export interface PlayAlongRun {
  /**
   * The moment on the page's clock (`performance.now`) a press lands exactly
   * on the run's start: its anchor, plus the latency a press is heard through.
   * A press `ms` later, at the take's speed, lands `ms` into the run.
   */
  readonly pressOriginMs: number;
  /** Take in what the run says while it lasts: its changes of speed. */
  hear(event: PracticeEvent): void;
  /**
   * The run has ended. Judge it and hand `done` its report: at once, or for a
   * run played to its end, once its last notes have had time to be played late.
   */
  end(end: RunEnd, done: (report: KeepTimeReport) => void): void;
  /** Stop listening, with nothing to report. */
  cancel(): void;
}

/**
 * Listen to a Keep-time run as it plays: every key pressed, from the moment it
 * starts, and its changes of speed. Each press is placed at the moment of the
 * music the player heard as they pressed it, the output's latency taken off,
 * so a player in time with what they hear is in time, Bluetooth and all; the
 * latency is read once, as the run starts, and held for the whole of it.
 *
 * Nothing is asked for while the run counts in, so a press before it sets
 * off counts for nothing unless it plays a first note early, and nor does one
 * before the first note's window. A press with no note of its key within
 * reach, as the run has placed them, flashes on the keys as it is played.
 */
export function startPlayAlongRun(run: PracticeRun, deps: PlayAlongDeps): PlayAlongRun {
  /** How late the music reaches the player, in seconds. */
  const latency = Math.max(0, deps.outputLatencyMs()) / 1000;
  const events: PracticeEvent[] = [];
  const presses: Press[] = [];
  let timeline = runTimeline(run);
  /** When the music stopped, once the run has ended. */
  let endAudioTime: number | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether a note of `midi` among `due` is within reach of a press at `audioTime`. */
  const askedNear = (due: readonly DueNote[], midi: number, audioTime: number): boolean => {
    // From the latest back, until the notes are out of reach before it.
    for (let index = due.length - 1; index >= 0; index -= 1) {
      const note = due[index] as DueNote;
      const dueAudioTime = audioTimeAt(timeline, note.runMs);
      if (note.midi === midi && withinReach(audioTime, dueAudioTime)) return true;
      if (dueAudioTime < audioTime - MATCH_MS / 1000) return false;
    }
    return false;
  };

  const onInput = (event: InputNoteEvent): void => {
    if (event.type !== 'on') return;
    const audioTime = event.audioTime - latency;
    // Once the music has stopped, a press is a late one for its last notes or
    // nothing at all; the scorer tells which, and nothing flashes.
    if (endAudioTime !== null) {
      presses.push({ midi: event.midi, audioTime });
      return;
    }
    const due = dueNotes(run, runMsAt(timeline, audioTime + MATCH_MS / 1000));
    const near = askedNear(due, event.midi, audioTime);
    // Counting in, nothing is asked for yet, though a first note due as the
    // run sets off opens its window in the count-in's last moments: a press
    // then plays it early, or is nothing at all, never kept and never flashed.
    if (audioTime < run.anchorAudioTime && !near) return;
    if (due.length === 0) return;
    presses.push({ midi: event.midi, audioTime });
    if (!near) deps.flashWrongKey(event.midi);
  };

  let unsubscribe: (() => void) | null = deps.subscribeInput(onInput);
  const stopListening = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    if (graceTimer !== null) clearTimeout(graceTimer);
    graceTimer = null;
  };

  return {
    pressOriginMs: deps.now() + (run.anchorAudioTime + latency - deps.audioTime()) * 1000,
    hear(event) {
      if (endAudioTime !== null || event.runId !== run.runId || event.type !== 'speed') return;
      events.push(event);
      timeline = runTimeline(run, events);
    },
    end({ reason, audioTime }, done) {
      if (endAudioTime !== null || unsubscribe === null) return;
      const endedAt = audioTime ?? deps.audioTime();
      endAudioTime = endedAt;
      const finish = (heardUntil: number): void => {
        stopListening();
        done(reducePlayAlongRun(run, events, presses, { endAudioTime: endedAt, heardUntil }));
      };
      if (reason === 'end') {
        // The take played out, every note in it fallen due: listen on for the
        // last ones played late, as long as their windows and the latency take.
        // Every window has closed by then, so none is left out.
        graceTimer = setTimeout(
          () => finish(Number.POSITIVE_INFINITY),
          END_GRACE_MS + latency * 1000,
        );
      } else {
        // Stopped short: a press heard reached the music the latency before.
        finish(endedAt - latency);
      }
    },
    cancel: stopListening,
  };
}

/**
 * Read a Keep-time run into its report: its notes up to where it ended, each
 * placed on the audio clock by the run's timeline, judged by `presses` (on
 * the music's clock, latency taken off); see `scorePlayAlong` for
 * `endAudioTime` and `heardUntil`. The music sets off at the run's anchor, so
 * a press before it is never a wrong note. Pure.
 *
 * A run through the take is told in sections of four bars, a run round a loop
 * pass by pass, by each part's share of notes on time.
 */
export function reducePlayAlongRun(
  run: PracticeRun,
  events: readonly PracticeEvent[],
  presses: readonly Press[],
  { endAudioTime, heardUntil }: { endAudioTime: number; heardUntil: number },
): KeepTimeReport {
  const timeline = runTimeline(run, events);
  // Every note whose window had opened when the music stopped.
  const due = dueNotes(run, runMsAt(timeline, endAudioTime + MATCH_MS / 1000)).map((note) => ({
    ...note,
    dueAudioTime: audioTimeAt(timeline, note.runMs),
  }));
  const { outcomes, ...score } = scorePlayAlong(due, presses, {
    startAudioTime: run.anchorAudioTime,
    endAudioTime,
    heardUntil,
  });
  let slowestSpeed = run.speed;
  for (const event of events) {
    if (event.runId === run.runId && event.type === 'speed') {
      slowestSpeed = Math.min(slowestSpeed, event.speed);
    }
  }
  return {
    ...score,
    slowestSpeed,
    cells: run.loop
      ? passCells(byPass(outcomes))
      : resultCells(outcomes, {
          tempo: run.tempo,
          takeDurationMs: run.takeDurationMs,
          looping: false,
        }),
  };
}

/**
 * The notes judged, pass by pass, leaving out any pass with none: one the run
 * started too late in to ask for anything, or ended before it asked.
 */
function byPass(outcomes: readonly JudgedNote[]): JudgedNote[][] {
  const passes = new Map<number, JudgedNote[]>();
  for (const outcome of outcomes) {
    const pass = passes.get(outcome.pass) ?? [];
    pass.push(outcome);
    passes.set(outcome.pass, pass);
  }
  return [...passes].sort(([a], [b]) => a - b).map(([, notes]) => notes);
}

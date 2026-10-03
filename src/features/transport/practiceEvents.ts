import type { PlaybackLoop, TempoSettings } from '@/domain/takeTypes';
import type { AskedNote, TrainingHand } from '@/domain/trainingGate';
import type { PracticeStyle } from './modes';

/**
 * Why a practice run ended:
 *
 * - `end`: playback reached the end of the take;
 * - `pause`: the player paused;
 * - `stop`: the player stopped, or the run's holds were dropped some way no
 *   other reason names;
 * - `seek`: the playhead was moved, by a seek or a scrub;
 * - `loop`: a loop was set, changed or cleared;
 * - `mode`: another hand was chosen, or none;
 * - `navigation`: the player went to another page;
 * - `interrupted`: the page was hidden, or another take took this one's place;
 * - `record`: recording began;
 * - `failed`: the transport failed;
 * - `restart`: the run was started over from its beginning.
 */
export type RunEndReason =
  | 'end'
  | 'pause'
  | 'stop'
  | 'seek'
  | 'loop'
  | 'mode'
  | 'navigation'
  | 'interrupted'
  | 'record'
  | 'failed'
  | 'restart';

/** A practice run as it starts: what it practises, and how. */
export interface PracticeRun {
  /** Its id, which every event in it carries; each run's is higher than the last's. */
  runId: number;
  /** The take practised. */
  takeId: string;
  style: PracticeStyle;
  /** The hand it asks to play. */
  hand: TrainingHand;
  /** Where in the take it started. */
  fromMs: number;
  /** The passage it plays round, or null. */
  loop: PlaybackLoop | null;
  /** How fast it started, 1 being the take's own speed; see the `speed` event. */
  speed: number;
  /** The audio time at which it reaches `fromMs`: its clock's start anchor. */
  anchorAudioTime: number;
  /** How long a count-in plays before `anchorAudioTime`, in real milliseconds. */
  countInMs: number;
  /** Where playback ends, the pedal's tails and all: `effectivePlaybackDurationMs`. */
  durationMs: number;
  /** The take's tempo as it started, which places its bars. */
  tempo: TempoSettings;
  /** Every note it asks for, anywhere in the take, in the order they are struck. */
  asked: readonly AskedNote[];
  /** How many notes the take has: those asked for, and those it plays itself. */
  noteCount: number;
  /** The take's own length, `Take.durationMs`. */
  takeDurationMs: number;
}

/** Something that happens in a practice run. */
export type RunEvent =
  /** The run has started. */
  | { type: 'run-start'; run: PracticeRun }
  /**
   * Playback passed the hold at `atMs` without stopping: every key it asks
   * for was played on the way to it.
   */
  | { type: 'step'; atMs: number; midis: readonly number[] }
  /** Playback stopped at `atMs` to wait for `midis`, which fell due at `dueAudioTime`. */
  | { type: 'hold'; atMs: number; midis: readonly number[]; dueAudioTime: number }
  /** A key was pressed at a hold: one it asks for (`wanted`), or not. */
  | { type: 'hold-key'; midi: number; wanted: boolean; audioTime: number }
  /**
   * A hold let playback go at `audioTime`: played, by the last key it wanted;
   * or `skipped`, by Play or its own mode chosen again, and the take plays the
   * notes it asked for.
   */
  | { type: 'hold-cleared'; skipped: boolean; audioTime: number }
  /**
   * The speed changed: at `audioTime`, or, chosen at a hold, as the run resumes
   * from it (`audioTime` null).
   */
  | { type: 'speed'; speed: number; audioTime: number | null }
  /**
   * The run ended, and why. `audioTime` is when, for a run that keeps time; a
   * run that waits at its holds leaves it null.
   */
  | { type: 'run-end'; reason: RunEndReason; audioTime: number | null };

/**
 * What a practice run tells its listeners: something that happened, and the
 * run it happened in. A run's `run-start` comes before anything else of it,
 * and its `run-end` after everything; no run ends twice.
 */
export type PracticeEvent = { runId: number } & RunEvent;

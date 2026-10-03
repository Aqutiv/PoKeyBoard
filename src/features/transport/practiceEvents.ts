import type { PlaybackLoop, TempoSettings } from '@/domain/takeTypes';
import type { TrainingHand } from '@/domain/trainingGate';

// A placeholder for the practice run's event stream, which the transport
// controller publishes (`subscribePractice`). It is replaced by the
// controller's own when that lands, and carries the same contract.

export type PracticeStyle = 'wait' | 'playAlong';

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

export interface AskedNote {
  id: string;
  midi: number;
  startMs: number;
}

export interface PracticeRun {
  runId: number;
  takeId: string;
  style: PracticeStyle;
  hand: TrainingHand;
  fromMs: number;
  loop: PlaybackLoop | null;
  speed: number;
  anchorAudioTime: number;
  countInMs: number;
  durationMs: number;
  tempo: TempoSettings;
  asked: readonly AskedNote[];
  noteCount: number;
  takeDurationMs: number;
}

export type PracticeEvent = { runId: number } & (
  | { type: 'run-start'; run: PracticeRun }
  // A step played before the music reached it: no hold.
  | { type: 'step'; atMs: number; midis: readonly number[] }
  | { type: 'hold'; atMs: number; midis: readonly number[]; dueAudioTime: number }
  | { type: 'hold-key'; midi: number; wanted: boolean; audioTime: number }
  // `skipped`: Play was pressed at the hold, which lets its note through.
  | { type: 'hold-cleared'; skipped: boolean; audioTime: number }
  | { type: 'speed'; speed: number; audioTime: number | null }
  | { type: 'run-end'; reason: RunEndReason; audioTime: number | null }
);

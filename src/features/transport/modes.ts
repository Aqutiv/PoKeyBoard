import { countInMsAt, createTakeTempoMap } from '@/domain/tempoMap';
import type { TempoSettings } from '@/domain/takeTypes';
import type { TrainingHand } from '@/domain/trainingGate';

/** What a recording pass does to what is already there. */
export type RecordMode = 'overdub' | 'replace';

export const RECORD_MODES = ['overdub', 'replace'] as const;

/**
 * How playback runs. Simple is straight through. The rest practise one hand,
 * or both, in one of two styles: the training modes ("Wait for me") stop at
 * every note the chosen hand has to play and wait for the user to play it,
 * while the play-along modes ("Keep time") never wait: the music runs on in
 * time and leaves the chosen hand's notes for the user to play with it.
 */
export type PlaybackMode =
  | 'simple'
  | 'training-left'
  | 'training-right'
  | 'training-both'
  | 'playalong-left'
  | 'playalong-right'
  | 'playalong-both';

export const PLAYBACK_MODES = [
  'simple',
  'training-left',
  'training-right',
  'training-both',
  'playalong-left',
  'playalong-right',
  'playalong-both',
] as const;

/**
 * How a practice run meets the notes it asks for: `wait` holds at each one
 * until the player has played it, as the training modes do; `playAlong` keeps
 * the take's time, and the player plays along.
 */
export type PracticeStyle = 'wait' | 'playAlong';

export const PRACTICE_STYLES = ['wait', 'playAlong'] as const;

/** The mode practising each hand in each style. */
const PRACTICE_MODES: Record<PracticeStyle, Record<TrainingHand, PlaybackMode>> = {
  wait: { left: 'training-left', right: 'training-right', both: 'training-both' },
  playAlong: { left: 'playalong-left', right: 'playalong-right', both: 'playalong-both' },
};

/** The hand a playback mode trains, or null when it does not train at all. */
export function trainingHandFor(mode: PlaybackMode): TrainingHand | null {
  switch (mode) {
    case 'training-left':
      return 'left';
    case 'training-right':
      return 'right';
    case 'training-both':
      return 'both';
    default:
      return null;
  }
}

/** The hand a playback mode leaves the user to play in time, or null when it leaves none. */
export function playAlongHandFor(mode: PlaybackMode): TrainingHand | null {
  switch (mode) {
    case 'playalong-left':
      return 'left';
    case 'playalong-right':
      return 'right';
    case 'playalong-both':
      return 'both';
    default:
      return null;
  }
}

/** The hand a playback mode practises, in either style, or null for straight-through playback. */
export function practiceHandFor(mode: PlaybackMode): TrainingHand | null {
  return trainingHandFor(mode) ?? playAlongHandFor(mode);
}

/** The style a playback mode practises in, or null for straight-through playback. */
export function practiceStyleOf(mode: PlaybackMode): PracticeStyle | null {
  if (trainingHandFor(mode) !== null) return 'wait';
  if (playAlongHandFor(mode) !== null) return 'playAlong';
  return null;
}

/** The playback mode that practises `hand` in `style`. */
export function practiceMode(style: PracticeStyle, hand: TrainingHand): PlaybackMode {
  return PRACTICE_MODES[style][hand];
}

/**
 * How long, in real time, Keep time counts a run in from `fromMs`: the take's
 * count-in, as a recording counts one in, at the tempo in force there and the
 * practice speed. Never less than a bar, even with the take's count-in turned
 * off: a recording keeps whatever time the player sets, but here the music
 * sets it, and the player has to have heard the beat to come in on it.
 */
export function keepTimeCountInMs(tempo: TempoSettings, fromMs: number, speed: number): number {
  const bars = Math.max(1, tempo.countInBars);
  return countInMsAt(createTakeTempoMap(tempo), tempo.timeSignature, bars, fromMs) / speed;
}

/** The speeds offered: slow enough to learn a passage, and a little past the take's own. */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.25, 1.5] as const;

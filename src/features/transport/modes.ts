import type { TrainingHand } from '@/domain/trainingGate';

/** What a recording pass does to what is already there. */
export type RecordMode = 'overdub' | 'replace';

export const RECORD_MODES = ['overdub', 'replace'] as const;

/**
 * How playback runs. Simple is straight through; the training modes stop at
 * every note the chosen hand has to play and wait for the user to play it.
 */
export type PlaybackMode = 'simple' | 'training-left' | 'training-right' | 'training-both';

export const PLAYBACK_MODES = [
  'simple',
  'training-left',
  'training-right',
  'training-both',
] as const;

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

/** The speeds offered: slow enough to learn a passage, and a little past the take's own. */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.25, 1.5] as const;

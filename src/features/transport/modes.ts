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

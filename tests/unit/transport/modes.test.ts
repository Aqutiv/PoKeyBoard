import { describe, expect, it } from 'vitest';
import type { TempoSettings } from '@/domain/takeTypes';
import type { TrainingHand } from '@/domain/trainingGate';
import {
  keepTimeCountInMs,
  PLAYBACK_MODES,
  PRACTICE_STYLES,
  playAlongHandFor,
  practiceHandFor,
  practiceMode,
  practiceStyleOf,
  trainingHandFor,
  type PlaybackMode,
} from '@/features/transport/modes';

const HANDS: readonly TrainingHand[] = ['left', 'right', 'both'];

/** 120 bpm in 4/4: a beat every 500 ms, a bar every two seconds. */
function tempo(overrides: Partial<TempoSettings> = {}): TempoSettings {
  return {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    countInBars: 1,
    ...overrides,
  };
}

describe('playback modes', () => {
  it('offer straight-through playback and each hand in both practice styles', () => {
    expect(PLAYBACK_MODES).toEqual([
      'simple',
      'training-left',
      'training-right',
      'training-both',
      'playalong-left',
      'playalong-right',
      'playalong-both',
    ]);
    expect(PRACTICE_STYLES).toEqual(['wait', 'playAlong']);
  });

  it('wait only in the training modes: Keep time never holds for a note', () => {
    expect(trainingHandFor('training-left')).toBe('left');
    expect(trainingHandFor('training-both')).toBe('both');
    expect(trainingHandFor('playalong-left')).toBeNull();
    expect(trainingHandFor('playalong-right')).toBeNull();
    expect(trainingHandFor('playalong-both')).toBeNull();
    expect(trainingHandFor('simple')).toBeNull();
  });

  it('leave a hand to the player only in the play-along modes', () => {
    expect(playAlongHandFor('playalong-left')).toBe('left');
    expect(playAlongHandFor('playalong-right')).toBe('right');
    expect(playAlongHandFor('playalong-both')).toBe('both');
    expect(playAlongHandFor('training-right')).toBeNull();
    expect(playAlongHandFor('simple')).toBeNull();
  });

  it('name the hand practised whatever the style, and none for Listen', () => {
    expect(practiceHandFor('training-left')).toBe('left');
    expect(practiceHandFor('playalong-left')).toBe('left');
    expect(practiceHandFor('training-both')).toBe('both');
    expect(practiceHandFor('playalong-right')).toBe('right');
    expect(practiceHandFor('simple')).toBeNull();
  });

  it('name the style practised, and none for Listen', () => {
    expect(practiceStyleOf('training-right')).toBe('wait');
    expect(practiceStyleOf('playalong-right')).toBe('playAlong');
    expect(practiceStyleOf('playalong-both')).toBe('playAlong');
    expect(practiceStyleOf('simple')).toBeNull();
  });

  it('make the mode for every style and hand, and read both back from it', () => {
    expect(practiceMode('wait', 'left')).toBe('training-left');
    expect(practiceMode('playAlong', 'both')).toBe('playalong-both');
    const made = new Set<PlaybackMode>();
    for (const style of PRACTICE_STYLES) {
      for (const hand of HANDS) {
        const mode = practiceMode(style, hand);
        expect(PLAYBACK_MODES).toContain(mode);
        expect(practiceStyleOf(mode)).toBe(style);
        expect(practiceHandFor(mode)).toBe(hand);
        made.add(mode);
      }
    }
    // Six modes, one per pairing: every mode but Listen.
    expect([...made].sort()).toEqual(PLAYBACK_MODES.filter((mode) => mode !== 'simple').sort());
  });
});

describe('the Keep time count-in', () => {
  it('lasts the take’s count-in at the take’s own speed', () => {
    expect(keepTimeCountInMs(tempo(), 0, 1)).toBe(2000);
    expect(keepTimeCountInMs(tempo({ countInBars: 2 }), 0, 1)).toBe(4000);
  });

  it('counts a bar in even when the take asks for no count-in', () => {
    expect(keepTimeCountInMs(tempo({ countInBars: 0 }), 0, 1)).toBe(2000);
  });

  it('stretches with the practice speed, so the clicks fall on the slowed beat', () => {
    expect(keepTimeCountInMs(tempo(), 0, 0.5)).toBe(4000);
    expect(keepTimeCountInMs(tempo(), 0, 1.25)).toBe(1600);
  });

  it('counts at the tempo in force where the run starts', () => {
    // 60 bpm from four seconds in: a bar there lasts four seconds.
    const slowing = tempo({ changes: [{ atMs: 4000, bpm: 60 }] });
    expect(keepTimeCountInMs(slowing, 1000, 1)).toBe(2000);
    expect(keepTimeCountInMs(slowing, 6000, 1)).toBe(4000);
  });

  it('counts the bar the time signature makes', () => {
    // 6/8 at 120: an eighth-note beat of 250 ms, six of them to the bar.
    expect(
      keepTimeCountInMs(tempo({ timeSignature: { numerator: 6, denominator: 8 } }), 0, 1),
    ).toBe(1500);
  });
});

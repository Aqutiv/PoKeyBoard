import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioEngine, type InputNoteEvent } from '@/audio/AudioEngine';
import type { ExerciseSpec } from '@/features/learn/exerciseSpec';
import { useExercise } from '@/features/learn/useExercise';

/**
 * The engine is uninitialised in jsdom, so neither keys nor the pedal can
 * emit. Drive both subscriptions directly, in exactly the shapes `AudioEngine`
 * sends — which keeps the test on how the exercise reads the pedal.
 */
function stubEngine() {
  const inputs = new Set<(event: InputNoteEvent) => void>();
  const pedals = new Set<(down: boolean) => void>();
  vi.spyOn(audioEngine, 'subscribeInput').mockImplementation((listener) => {
    inputs.add(listener);
    return () => inputs.delete(listener);
  });
  vi.spyOn(audioEngine, 'subscribeSustain').mockImplementation((listener) => {
    pedals.add(listener);
    return () => pedals.delete(listener);
  });
  vi.spyOn(audioEngine, 'getActiveNotes').mockReturnValue(new Set());
  return {
    key(type: 'on' | 'off', midi: number): void {
      act(() => {
        for (const listener of [...inputs]) {
          listener(
            type === 'on'
              ? { type, midi, velocity: 0.7, audioTime: 0, sourceId: 'test' }
              : { type, midi, audioTime: 0, sourceId: 'test' },
          );
        }
      });
    },
    /** What one source reports — the raw input event, not the pedal itself. */
    source(down: boolean): void {
      act(() => {
        for (const listener of [...inputs]) {
          listener({ type: 'sustain', down, audioTime: 0, sourceId: 'kbd-pedal' });
        }
      });
    },
    /** The combined pedal changing: what the dampers actually did. */
    pedal(down: boolean): void {
      act(() => {
        for (const listener of [...pedals]) listener(down);
      });
    },
  };
}

const CHANGE_WITH_THE_HARMONY: ExerciseSpec = {
  kind: 'playAlong',
  phrase: {
    bpm: 60,
    timeSignature: { numerator: 4, denominator: 4 },
    events: [[0, ['C4', 'E4', 'G4'], 4, 0.7]],
  },
  together: { overlap: true, onsetWindowMs: 400 },
  pedal: 'changeEach',
};

describe('useExercise and the sustain pedal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finishes a chord on a change of the combined pedal', () => {
    const engine = stubEngine();
    const { result } = renderHook(() => useExercise(CHANGE_WITH_THE_HARMONY));
    for (const midi of [60, 64, 67]) engine.key('on', midi);
    expect(result.current.progress.satisfied).toBe(false);
    expect(result.current.state.along?.pedalOwed).toBe(true);
    engine.pedal(true);
    expect(result.current.progress.satisfied).toBe(true);
  });

  it('ignores the per-source events, which can report a press the ear never hears', () => {
    // Space going down while the on-screen button already holds the dampers
    // up is a source event with no change in the sound: not a pedal change.
    const engine = stubEngine();
    const { result } = renderHook(() => useExercise(CHANGE_WITH_THE_HARMONY));
    for (const midi of [60, 64, 67]) engine.key('on', midi);
    engine.source(true);
    expect(result.current.progress.satisfied).toBe(false);
  });

  it('stops listening to the pedal once the step is gone', () => {
    const engine = stubEngine();
    const { result, rerender } = renderHook(
      ({ spec }: { spec: ExerciseSpec | null }) => useExercise(spec),
      { initialProps: { spec: CHANGE_WITH_THE_HARMONY as ExerciseSpec | null } },
    );
    rerender({ spec: null });
    engine.pedal(true);
    expect(result.current.progress.done).toBe(0);
  });
});

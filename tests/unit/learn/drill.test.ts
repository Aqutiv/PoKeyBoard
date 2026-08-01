import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { drillRoundAt } from '@/features/learn/drill';
import type { PitchClass } from '@/features/learn/exerciseSpec';
import type { DrillPool, DrillStep } from '@/features/learn/types';
import { useDrill } from '@/features/learn/useDrill';

const BLACK: readonly PitchClass[] = [1, 3, 6, 8, 10];
const pool: DrillPool = { kind: 'namedKey', pitchClasses: BLACK, spelling: 'flat' };

const step: DrillStep = {
  id: 'findNamedKeys',
  kind: 'drill',
  rounds: 5,
  drill: pool,
};

describe('drillRoundAt', () => {
  it('turns a round into a spec and the label to ask for', () => {
    const round = drillRoundAt(pool, 0);
    expect(round?.spec).toEqual({ kind: 'pitchClass', pitchClass: 1 });
    expect(round?.label).toBe('D♭');
  });

  it('asks under the spelling the pool chose', () => {
    const sharps: DrillPool = { ...pool, spelling: 'sharp' };
    expect(drillRoundAt(sharps, 0)?.label).toBe('C♯');
  });

  it('visits every entry before repeating', () => {
    const asked = BLACK.map((_, round) => drillRoundAt(pool, round)?.spec);
    const pitchClasses = asked.map((spec) => (spec?.kind === 'pitchClass' ? spec.pitchClass : -1));
    expect([...pitchClasses].sort((a, b) => a - b)).toEqual([...BLACK]);
  });

  it('has nothing to ask from an empty pool', () => {
    expect(drillRoundAt({ kind: 'namedKey', pitchClasses: [] }, 0)).toBeNull();
  });
});

describe('useDrill', () => {
  it('starts on the first round with nothing scored', () => {
    const { result } = renderHook(() => useDrill(step));
    expect(result.current.progress).toEqual({ done: 0, total: 5, satisfied: false });
    expect(result.current.round?.label).toBe('D♭');
    expect(result.current.spec).toEqual({ kind: 'pitchClass', pitchClass: 1 });
  });

  it('hands each round its own spec identity, which is what resets the matcher', () => {
    const first = drillRoundAt(pool, 0)?.spec;
    const second = drillRoundAt(pool, 1)?.spec;
    expect(first).not.toEqual(second);
  });

  it('reports nothing to do without a drill step', () => {
    const { result } = renderHook(() => useDrill(null));
    expect(result.current.progress).toEqual({ done: 0, total: 0, satisfied: false });
    expect(result.current.spec).toBeNull();
  });

  it('resets to the first round when the step changes', () => {
    const other: DrillStep = { ...step, id: 'other' };
    const { result, rerender } = renderHook(({ s }: { s: DrillStep }) => useDrill(s), {
      initialProps: { s: step },
    });
    rerender({ s: other });
    expect(result.current.progress.done).toBe(0);
    expect(result.current.round?.label).toBe('D♭');
  });
});

describe('useDrill against live input', () => {
  it('advances a round only on the named key, and finishes after them all', () => {
    // The engine is uninitialised in jsdom, so `noteOn` cannot emit. Drive the
    // listeners directly instead: this is exactly the shape `AudioEngine`
    // sends, and it keeps the test on the drill rather than on audio.
    const listeners = new Set<(event: unknown) => void>();
    const subscribe = vi.spyOn(audioEngine, 'subscribeInput').mockImplementation((listener) => {
      listeners.add(listener as (event: unknown) => void);
      return () => listeners.delete(listener as (event: unknown) => void);
    });
    vi.spyOn(audioEngine, 'getActiveNotes').mockReturnValue(new Set());

    const play = (midi: number): void => {
      act(() => {
        for (const listener of [...listeners]) {
          listener({ type: 'on', midi, velocity: 0.7, audioTime: 0, sourceId: 'test' });
        }
        for (const listener of [...listeners]) {
          listener({ type: 'off', midi, audioTime: 0, sourceId: 'test' });
        }
      });
    };

    const { result } = renderHook(() => useDrill(step));

    // A key that is not the one asked for changes nothing.
    play(60);
    expect(result.current.progress.done).toBe(0);

    for (let round = 0; round < 5; round += 1) {
      const target = result.current.spec;
      expect(target?.kind).toBe('pitchClass');
      const pitchClass = target?.kind === 'pitchClass' ? target.pitchClass : 0;
      play(60 + pitchClass);
      expect(result.current.progress.done, `round ${round}`).toBe(round + 1);
    }

    expect(result.current.progress.satisfied).toBe(true);
    expect(result.current.spec).toBeNull();
    subscribe.mockRestore();
    vi.restoreAllMocks();
  });
});

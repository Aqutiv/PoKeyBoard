import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { drillRoundAt } from '@/features/learn/drill';
import { phraseToNotes } from '@/features/learn/phrase';
import type { ExerciseSpec, PitchClass } from '@/features/learn/exerciseSpec';
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

/** Chapter 4's shape: the question is a stave, so the answer is one exact key. */
const readingStep: DrillStep = {
  id: 'playWhatYouRead',
  kind: 'drill',
  rounds: 5,
  drill: { kind: 'readNote', pitchClasses: [0, 2, 4, 5, 7], baseMidi: 60 },
};

/** Chapter 5's shape: the same question, drawn on the other staff. */
const bassReadingPool: DrillPool = {
  kind: 'readNote',
  pitchClasses: [0, 2, 4, 5, 7],
  baseMidi: 48,
  staff: 'bass',
};

describe('drillRoundAt', () => {
  it('draws a bass reading round on the bass staff', () => {
    const round = drillRoundAt(bassReadingPool, 0);
    expect(round?.staves).toBe('bass');
    expect(phraseToNotes(round!.phrase!)[0]?.staff).toBe('bass');
  });

  it('leaves a reading round that says nothing on the treble staff', () => {
    // Chapter 4 passes no staff, and must keep drawing exactly as it did.
    const round = drillRoundAt(readingStep.drill, 0);
    expect(round?.staves).toBe('treble');
    expect(phraseToNotes(round!.phrase!)[0]?.staff).toBeUndefined();
  });

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

  it('asks a reading round for one exact key, with no name beside it', () => {
    const { result } = renderHook(() => useDrill(readingStep));
    expect(result.current.spec).toEqual({ kind: 'exactKeys', midis: [60] });
    expect(result.current.round?.label).toBe('');
    expect(result.current.round?.phrase).toBeDefined();
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
  /**
   * The engine is uninitialised in jsdom, so `noteOn` cannot emit. Drive the
   * listeners directly instead: this is exactly the shape `AudioEngine` sends,
   * and it keeps the test on the drill rather than on audio.
   */
  function stubEngine() {
    const listeners = new Set<(event: unknown) => void>();
    vi.spyOn(audioEngine, 'subscribeInput').mockImplementation((listener) => {
      listeners.add(listener as (event: unknown) => void);
      return () => listeners.delete(listener as (event: unknown) => void);
    });
    vi.spyOn(audioEngine, 'getActiveNotes').mockReturnValue(new Set());
    return (midi: number): void => {
      act(() => {
        for (const listener of [...listeners]) {
          listener({ type: 'on', midi, velocity: 0.7, audioTime: 0, sourceId: 'test' });
        }
        for (const listener of [...listeners]) {
          listener({ type: 'off', midi, audioTime: 0, sourceId: 'test' });
        }
      });
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The midi the current round is asking for. */
  function asked(spec: ExerciseSpec | null): number {
    if (spec?.kind !== 'exactKeys') throw new Error('expected a reading round');
    return spec.midis[0] as number;
  }

  it('holds a correct answer on screen before moving on', () => {
    const play = stubEngine();
    const { result } = renderHook(() => useDrill(readingStep));

    const first = asked(result.current.spec);
    play(first);

    // Scored immediately, so the readout confirms on the same frame the note
    // lands — but the question is still the one just answered, which is what
    // lets the played note light up on the stave.
    expect(result.current.progress.done).toBe(1);
    expect(asked(result.current.spec)).toBe(first);

    act(() => void vi.advanceTimersByTime(500));
    expect(asked(result.current.spec)).not.toBe(first);
    expect(result.current.progress.done).toBe(1);
  });

  it('advances a round only on the note shown, and finishes after them all', () => {
    const play = stubEngine();
    const { result } = renderHook(() => useDrill(readingStep));

    // A key that is not the one asked for changes nothing.
    play(asked(result.current.spec) + 1);
    expect(result.current.progress.done).toBe(0);

    for (let round = 0; round < 5; round += 1) {
      play(asked(result.current.spec));
      expect(result.current.progress.done, `round ${round}`).toBe(round + 1);
      act(() => void vi.advanceTimersByTime(500));
    }

    expect(result.current.progress.satisfied).toBe(true);
    expect(result.current.spec).toBeNull();
  });

  it('does not accept the right note in the wrong octave', () => {
    // A reading round is about which line the note sits on, so the octave
    // above is a different answer, not a near-miss.
    const play = stubEngine();
    const { result } = renderHook(() => useDrill(readingStep));
    play(asked(result.current.spec) + 12);
    expect(result.current.progress.done).toBe(0);
  });

  it('cancels a pending advance when the step changes', () => {
    // Otherwise a drill left mid-hold would advance into whatever replaced it.
    const play = stubEngine();
    const other: DrillStep = { ...readingStep, id: 'other' };
    const { result, rerender } = renderHook(({ s }: { s: DrillStep }) => useDrill(s), {
      initialProps: { s: readingStep },
    });

    play(asked(result.current.spec));
    expect(result.current.progress.done).toBe(1);

    rerender({ s: other });
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.progress.done).toBe(0);
    expect(asked(result.current.spec)).toBe(
      asked(drillRoundAt(readingStep.drill, 0)?.spec ?? null),
    );
  });
});

describe('drillRoundAt: scale degrees', () => {
  it('asks for the degree of the scale on its own tonic, any octave', () => {
    // G major's seventh degree is F sharp: the pattern, not the white keys.
    const gMajor: DrillPool = { kind: 'scaleDegree', tonic: 7, degrees: [7] };
    const round = drillRoundAt(gMajor, 0);
    expect(round?.spec).toEqual({ kind: 'pitchClass', pitchClass: 6 });
    expect(round?.degree).toBe(7);
  });

  it('names no note, since the name would be the answer', () => {
    const cMajor: DrillPool = { kind: 'scaleDegree', tonic: 0, degrees: [1, 5] };
    expect(drillRoundAt(cMajor, 0)?.label).toBe('');
    expect(drillRoundAt(cMajor, 0)?.phrase).toBeUndefined();
  });

  it('asks nothing of an empty pool', () => {
    expect(drillRoundAt({ kind: 'scaleDegree', tonic: 0, degrees: [] }, 0)).toBeNull();
  });
});

describe('drillRoundAt: named chords', () => {
  const pool: DrillPool = {
    kind: 'namedChord',
    chords: [
      { root: 0, quality: 'major' },
      { root: 9, quality: 'minor' },
    ],
  };

  it('asks for the named chord as a block a mouse can roll', () => {
    const round = drillRoundAt(pool, 0);
    expect(round?.chord).toEqual({ root: 0, quality: 'major' });
    expect(round?.spec).toEqual({
      kind: 'chord',
      chord: { root: 0, quality: 'major' },
      together: { overlap: true, onsetWindowMs: 400 },
    });
  });

  it('draws nothing and names no notes, since the name is the question', () => {
    const round = drillRoundAt(pool, 1);
    expect(round?.label).toBe('');
    expect(round?.phrase).toBeUndefined();
  });
});

describe('drillRoundAt: degrees in named keys', () => {
  // G major's 7th, D major's 3rd, F major's 4th: each key's black key.
  const pool: DrillPool = {
    kind: 'keyDegree',
    questions: [
      { key: 1, degree: 7 },
      { key: 2, degree: 3 },
      { key: -1, degree: 4 },
    ],
  };

  it('asks for the degree of the named key, in any octave', () => {
    const asked = [0, 1, 2].map((round) => drillRoundAt(pool, round)?.spec);
    // Stride two over three: G 7, F 4, D 3.
    expect(asked).toEqual([
      { kind: 'pitchClass', pitchClass: 6 },
      { kind: 'pitchClass', pitchClass: 10 },
      { kind: 'pitchClass', pitchClass: 6 },
    ]);
  });

  it('names the key and the degree for the prompt, and draws nothing', () => {
    const round = drillRoundAt(pool, 1);
    expect(round?.kind).toBe('keyDegree');
    expect(round?.key).toBe(-1);
    expect(round?.degree).toBe(4);
    expect(round?.label).toBe('');
    expect(round?.phrase).toBeUndefined();
  });

  it('asks nothing of an empty pool, or of a degree the scale does not have', () => {
    expect(drillRoundAt({ kind: 'keyDegree', questions: [] }, 0)).toBeNull();
    expect(drillRoundAt({ kind: 'keyDegree', questions: [{ key: 1, degree: 8 }] }, 0)).toBeNull();
  });
});

describe('drillRoundAt: key home notes', () => {
  // Two sharps and three flats: D major and E flat major.
  const keys: DrillPool = { kind: 'keyTonic', signatures: [2, -3] };

  it('asks for the home note of the key the signature names, in any octave', () => {
    expect(drillRoundAt(keys, 0)?.spec).toEqual({ kind: 'pitchClass', pitchClass: 2 });
    expect(drillRoundAt(keys, 1)?.spec).toEqual({ kind: 'pitchClass', pitchClass: 3 });
  });

  it('draws the signature alone and names nothing: reading it is the question', () => {
    const round = drillRoundAt(keys, 1);
    expect(round?.kind).toBe('keyTonic');
    expect(round?.signature).toBe(-3);
    expect(round?.label).toBe('');
    expect(round?.staves).toBe('treble');
    expect(round?.phrase).toMatchObject({ keySignature: -3, events: [] });
  });

  it('keeps each round’s picture the same object, so the staff is not redrawn per key press', () => {
    expect(drillRoundAt(keys, 0)?.phrase).toBe(drillRoundAt(keys, 0)?.phrase);
  });

  it('asks nothing of an empty pool', () => {
    expect(drillRoundAt({ kind: 'keyTonic', signatures: [] }, 0)).toBeNull();
  });
});

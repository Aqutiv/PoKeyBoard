import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PitchClass } from '@/features/learn/exerciseSpec';
import type { QuizStep } from '@/features/learn/types';
import { phraseToNotes } from '@/features/learn/phrase';
import { QUIZ_BASE_MIDI, quizPitchClassAt, useQuiz } from '@/features/learn/useQuiz';

const WHITE: readonly PitchClass[] = [0, 2, 4, 5, 7, 9, 11];

const step: QuizStep = {
  id: 'nameTheKey',
  kind: 'quiz',
  rounds: 5,
  question: { kind: 'nameTheKey', pitchClasses: WHITE },
};

describe('quizPitchClassAt', () => {
  it('does not put the answer to round n on button n', () => {
    // Asking the pool in plain order would let the whole quiz be passed
    // left-to-right without ever looking at the keyboard.
    const asked = [0, 1, 2, 3].map((round) => quizPitchClassAt(WHITE, round));
    expect(asked).not.toEqual([WHITE[0], WHITE[1], WHITE[2], WHITE[3]]);
  });

  it('visits every entry before repeating', () => {
    const asked = WHITE.map((_, round) => quizPitchClassAt(WHITE, round));
    expect([...asked].sort((a, b) => a - b)).toEqual([...WHITE]);
  });

  it('still covers a pool whose size shares a factor with the stride', () => {
    // A pool of 12 with a stride of 3 would only ever ask four of them.
    const all = Array.from({ length: 12 }, (_, i) => i as PitchClass);
    const asked = all.map((_, round) => quizPitchClassAt(all, round));
    expect(new Set(asked).size).toBe(12);
  });

  it('is deterministic', () => {
    expect(quizPitchClassAt(WHITE, 3)).toBe(quizPitchClassAt(WHITE, 3));
  });

  it('survives an empty pool', () => {
    expect(quizPitchClassAt([], 4)).toBe(0);
  });
});

describe('useQuiz', () => {
  it('starts at zero of the required rounds', () => {
    const { result } = renderHook(() => useQuiz(step));
    expect(result.current.done).toBe(0);
    expect(result.current.total).toBe(5);
    expect(result.current.satisfied).toBe(false);
    expect(result.current.midi).toBe(QUIZ_BASE_MIDI + quizPitchClassAt(WHITE, 0));
  });

  it('advances on a correct answer', () => {
    const { result } = renderHook(() => useQuiz(step));
    act(() => result.current.answer(quizPitchClassAt(WHITE, 0)));
    expect(result.current.done).toBe(1);
    expect(result.current.wrong).toBeNull();
    expect(result.current.midi).toBe(QUIZ_BASE_MIDI + quizPitchClassAt(WHITE, 1));
  });

  it('holds the round and names the key on a wrong answer', () => {
    const { result } = renderHook(() => useQuiz(step));
    const correct = quizPitchClassAt(WHITE, 0);
    const wrong = WHITE.find((pc) => pc !== correct) as PitchClass;
    const asked = result.current.midi;

    act(() => result.current.answer(wrong));
    expect(result.current.done).toBe(0);
    expect(result.current.wrong).toBe(wrong);
    // Same question, so the user can act on being told the answer.
    expect(result.current.midi).toBe(asked);

    act(() => result.current.answer(correct));
    expect(result.current.done).toBe(1);
    expect(result.current.wrong).toBeNull();
  });

  it('is satisfied after the required number of correct answers', () => {
    const { result } = renderHook(() => useQuiz(step));
    for (let round = 0; round < 5; round += 1) {
      act(() => result.current.answer(quizPitchClassAt(WHITE, round)));
    }
    expect(result.current.satisfied).toBe(true);
    expect(result.current.done).toBe(5);
  });

  it('ignores answers once satisfied', () => {
    const { result } = renderHook(() => useQuiz(step));
    for (let round = 0; round < 5; round += 1) {
      act(() => result.current.answer(quizPitchClassAt(WHITE, round)));
    }
    act(() => result.current.answer(11));
    expect(result.current.done).toBe(5);
    expect(result.current.wrong).toBeNull();
  });

  it('resets when the step changes', () => {
    const other: QuizStep = { ...step, id: 'other' };
    const { result, rerender } = renderHook(({ s }: { s: QuizStep }) => useQuiz(s), {
      initialProps: { s: step },
    });
    act(() => result.current.answer(quizPitchClassAt(WHITE, 0)));
    expect(result.current.done).toBe(1);

    rerender({ s: other });
    expect(result.current.done).toBe(0);
  });

  it('reports nothing to do when there is no quiz step', () => {
    const { result } = renderHook(() => useQuiz(null));
    expect(result.current.total).toBe(0);
    expect(result.current.satisfied).toBe(false);
  });
});

describe('useQuiz reading rounds', () => {
  it('draws a bass question on the bass staff', () => {
    const bassStep: QuizStep = {
      id: 'whichBassNote',
      kind: 'quiz',
      rounds: 5,
      question: { kind: 'readNote', pitchClasses: [0, 2, 4, 5, 7], baseMidi: 48, staff: 'bass' },
    };
    const { result } = renderHook(() => useQuiz(bassStep));
    expect(result.current.staves).toBe('bass');
    expect(result.current.midi).toBeLessThan(60);
    expect(phraseToNotes(result.current.phrase!)[0]?.staff).toBe('bass');
  });

  it('leaves a question that says nothing on the treble staff', () => {
    const trebleStep: QuizStep = {
      id: 'whichNote',
      kind: 'quiz',
      rounds: 5,
      question: { kind: 'readNote', pitchClasses: [0, 2, 4, 5, 7], baseMidi: 60 },
    };
    const { result } = renderHook(() => useQuiz(trebleStep));
    expect(result.current.staves).toBe('treble');
    expect(phraseToNotes(result.current.phrase!)[0]?.staff).toBeUndefined();
  });

  it('draws nothing for a key-naming round', () => {
    const { result } = renderHook(() => useQuiz(step));
    expect(result.current.phrase).toBeNull();
    // The panel shows a keyboard diagram instead, so the mode is unread.
    expect(result.current.staves).toBe('treble');
  });
});

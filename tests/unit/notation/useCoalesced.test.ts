import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { notesMissingFrom, useCoalesced } from '@/features/notation/useCoalesced';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function hook(initial: number, coalesce: boolean) {
  return renderHook(
    ({ value, on }: { value: number; on: boolean }) => useCoalesced(value, on, 250),
    { initialProps: { value: initial, on: coalesce } },
  );
}

describe('useCoalesced', () => {
  it('follows at once while not coalescing', () => {
    const { result, rerender } = hook(1, false);
    rerender({ value: 2, on: false });
    expect(result.current).toBe(2);
  });

  it('shows the first change after a quiet spell on the next task, and a burst as one', () => {
    const { result, rerender } = hook(1, true);
    rerender({ value: 2, on: true });
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe(2);

    rerender({ value: 3, on: true });
    rerender({ value: 4, on: true });
    act(() => vi.advanceTimersByTime(100));
    rerender({ value: 5, on: true });
    act(() => vi.advanceTimersByTime(149));
    expect(result.current).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(5);
  });

  it('does not count the time a take sat open as the cost of a layout', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { result, rerender } = hook(1, true);
    rerender({ value: 2, on: true });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe(2);
    // Ten minutes on, a take opened while not recording…
    clock = 600_000;
    rerender({ value: 3, on: false });
    // …and recording again: the next note is laid out within the interval.
    rerender({ value: 4, on: true });
    act(() => vi.advanceTimersByTime(250));
    expect(result.current).toBe(4);
  });

  it('catches up at once when coalescing stops', () => {
    const { result, rerender } = hook(1, true);
    act(() => vi.advanceTimersByTime(0));
    rerender({ value: 2, on: true });
    act(() => vi.advanceTimersByTime(0));
    rerender({ value: 3, on: true });
    expect(result.current).toBe(2);
    rerender({ value: 3, on: false });
    expect(result.current).toBe(3);
  });
});

describe('notesMissingFrom', () => {
  const note = (id: string): NoteEvent => ({
    id,
    midi: 60,
    startMs: 0,
    durationMs: 1,
    velocity: 1,
  });

  it('lists what the laid-out notes lack, in order, and nothing when they are the same', () => {
    const laidOut = [note('a'), note('c')];
    const all = [note('a'), note('b'), laidOut[1]!, note('d')];
    expect(notesMissingFrom(all, laidOut).map((n) => n.id)).toEqual(['b', 'd']);
    expect(notesMissingFrom(laidOut, laidOut)).toEqual([]);
    expect(notesMissingFrom(laidOut, laidOut)).toBe(notesMissingFrom(all, all));
  });
});

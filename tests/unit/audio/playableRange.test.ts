import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { contributeRange, __resetForTests } from '@/audio/playableRange';

let ensure: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetForTests();
  ensure = vi.spyOn(audioEngine, 'ensurePlayableRange').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetForTests();
});

describe('contributeRange', () => {
  it('asks for exactly what a lone contributor needs', () => {
    contributeRange('keyboard', 48, 72);
    expect(ensure).toHaveBeenCalledWith(48, 72);
  });

  /**
   * The regression this module exists for: a MIDI keyboard playing low while
   * the key bed sits at C3 must not shrink the loaded range to its own span.
   * ensurePlayableRange also remembers its argument to reload after an
   * instrument switch, so the last caller winning would strand the key bed.
   */
  it('asks for the union of every contributor, whoever moved last', () => {
    contributeRange('keyboard', 48, 72);
    contributeRange('midi', 24, 36);
    expect(ensure).toHaveBeenLastCalledWith(24, 72);

    contributeRange('keyboard', 60, 84);
    expect(ensure).toHaveBeenLastCalledWith(24, 84);
  });

  it('does not re-ask when a contributor repeats itself', () => {
    contributeRange('keyboard', 48, 72);
    contributeRange('keyboard', 48, 72);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  // The key bed unmounts on every tab change; its register stays loaded so
  // coming back to Play does not re-decode what was already there.
  it('keeps a contribution after the contributor is gone', () => {
    contributeRange('keyboard', 48, 72);
    contributeRange('midi', 24, 36);
    contributeRange('midi', 24, 40);
    expect(ensure).toHaveBeenLastCalledWith(24, 72);
  });
});

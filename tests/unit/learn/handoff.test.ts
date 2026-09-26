import { afterEach, describe, expect, it } from 'vitest';
import { createTakeTempoMap } from '@/domain/tempoMap';
import { handoffLoop, handoffTitle, revealHandoffInLibrary } from '@/features/learn/handoff';
import { buildLibraryTake } from '@/features/library/trackBuilder';
import { A_BEAUTIFUL_DAY } from '@/features/library/tracks/aBeautifulDay';
import { loopBetween } from '@/features/transport/practiceLoop';
import { useSettingsStore } from '@/state/useSettingsStore';

const MINUET = 'score-bach-minuet-in-g-major-bwv-anh-114';

describe('handoffTitle', () => {
  it('names an authored track', () => {
    expect(handoffTitle('a-beautiful-day')).toBe(A_BEAUTIFUL_DAY.title);
  });

  it('names a Classics score, which the authored list alone does not hold', () => {
    // Looked up there, it came back empty and the closing card silently fell
    // back to its plain "Try it on Play".
    expect(handoffTitle(MINUET)).toBe('Minuet in G major, BWV Anh. 114');
  });

  it('names nothing the Library does not have', () => {
    expect(handoffTitle('no-such-track')).toBeUndefined();
  });
});

describe('revealHandoffInLibrary', () => {
  const initial = useSettingsStore.getState().libraryFolder;
  afterEach(() => useSettingsStore.getState().setLibraryFolder(initial));

  it('opens the Library at the folder the track is listed in', () => {
    useSettingsStore.getState().setLibraryFolder('originals');
    revealHandoffInLibrary(MINUET);
    expect(useSettingsStore.getState().libraryFolder).toBe('classics');
  });

  it('leaves the folder alone for a track the Library does not have', () => {
    useSettingsStore.getState().setLibraryFolder('originals');
    revealHandoffInLibrary('no-such-track');
    expect(useSettingsStore.getState().libraryFolder).toBe('originals');
  });
});

describe('handoffLoop', () => {
  const take = buildLibraryTake(A_BEAUTIFUL_DAY);
  const map = createTakeTempoMap(take.tempo);

  it('loops the bars asked for, in the take’s own milliseconds', () => {
    // Bars 3–6 at 92bpm: the tune's first statement, after the introduction.
    const loop = handoffLoop(take, [8, 24]);
    expect(loop).toEqual({
      startMs: Math.round(map.msAtBeat(8)),
      endMs: Math.round(map.msAtBeat(24)),
    });
  });

  it('makes exactly the loop Play’s own loop button would, marking the same two points', () => {
    const startMs = Math.round(map.msAtBeat(8));
    const endMs = Math.round(map.msAtBeat(24));
    expect(handoffLoop(take, [8, 24])).toEqual(loopBetween(take, startMs, endMs));
  });

  it('keeps a loop reaching past the end inside the take', () => {
    const lastBeat = Math.floor(map.beatAtMs(take.durationMs));
    const loop = handoffLoop(take, [lastBeat - 8, lastBeat + 16]);
    expect(loop?.endMs).toBeLessThanOrEqual(take.durationMs);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  deletePack,
  downloadPack,
  getPacks,
  refreshPack,
  subscribePacks,
} from '@/features/settings/packStates';

const engine = vi.hoisted(() => ({
  totalBytes: 2_400_000,
  offline: false,
  failCheck: false,
  downloads: [] as Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    progress: (loaded: number, total: number) => void;
  }>,
  deleted: [] as string[],
}));

vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    bankFor: () => ({
      loadManifest: async () => {
        if (engine.failCheck) throw new Error('offline');
        return { totalBytes: engine.totalBytes, files: [] };
      },
    }),
    isFullPackOffline: async () => engine.offline,
    downloadFullSamplePack: (_id: string, progress: (loaded: number, total: number) => void) =>
      new Promise<void>((resolve, reject) => {
        engine.downloads.push({ resolve, reject, progress });
      }),
    deleteDownloadedSamples: async (id: string) => {
      engine.deleted.push(id);
      engine.offline = false;
    },
  },
}));

const WURLITZER = 'wurlitzer-ep203w';

describe('piano pack states', () => {
  beforeEach(() => {
    __resetForTests();
    engine.offline = false;
    engine.failCheck = false;
    engine.downloads = [];
    engine.deleted = [];
  });

  it('reads a piano that is not downloaded, then one that is, each with its size', async () => {
    expect(getPacks()[WURLITZER]).toBeUndefined();
    await refreshPack(WURLITZER);
    expect(getPacks()[WURLITZER]).toEqual({ kind: 'not-downloaded', totalBytes: 2_400_000 });
    engine.offline = true;
    await refreshPack(WURLITZER);
    expect(getPacks()[WURLITZER]).toEqual({ kind: 'offline-ready', totalBytes: 2_400_000 });
  });

  it('keeps a running download through a card that looks again, and ends it offline', async () => {
    await refreshPack(WURLITZER);
    downloadPack(WURLITZER);
    expect(getPacks()[WURLITZER]).toEqual({
      kind: 'downloading',
      loadedBytes: 0,
      totalBytes: 2_400_000,
    });
    engine.downloads[0]!.progress(1_200_000, 2_400_000);

    // A card that unmounted and came back looks again: the download stands.
    await refreshPack(WURLITZER);
    expect(getPacks()[WURLITZER]).toEqual({
      kind: 'downloading',
      loadedBytes: 1_200_000,
      totalBytes: 2_400_000,
    });
    // Nor does a second tap start a second download.
    downloadPack(WURLITZER);
    expect(engine.downloads).toHaveLength(1);

    engine.offline = true;
    engine.downloads[0]!.resolve();
    await vi.waitFor(() => expect(getPacks()[WURLITZER]?.kind).toBe('offline-ready'));
  });

  it('tells a failed check from a failed download, and offers the download again', async () => {
    engine.failCheck = true;
    await refreshPack(WURLITZER);
    expect(getPacks()[WURLITZER]).toEqual({
      kind: 'error',
      failure: 'check',
      detail: null,
      totalBytes: 0,
    });

    engine.failCheck = false;
    await refreshPack(WURLITZER);
    downloadPack(WURLITZER);
    engine.downloads[0]!.reject(new Error('Sample download failed (404) for C4.sample'));
    await vi.waitFor(() =>
      expect(getPacks()[WURLITZER]).toEqual({
        kind: 'error',
        failure: 'download',
        detail: 'Sample download failed (404) for C4.sample',
        totalBytes: 0,
      }),
    );

    downloadPack(WURLITZER);
    expect(engine.downloads).toHaveLength(2);
    expect(getPacks()[WURLITZER]?.kind).toBe('downloading');
  });

  it('deletes a download and looks again', async () => {
    engine.offline = true;
    await refreshPack(WURLITZER);
    await deletePack(WURLITZER);
    expect(engine.deleted).toEqual([WURLITZER]);
    expect(getPacks()[WURLITZER]).toEqual({ kind: 'not-downloaded', totalBytes: 2_400_000 });
  });

  it('tells subscribers of each change, with a new snapshot each time', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePacks(listener);
    const before = getPacks();
    await refreshPack(WURLITZER);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPacks()).not.toBe(before);
    unsubscribe();
    await refreshPack(WURLITZER);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

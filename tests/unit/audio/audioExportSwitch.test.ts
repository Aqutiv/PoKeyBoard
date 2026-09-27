import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';

afterEach(() => {
  vi.doUnmock('@/audio/AudioEngine');
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/data/persistence');
  vi.doUnmock('@/audio/OfflineTakeRenderer');
  vi.doUnmock('@/domain/takeHash');
  vi.restoreAllMocks();
  vi.resetModules();
});

/**
 * The export service over stub storage, with an engine whose piano switch the
 * test settles by hand. Records the stamp of every take hashed and rendered.
 * Imported one module at a time: see the vitest doMock import race.
 */
async function exportService() {
  vi.resetModules();
  const engine = {
    activeInstrument: { packVersion: 'bitklavier-grand-v1' },
    settle: () => {},
    whenSwitchSettled: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          engine.settle = resolve;
        }),
    ),
  };
  const hashed: string[] = [];
  const rendered: string[] = [];
  vi.doMock('@/audio/AudioEngine', () => ({ audioEngine: engine }));
  vi.doMock('@/data/audioCacheRepository', () => ({
    getCachedAudio: vi.fn(async () => null),
    invalidateCachedAudio: vi.fn(async () => undefined),
    putCachedAudio: vi.fn(async () => undefined),
  }));
  vi.doMock('@/data/persistence', () => ({
    persistenceService: { flushSaveOrThrow: vi.fn(async () => undefined) },
  }));
  vi.doMock('@/domain/takeHash', () => ({
    computeExportHash: vi.fn(async ({ take }: { take: Take }) => {
      hashed.push(take.samplePackVersion);
      return 'hash';
    }),
  }));
  vi.doMock('@/audio/OfflineTakeRenderer', () => ({
    renderTakeForExport: vi.fn((take: Take) => {
      rendered.push(take.samplePackVersion);
      return new Promise<never>(() => undefined);
    }),
  }));
  const service = await import('@/audio/AudioExportService');
  const { useTakeStore } = await import('@/state/useTakeStore');
  return { ...service, useTakeStore, engine, hashed, rendered };
}

const notes = [{ id: 'n', midi: 60, startMs: 0, durationMs: 100, velocity: 0.7 }];
const options = {
  quality: 'share',
  includeMetronome: false,
  metronomeVolume: 0.6,
  loudness: 'normalized',
} as const;

describe('exporting while the piano is changing', () => {
  it('waits for the change, and exports as the piano that plays when the new one fails', async () => {
    const { audioExportService, ExportCancelledError, useTakeStore, engine, hashed, rendered } =
      await exportService();
    useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 100 }));
    // Read by the dialog while the Steinway was still decoding.
    const requested = useTakeStore.getState().take;
    expect(requested.samplePackVersion).toBe('bitklavier-grand-v1');

    const pending = audioExportService.exportTake(requested, options, () => undefined);
    await vi.waitFor(() => expect(engine.whenSwitchSettled).toHaveBeenCalled());
    expect(hashed).toEqual([]);

    // It could not be loaded: the engine chooses the piano still playing, and
    // persistence stamps the open take with it again.
    engine.activeInstrument = { packVersion: 'salamander-grand-v3' };
    useTakeStore.getState().stampActiveInstrument();
    engine.settle();

    await vi.waitFor(() => expect(rendered).toEqual(['salamander-grand-v3']));
    expect(hashed).toEqual(['salamander-grand-v3']);
    audioExportService.cancel();
    await expect(pending).rejects.toBeInstanceOf(ExportCancelledError);
  });

  it('exports a take that is not open as it was stored', async () => {
    const { audioExportService, ExportCancelledError, useTakeStore, engine, hashed, rendered } =
      await exportService();
    useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 100 }));
    const stored = {
      ...createEmptyTake({ notes, durationMs: 100 }),
      samplePackVersion: 'headroom-grand-v1',
    };

    const pending = audioExportService.exportTake(stored, options, () => undefined);
    await vi.waitFor(() => expect(engine.whenSwitchSettled).toHaveBeenCalled());
    engine.settle();

    await vi.waitFor(() => expect(rendered).toEqual(['headroom-grand-v1']));
    expect(hashed).toEqual(['headroom-grand-v1']);
    audioExportService.cancel();
    await expect(pending).rejects.toBeInstanceOf(ExportCancelledError);
  });
});

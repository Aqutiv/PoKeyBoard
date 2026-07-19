import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';

afterEach(() => {
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/data/persistence');
  vi.doUnmock('@/audio/OfflineTakeRenderer');
  vi.resetModules();
});

describe('audio export cancellation', () => {
  it('rejects promptly and idempotently while offline rendering is pending', async () => {
    vi.resetModules();
    vi.doMock('@/data/audioCacheRepository', () => ({
      getCachedAudio: vi.fn(async () => null),
      invalidateCachedAudio: vi.fn(async () => undefined),
      putCachedAudio: vi.fn(async () => undefined),
    }));
    vi.doMock('@/data/persistence', () => ({
      persistenceService: { flushSaveOrThrow: vi.fn(async () => undefined) },
    }));
    vi.doMock('@/audio/OfflineTakeRenderer', () => ({
      renderTakeToBuffer: vi.fn(() => new Promise<AudioBuffer>(() => undefined)),
    }));

    const { audioExportService, ExportCancelledError } = await import('@/audio/AudioExportService');
    const take = createEmptyTake({
      durationMs: 100,
      notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 100, velocity: 0.7 }],
    });
    const stages: string[] = [];
    const pending = audioExportService.exportTake(
      take,
      { quality: 'share', includeMetronome: false, metronomeVolume: 0.6 },
      (progress) => stages.push(progress.stage),
    );
    await vi.waitFor(() => expect(stages).toContain('rendering'));

    audioExportService.cancel();
    audioExportService.cancel();
    await expect(pending).rejects.toBeInstanceOf(ExportCancelledError);
  });
});

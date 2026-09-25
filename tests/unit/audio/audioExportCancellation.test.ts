import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';

afterEach(() => {
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/data/persistence');
  vi.doUnmock('@/audio/OfflineTakeRenderer');
  vi.doUnmock('wasm-media-encoders');
  vi.restoreAllMocks();
  vi.resetModules();
});

/** The export service over stub storage, with `render` standing in for the offline render. */
async function exportService(render: () => Promise<unknown>) {
  vi.resetModules();
  vi.doMock('@/data/audioCacheRepository', () => ({
    getCachedAudio: vi.fn(async () => null),
    invalidateCachedAudio: vi.fn(async () => undefined),
    putCachedAudio: vi.fn(async () => undefined),
  }));
  vi.doMock('@/data/persistence', () => ({
    persistenceService: { flushSaveOrThrow: vi.fn(async () => undefined) },
  }));
  vi.doMock('@/audio/OfflineTakeRenderer', () => ({ renderTakeForExport: vi.fn(render) }));
  return import('@/audio/AudioExportService');
}

const take = createEmptyTake({
  durationMs: 100,
  notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 100, velocity: 0.7 }],
});

const options = {
  quality: 'share',
  includeMetronome: false,
  metronomeVolume: 0.6,
  loudness: 'normalized',
} as const;

describe('audio export cancellation', () => {
  it('rejects promptly and idempotently while offline rendering is pending', async () => {
    const { audioExportService, ExportCancelledError } = await exportService(
      () => new Promise<never>(() => undefined),
    );
    const stages: string[] = [];
    const pending = audioExportService.exportTake(take, options, (progress) =>
      stages.push(progress.stage),
    );
    await vi.waitFor(() => expect(stages).toContain('rendering'));

    audioExportService.cancel();
    audioExportService.cancel();
    await expect(pending).rejects.toBeInstanceOf(ExportCancelledError);
  });

  it('stops mastering on the main thread when cancelled, before the encoder starts', async () => {
    // Two minutes of a tone at 48 kHz: far longer to master than one slice.
    const length = 48_000 * 120;
    const tone = Float32Array.from({ length }, (_, i) => 0.1 * Math.sin(i / 7));
    const piano = {
      length,
      sampleRate: 48_000,
      numberOfChannels: 2,
      duration: length / 48_000,
      copyFromChannel: (destination: Float32Array) => destination.set(tone),
    };
    const createMp3Encoder = vi.fn(async () => ({
      configure: vi.fn(),
      encode: vi.fn(() => new Uint8Array(0)),
      finalize: vi.fn(() => new Uint8Array(0)),
    }));
    vi.doMock('wasm-media-encoders', () => ({ createMp3Encoder }));
    // There is no Worker here, so the export falls back to the main thread, and
    // says so.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { audioExportService, ExportCancelledError } = await exportService(async () => ({
      piano,
      clicks: null,
    }));

    let cancelling = false;
    const pending = audioExportService.exportTake(take, options, (progress) => {
      if (progress.stage !== 'encoding' || cancelling) return;
      cancelling = true;
      // Cancel the way a click would: as a task of its own, which the page can
      // only run once the mastering lets it.
      setTimeout(() => audioExportService.cancel(), 0);
    });

    await expect(pending).rejects.toBeInstanceOf(ExportCancelledError);
    expect(createMp3Encoder).not.toHaveBeenCalled();
  });
});

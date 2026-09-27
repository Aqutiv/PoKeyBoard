import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioCacheRow } from '@/data/db';
import { createEmptyTake } from '@/domain/noteEvents';
import { computeExportHash } from '@/domain/takeHash';

/**
 * An export takes the Tone follows touch setting in its options, renders with
 * it and keys its cached file by it: an MP3 made with the tone on is handed out
 * again while it stays on, and never once it is off.
 */

afterEach(() => {
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/data/persistence');
  vi.doUnmock('@/audio/OfflineTakeRenderer');
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Stops an export once it has asked for a render, so no encoder is needed. */
class RenderAskedFor extends Error {}

/** The export service over a stubbed cache, its render stopping the export. */
async function exportService() {
  vi.resetModules();
  const getCachedAudio = vi.fn<(takeId: string) => Promise<AudioCacheRow | null>>(async () => null);
  const renderTakeForExport = vi.fn<
    (take: unknown, options: unknown, onProgress?: unknown) => Promise<never>
  >(async () => {
    throw new RenderAskedFor();
  });
  vi.doMock('@/data/audioCacheRepository', () => ({
    getCachedAudio,
    invalidateCachedAudio: vi.fn(async () => undefined),
    putCachedAudio: vi.fn(async () => undefined),
  }));
  vi.doMock('@/data/persistence', () => ({
    persistenceService: { flushSaveOrThrow: vi.fn(async () => undefined) },
  }));
  vi.doMock('@/audio/OfflineTakeRenderer', () => ({ renderTakeForExport }));
  const service = await import('@/audio/AudioExportService');
  return { ...service, getCachedAudio, renderTakeForExport };
}

const take = createEmptyTake({
  durationMs: 100,
  notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 100, velocity: 0.7 }],
});

const options = {
  encoding: { format: 'mp3', kbps: 128 },
  includeMetronome: false,
  metronomeVolume: 0.6,
  loudness: 'normalized',
} as const;

/** The take's MP3 as the cache holds it, made by `exporterVersion` with the tone on. */
async function cachedWithToneOn(exporterVersion: number): Promise<AudioCacheRow> {
  return {
    takeId: take.id,
    hash: await computeExportHash({
      take,
      exporterVersion,
      bitrateKbps: 128,
      includeMetronome: false,
      metronomeVolume: 0.6,
      loudness: 'normalized',
      toneFollowsTouch: true,
    }),
    blob: new Blob([new Uint8Array(16)], { type: 'audio/mpeg' }),
    mimeType: 'audio/mpeg',
    fileName: 'take.mp3',
    createdAt: '2026-09-27T00:00:00.000Z',
  };
}

describe('an audio export and the tone', () => {
  it('hands out the MP3 cached with the tone on while it stays on', async () => {
    const { audioExportService, AUDIO_EXPORTER_VERSION, getCachedAudio, renderTakeForExport } =
      await exportService();
    getCachedAudio.mockResolvedValue(await cachedWithToneOn(AUDIO_EXPORTER_VERSION));

    const result = await audioExportService.exportTake(
      take,
      { ...options, toneFollowsTouch: true },
      () => undefined,
    );

    expect(result.fromCache).toBe(true);
    expect(renderTakeForExport).not.toHaveBeenCalled();
  });

  it('renders again with the tone off, rather than hand out the MP3 made with it on', async () => {
    const { audioExportService, AUDIO_EXPORTER_VERSION, getCachedAudio, renderTakeForExport } =
      await exportService();
    getCachedAudio.mockResolvedValue(await cachedWithToneOn(AUDIO_EXPORTER_VERSION));

    await expect(
      audioExportService.exportTake(take, { ...options, toneFollowsTouch: false }, () => undefined),
    ).rejects.toBeInstanceOf(RenderAskedFor);

    // The render is given the setting the key was worked out from.
    expect(renderTakeForExport).toHaveBeenCalledWith(
      take,
      { includeMetronome: false, metronomeVolume: 0.6, toneFollowsTouch: false },
      expect.any(Function),
    );
  });
});

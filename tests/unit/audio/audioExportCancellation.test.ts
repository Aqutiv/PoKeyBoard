import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportProgress } from '@/audio/AudioExportService';
import { createEmptyTake } from '@/domain/noteEvents';

afterEach(() => {
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/data/persistence');
  vi.doUnmock('@/audio/OfflineTakeRenderer');
  vi.doUnmock('wasm-media-encoders');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** The export service over stub storage, with `render` standing in for the offline render. */
async function exportService(
  render: (
    take: unknown,
    options: unknown,
    onProgress?: (fraction: number) => void,
  ) => Promise<unknown>,
) {
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
  encoding: { format: 'mp3', kbps: 128 },
  includeMetronome: false,
  metronomeVolume: 0.6,
  loudness: 'normalized',
  toneFollowsTouch: true,
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
    const createEncoder = vi.fn(async () => ({
      configure: vi.fn(),
      encode: vi.fn(() => new Uint8Array(0)),
      finalize: vi.fn(() => new Uint8Array(0)),
    }));
    vi.doMock('wasm-media-encoders', () => ({ createEncoder }));
    // There is no Worker here, so the export falls back to the main thread, and
    // says so.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { audioExportService, ExportCancelledError } = await exportService(async () => ({
      piano,
      clicks: null,
      standIns: 0,
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
    expect(createEncoder).not.toHaveBeenCalled();
  });

  it('hears a render out while its export lasts, and never after', async () => {
    let renderProgress: ((fraction: number) => void) | undefined;
    const { audioExportService, ExportCancelledError } = await exportService(
      (_take, _options, onProgress) => {
        renderProgress = onProgress;
        return new Promise<never>(() => undefined);
      },
    );
    const heard: ExportProgress[] = [];
    const first = audioExportService.exportTake(take, options, (progress) => heard.push(progress));
    await vi.waitFor(() => expect(renderProgress).toBeDefined());
    const cancelledRender = renderProgress!;
    cancelledRender(0.25);
    expect(heard.at(-1)).toEqual({ stage: 'rendering', fraction: 0.25 });

    // A cancelled render runs on to its end, still pausing and reporting.
    audioExportService.cancel();
    await expect(first).rejects.toBeInstanceOf(ExportCancelledError);
    const heardBefore = heard.length;
    cancelledRender(0.5);
    expect(heard).toHaveLength(heardBefore);

    // Nor does it reach the bar of the export that comes next.
    const next: ExportProgress[] = [];
    const second = audioExportService.exportTake(take, options, (progress) => next.push(progress));
    await vi.waitFor(() => expect(renderProgress).not.toBe(cancelledRender));
    cancelledRender(0.75);
    renderProgress!(0.1);
    expect(next.filter((progress) => progress.fraction >= 0)).toEqual([
      { stage: 'rendering', fraction: 0.1 },
    ]);
    audioExportService.cancel();
    await expect(second).rejects.toBeInstanceOf(ExportCancelledError);
  });
});

describe('audio export progress', () => {
  /** What a render hands the encoder: `seconds` of a quiet tone. */
  function renderedTone(seconds: number) {
    const length = 48_000 * seconds;
    const tone = Float32Array.from({ length }, (_, i) => 0.1 * Math.sin(i / 7));
    return {
      piano: {
        length,
        sampleRate: 48_000,
        numberOfChannels: 2,
        duration: seconds,
        copyFromChannel: (destination: Float32Array) => destination.set(tone),
      },
      clicks: null,
      standIns: 0,
    };
  }

  /** An encoder that says nothing until it hands over a plausibly sized file. */
  function stubEncoder() {
    vi.doMock('wasm-media-encoders', () => ({
      createEncoder: async () => ({
        configure: vi.fn(),
        encode: vi.fn(() => new Uint8Array(0)),
        finalize: vi.fn(() => new Uint8Array(20_000)),
      }),
    }));
    // The main thread, falling back from the worker, says so.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  }

  const fractionsOf = (heard: ExportProgress[], stage: ExportProgress['stage']) =>
    heard.filter((progress) => progress.stage === stage).map((progress) => progress.fraction);

  it('fills the render’s bar before compressing starts, however short of it the last pause fell', async () => {
    stubEncoder();
    const { audioExportService } = await exportService(async (_take, _options, onProgress) => {
      onProgress?.(0.4);
      return renderedTone(2);
    });
    const heard: ExportProgress[] = [];
    await audioExportService.exportTake(take, options, (progress) => heard.push(progress));
    expect(fractionsOf(heard, 'rendering')).toEqual([-1, 0.4, 1]);
    const lastOfRender = heard.findIndex((p) => p.stage === 'rendering' && p.fraction === 1);
    expect(heard[lastOfRender + 1]).toEqual({ stage: 'encoding', fraction: 0 });
    expect(fractionsOf(heard, 'encoding').at(-1)).toBe(1);
  });

  it('holds the compress bar where the worker left it while the main thread starts over', async () => {
    stubEncoder();
    // A worker that masters, says how far it got, and dies before encoding.
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: { message: string }) => void) | null = null;
        postMessage() {
          queueMicrotask(() => {
            this.onmessage?.({ data: { type: 'progress', fraction: 0.15 } });
            this.onerror?.({ message: 'worker died' });
          });
        }
        terminate() {}
      },
    );
    const { audioExportService } = await exportService(async () => renderedTone(2));
    const heard: ExportProgress[] = [];
    await audioExportService.exportTake(take, options, (progress) => heard.push(progress));
    const compressing = fractionsOf(heard, 'encoding');
    expect(compressing.slice(0, 2)).toEqual([0, 0.15]);
    expect(compressing.every((fraction, i) => i === 0 || fraction > compressing[i - 1]!)).toBe(
      true,
    );
    expect(compressing.at(-1)).toBe(1);
  });
});

describe('audio export formats', () => {
  /**
   * The service over storage whose cache calls are kept, rendering `seconds`
   * of a quiet tone, `standIns` of its notes from a stand-in.
   */
  async function service(seconds: number, standIns = 0) {
    vi.resetModules();
    const cache = {
      getCachedAudio: vi.fn(async () => null),
      invalidateCachedAudio: vi.fn(async () => undefined),
      putCachedAudio: vi.fn(async () => undefined),
    };
    vi.doMock('@/data/audioCacheRepository', () => cache);
    vi.doMock('@/data/persistence', () => ({
      persistenceService: { flushSaveOrThrow: vi.fn(async () => undefined) },
    }));
    const length = 48_000 * seconds;
    const tone = Float32Array.from({ length }, (_, i) => 0.1 * Math.sin(i / 7));
    vi.doMock('@/audio/OfflineTakeRenderer', () => ({
      renderTakeForExport: vi.fn(async () => ({
        piano: {
          length,
          sampleRate: 48_000,
          numberOfChannels: 2,
          duration: seconds,
          copyFromChannel: (destination: Float32Array) => destination.set(tone),
        },
        clicks: null,
        standIns,
      })),
    }));
    vi.doMock('wasm-media-encoders', () => ({
      createEncoder: async () => ({
        configure: vi.fn(),
        encode: vi.fn(() => new Uint8Array(0)),
        finalize: vi.fn(() => new Uint8Array(20_000)),
      }),
    }));
    // The main thread, falling back from the worker jsdom lacks, says so.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const module = await import('@/audio/AudioExportService');
    return { ...module, cache, length };
  }

  const titled = createEmptyTake({
    title: 'Évening',
    durationMs: 100,
    notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 100, velocity: 0.7 }],
  });

  it('writes FLAC without reading or filling the MP3 cache, tagged and named for it', async () => {
    const { audioExportService, cache, length } = await service(2);
    const result = await audioExportService.exportTake(
      titled,
      { ...options, encoding: { format: 'flac', bits: 24 } },
      () => undefined,
    );
    expect(cache.getCachedAudio).not.toHaveBeenCalled();
    expect(cache.putCachedAudio).not.toHaveBeenCalled();
    expect(result).toMatchObject({ format: 'flac', fromCache: false, cached: false });
    expect(result.fileName).toMatch(/^PoKeyBoard - Évening \(.+\)\.flac$/);
    expect(result.blob.type).toBe('audio/flac');
    expect(result.sizeBytes).toBe(result.blob.size);

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const { readFlacStreamInfo } = await import('@/audio/flacEncode');
    expect(readFlacStreamInfo(bytes)).toMatchObject({
      onlyBlock: false,
      bits: 24,
      totalSamples: length,
    });
    // Then the tags, the last metadata block, naming the take in UTF-8.
    expect(bytes[42]).toBe(0x84);
    expect(new TextDecoder().decode(bytes.subarray(42, 200))).toContain('TITLE=Évening');
  });

  it('caches an MP3 as before, and hands it over behind its ID3 tag', async () => {
    const { audioExportService, cache } = await service(2);
    const result = await audioExportService.exportTake(titled, options, () => undefined);
    expect(cache.getCachedAudio).toHaveBeenCalledOnce();
    expect(cache.putCachedAudio).toHaveBeenCalledOnce();
    expect(cache.putCachedAudio).toHaveBeenCalledWith(
      expect.objectContaining({ takeId: titled.id, mimeType: 'audio/mpeg' }),
    );
    expect(result).toMatchObject({ format: 'mp3', fromCache: false, cached: true });
    expect(result.fileName).toMatch(/\.mp3$/);
    const head = new Uint8Array(await result.blob.slice(0, 3).arrayBuffer());
    expect(new TextDecoder().decode(head)).toBe('ID3');
  });

  it('hands over, but does not keep, an MP3 some of whose notes played from a stand-in', async () => {
    // A pianissimo recording out of reach — offline, say — and the soft one in
    // its place: kept, the file would be found again by the same hash long
    // after the real recording arrived.
    const { audioExportService, cache } = await service(2, 3);
    const result = await audioExportService.exportTake(titled, options, () => undefined);
    expect(cache.putCachedAudio).not.toHaveBeenCalled();
    expect(result).toMatchObject({ format: 'mp3', fromCache: false, cached: false });
    const head = new Uint8Array(await result.blob.slice(0, 3).arrayBuffer());
    expect(new TextDecoder().decode(head)).toBe('ID3');
  });
});

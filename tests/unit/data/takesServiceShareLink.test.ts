import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { encodeTakeLink } from '@/domain/takeLink';

const SENDER_ID = 'b2ce1f0e-45c1-4b3a-8a4e-3b1936b25c01';

/** A take link's payload split as the address bar carries it. */
function takeLinkParts(): { version: number; data: string } {
  const payload = encodeTakeLink(
    createEmptyTake({
      id: SENDER_ID,
      title: 'Linked take',
      notes: [
        { id: 'n1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
        { id: 'n2', midi: 64, startMs: 500, durationMs: 400, velocity: 0.7 },
      ],
    }),
  );
  const dot = payload.indexOf('.');
  return { version: Number(payload.slice(0, dot)), data: payload.slice(dot + 1) };
}

const takeExists = vi.fn<(id: string) => Promise<boolean>>();

async function loadService() {
  vi.doMock('@/data/takeRepository', () => ({
    deleteTake: vi.fn(),
    duplicateTake: vi.fn(),
    getAllTakesForBackup: vi.fn(),
    getTake: vi.fn(async () => null),
    renameTake: vi.fn(),
    saveTake: vi.fn(async () => undefined),
    takeExists: (id: string) => takeExists(id),
  }));
  vi.doMock('@/data/metadataRepository', () => ({
    META_LAST_OPEN_TAKE: 'lastOpenTakeId',
    META_PERSIST_REQUESTED: 'persistentStorageRequested',
    getMetadata: vi.fn(async () => undefined),
    setMetadata: vi.fn(async () => undefined),
  }));
  vi.doMock('@/data/audioCacheRepository', () => ({
    invalidateCachedAudio: vi.fn(async () => undefined),
  }));
  vi.doMock('@/audio/AudioEngine', () => ({
    audioEngine: { allNotesOff: vi.fn(), setMasterVolume: vi.fn(), setReverbMix: vi.fn() },
  }));
  vi.doMock('@/features/transport/transportController', () => ({
    transportController: { handleInterruption: vi.fn(), restorePlayhead: vi.fn() },
  }));
  vi.doMock('@/features/notation/scrubController', () => ({
    scrubController: { isActive: false, end: vi.fn() },
  }));
  // One import at a time, and the error classes from the same module graph as
  // the service (see takesServiceImportUrl.test.ts).
  const service = await import('@/features/takes/takesService');
  const errors = await import('@/utils/errors');
  return { ...service, ...errors };
}

beforeEach(() => {
  vi.resetModules();
  takeExists.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('@/data/takeRepository');
  vi.doUnmock('@/data/metadataRepository');
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/audio/AudioEngine');
  vi.doUnmock('@/features/transport/transportController');
  vi.doUnmock('@/features/notation/scrubController');
  vi.resetModules();
  takeExists.mockReset();
});

describe('previewTakeLink', () => {
  it('previews the take a link carries, under the sender’s id', async () => {
    const { previewTakeLink } = await loadService();
    const { version, data } = takeLinkParts();

    const preview = await previewTakeLink(version, data);

    expect(preview.parsed.take.title).toBe('Linked take');
    expect(preview.parsed.take.id).toBe(SENDER_ID);
    expect(preview.parsed.take.notes).toHaveLength(2);
    expect(preview.parsed.repairs).toEqual([]);
    expect(preview.collision).toBe(false);
    expect(takeExists).toHaveBeenCalledWith(SENDER_ID);
  });

  it('offers to replace the copy a link opened before', async () => {
    takeExists.mockResolvedValue(true);
    const { previewTakeLink } = await loadService();
    const { version, data } = takeLinkParts();

    expect((await previewTakeLink(version, data)).collision).toBe(true);
  });

  it('refuses a damaged link and one from a newer version, as ShareLinkError', async () => {
    const { previewTakeLink, ShareLinkError } = await loadService();
    const { data } = takeLinkParts();

    await expect(previewTakeLink(1, data.slice(0, -6))).rejects.toMatchObject({
      constructor: ShareLinkError,
      messageKey: 'shareLinkInvalid',
    });
    await expect(previewTakeLink(2, data)).rejects.toMatchObject({
      constructor: ShareLinkError,
      messageKey: 'shareLinkNewer',
    });
    expect(takeExists).not.toHaveBeenCalled();
  });
});

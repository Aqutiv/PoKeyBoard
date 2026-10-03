import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { encodeTakeLink } from '@/domain/takeLink';
import type { NoteEvent } from '@/domain/takeTypes';
import { xorshift32 } from '@/utils/random';

const SENDER_ID = 'b2ce1f0e-45c1-4b3a-8a4e-3b1936b25c01';

/** A recording long enough that its link runs past 30,000 characters. */
function longTakePayload(noteCount: number): string {
  const random = xorshift32(31);
  const notes: NoteEvent[] = [];
  let at = 0;
  for (let index = 0; index < noteCount; index += 1) {
    at += Math.floor(random() * 400);
    notes.push({
      id: `n${index}`,
      midi: 36 + Math.floor(random() * 60),
      startMs: at,
      durationMs: 60 + Math.floor(random() * 1100),
      velocity: random(),
    });
  }
  return encodeTakeLink(createEmptyTake({ id: SENDER_ID, title: 'A long evening', notes }));
}

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
  window.history.replaceState(null, '', '/');
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

// The Takes page's link dialog and a dropped link both go through this.
describe('previewImportLink', () => {
  it('previews a 30,000-character take link of ours, on any host, fetching nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { previewImportLink } = await loadService();
    const link = `https://elsewhere.example/pokeyboard/#/s/${longTakePayload(4_500)}`;
    // Far past the 2,048 characters a link to download may be.
    expect(link.length).toBeGreaterThan(30_000);

    const preview = await previewImportLink(link);

    expect(preview?.parsed.take.title).toBe('A long evening');
    expect(preview?.parsed.take.notes).toHaveLength(4_500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hands a library link to the address bar, for the shell to open', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { previewImportLink } = await loadService();

    expect(await previewImportLink('  https://pokeyboard.example/#/lib/fur-elise\n')).toBeNull();
    expect(window.location.hash).toBe('#/lib/fur-elise');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says a damaged link of ours is damaged, fetching nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { previewImportLink } = await loadService();

    await expect(previewImportLink('https://pokeyboard.example/#/s/1.A*b')).rejects.toMatchObject({
      messageKey: 'shareLinkInvalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads any other link, as a pasted link always has', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const { previewImportLink } = await loadService();

    await expect(previewImportLink('https://example.org/score.mxl')).rejects.toMatchObject({
      messageKey: 'importUrlBlocked',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    // And the 2,048-character cap still holds for a link that is not ours.
    await expect(
      previewImportLink(`https://example.org/${'a'.repeat(2_100)}.mxl`),
    ).rejects.toMatchObject({ messageKey: 'importUrlInvalid' });
  });
});

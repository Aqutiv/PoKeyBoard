import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLibraryTakeId, libraryTakeId } from '@/domain/libraryTakes';
import { resolveLibraryTake } from '@/features/library/catalog';
import { CLASSIC_SCORES } from '@/features/library/classicsManifest';
import { CLASSIC_SCORE_NAMES } from '@/features/library/classicsNames';
import { isClassicScoreId, loadClassicTake, SCORE_PACK_PATH } from '@/features/library/scoreLoader';

const PACK_DIR = path.resolve(process.cwd(), 'public', SCORE_PACK_PATH);
// A short one, so the test parses a real vendored score without the cost of
// the five-minute ones.
const SAMPLE = CLASSIC_SCORES.reduce((shortest, entry) =>
  entry.noteCount < shortest.noteCount ? entry : shortest,
);

/** Serve the vendored pack off disk, standing in for the network. */
function stubFetch(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: string) => {
    const file = path.basename(new URL(input, 'http://localhost/').pathname);
    const bytes = await readFile(path.join(PACK_DIR, decodeURIComponent(file)));
    return new Response(new Uint8Array(bytes), { status: 200 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadClassicTake', () => {
  it('stamps a parsed score into a library take', async () => {
    stubFetch();
    const take = await loadClassicTake(SAMPLE.trackId);

    expect(take?.id).toBe(libraryTakeId(SAMPLE.trackId));
    expect(isLibraryTakeId(take?.id ?? '')).toBe(true);
    expect(take?.title).toBe(CLASSIC_SCORE_NAMES[SAMPLE.trackId]?.title);
    expect(take?.notes).toHaveLength(SAMPLE.noteCount);
    expect(take?.durationMs).toBe(SAMPLE.durationMs);
    // Frozen, so the take is not mistaken for something the user just made.
    expect(take?.createdAt).toBe(take?.updatedAt);
    expect(new Date(take?.createdAt ?? '').getTime()).toBeLessThan(Date.now());
    // Deterministic ids: musicXmlToTake hands out random ones per note.
    expect(take?.notes.map((note) => note.id).slice(0, 3)).toEqual([
      `${SAMPLE.trackId}-n0`,
      `${SAMPLE.trackId}-n1`,
      `${SAMPLE.trackId}-n2`,
    ]);
  });

  it('returns an equal but separate take each time, fetching only once', async () => {
    const spy = stubFetch();
    const first = await loadClassicTake(SAMPLE.trackId);
    const callsAfterFirst = spy.mock.calls.length;
    const second = await loadClassicTake(SAMPLE.trackId);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second?.notes[0]).not.toBe(first?.notes[0]);
    // The session cache means a re-open costs no second download.
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('knows which ids it owns, and reports an unreachable score', async () => {
    expect(isClassicScoreId(SAMPLE.trackId)).toBe(true);
    expect(isClassicScoreId('a-beautiful-day')).toBe(false);
    expect(await loadClassicTake('not-a-score')).toBeUndefined();

    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    // A different id, so the cache from earlier tests cannot answer it.
    const other = CLASSIC_SCORES.find((entry) => entry.trackId !== SAMPLE.trackId);
    await expect(loadClassicTake(other?.trackId ?? '')).rejects.toThrow(/could not be fetched/);
  });
});

describe('resolveLibraryTake', () => {
  it('builds authored tracks without touching the network', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('authored tracks must not be fetched');
    });
    const take = await resolveLibraryTake(libraryTakeId('a-beautiful-day'));
    expect(take?.title).toBe('A Beautiful Day');
  });

  it('resolves vendored scores and ignores ids from neither source', async () => {
    stubFetch();
    const take = await resolveLibraryTake(libraryTakeId(SAMPLE.trackId));
    expect(take?.id).toBe(libraryTakeId(SAMPLE.trackId));
    expect(await resolveLibraryTake('library:nothing-of-the-sort')).toBeUndefined();
    expect(await resolveLibraryTake('not-a-library-id')).toBeUndefined();
  });
});

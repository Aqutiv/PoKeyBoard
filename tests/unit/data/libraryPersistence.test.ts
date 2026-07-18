import { beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryTakeId } from '@/domain/libraryTakes';
import { createEmptyTake } from '@/domain/noteEvents';
import { saveTake } from '@/data/takeRepository';

/**
 * The persistence singleton can only `init()` once per module instance, so
 * each test that exercises restore pulls a fresh module graph. All graphs
 * share the same fake-indexeddb backing store.
 */
async function freshGraph() {
  vi.resetModules();
  const [persistence, takeStore, data, metadata] = await Promise.all([
    import('@/data/persistence'),
    import('@/state/useTakeStore'),
    import('@/data/db'),
    import('@/data/metadataRepository'),
  ]);
  await data.db.takes.clear();
  await data.db.settings.clear();
  await data.db.metadata.clear();
  return {
    persistenceService: persistence.persistenceService,
    useTakeStore: takeStore.useTakeStore,
    db: data.db,
    setMetadata: metadata.setMetadata,
    metaLastOpen: metadata.META_LAST_OPEN_TAKE,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('saveTake hardening', () => {
  it('refuses to persist a take wearing a library id', async () => {
    const forged = createEmptyTake({ id: libraryTakeId('fur-elise') });
    await expect(saveTake(forged)).rejects.toThrow(/library take/);
  });
});

describe('flushSave library guard', () => {
  it('never writes a dirty library take or repoints last-open metadata', async () => {
    const g = await freshGraph();
    const { getLibraryTake } = await import('@/features/library/catalog');
    const take = getLibraryTake(libraryTakeId('fur-elise'));
    expect(take).toBeDefined();
    if (!take) return;

    g.useTakeStore.getState().setTake(take, { dirty: true });
    await g.persistenceService.flushSave();

    expect(await g.db.takes.count()).toBe(0);
    expect(await g.db.metadata.get(g.metaLastOpen)).toBeUndefined();
    // A dirty user take still saves through the same path.
    g.useTakeStore.getState().setTake(createEmptyTake({ title: 'Mine' }), { dirty: true });
    await g.persistenceService.flushSave();
    expect(await g.db.takes.count()).toBe(1);
  });
});

describe('startup restore of library takes', () => {
  it('rebuilds a pristine library take from the catalog', async () => {
    const g = await freshGraph();
    const id = libraryTakeId('gymnopedie-1');
    await g.setMetadata(g.metaLastOpen, id);

    await g.persistenceService.init();

    const active = g.useTakeStore.getState().take;
    expect(active.id).toBe(id);
    expect(active.title).toBe('Gymnopédie No. 1');
    expect(active.notes.length).toBeGreaterThan(0);
    expect(g.useTakeStore.getState().dirty).toBe(false);
  });

  it('falls back to an empty take when the catalog entry is gone', async () => {
    const g = await freshGraph();
    await g.setMetadata(g.metaLastOpen, 'library:retired-track');

    await g.persistenceService.init();

    const active = g.useTakeStore.getState().take;
    expect(active.id).not.toBe('library:retired-track');
    expect(active.notes).toHaveLength(0);
  });
});

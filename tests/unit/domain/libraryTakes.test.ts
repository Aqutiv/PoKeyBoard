import { describe, expect, it } from 'vitest';
import {
  ensureNotLibraryTake,
  forkLibraryTake,
  isLibraryTakeId,
  LIBRARY_ID_PREFIX,
  libraryTakeId,
} from '@/domain/libraryTakes';
import { createEmptyTake } from '@/domain/noteEvents';

describe('library take ids', () => {
  it('builds and recognizes library ids', () => {
    const id = libraryTakeId('fur-elise');
    expect(id).toBe(`${LIBRARY_ID_PREFIX}fur-elise`);
    expect(isLibraryTakeId(id)).toBe(true);
  });

  it('does not flag ordinary uuids', () => {
    expect(isLibraryTakeId(createEmptyTake().id)).toBe(false);
    expect(isLibraryTakeId('')).toBe(false);
  });
});

describe('forkLibraryTake', () => {
  it('assigns a fresh user id and new timestamps, keeping title and content', () => {
    const source = createEmptyTake({
      id: libraryTakeId('blues-in-c'),
      title: 'Blues Bass in C',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    });
    const fork = forkLibraryTake(source);
    expect(fork.id).not.toBe(source.id);
    expect(isLibraryTakeId(fork.id)).toBe(false);
    expect(fork.title).toBe('Blues Bass in C');
    expect(fork.notes).toEqual(source.notes);
    expect(fork.tempo).toEqual(source.tempo);
    expect(fork.createdAt).not.toBe(source.createdAt);
    expect(fork.updatedAt).not.toBe(source.updatedAt);
  });
});

describe('ensureNotLibraryTake', () => {
  it('reassigns library ids so imports cannot masquerade as built-ins', () => {
    const forged = createEmptyTake({ id: libraryTakeId('fur-elise') });
    const laundered = ensureNotLibraryTake(forged);
    expect(isLibraryTakeId(laundered.id)).toBe(false);
    expect(laundered.title).toBe(forged.title);
  });

  it('returns user takes unchanged', () => {
    const user = createEmptyTake();
    expect(ensureNotLibraryTake(user)).toBe(user);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_FOLDER_IDS } from '@/features/library/folders';
import { readLibraryScroll, rememberLibraryScroll } from '@/features/library/scrollMemory';

describe('library scroll memory', () => {
  beforeEach(() => {
    for (const id of LIBRARY_FOLDER_IDS) rememberLibraryScroll(id, 0);
  });

  it('starts every folder at the top', () => {
    for (const id of LIBRARY_FOLDER_IDS) expect(readLibraryScroll(id)).toBe(0);
  });

  it('reads back what was remembered', () => {
    rememberLibraryScroll('classics', 420);
    expect(readLibraryScroll('classics')).toBe(420);

    rememberLibraryScroll('classics', 0);
    expect(readLibraryScroll('classics')).toBe(0);
  });

  it('keeps a separate place per folder', () => {
    rememberLibraryScroll('classics', 420);
    expect(readLibraryScroll('originals')).toBe(0);

    rememberLibraryScroll('originals', 12);
    expect(readLibraryScroll('classics')).toBe(420);
  });
});

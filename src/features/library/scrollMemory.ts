import { LIBRARY_FOLDER_IDS, type LibraryFolderId } from './folders';

/**
 * Where the user had scrolled each library folder to. Opening a track routes to
 * Play and unmounts the page, so without this the 63-track Classics list starts
 * from the top every time they come back.
 *
 * Module state, not a store: scrolling fires continuously and nothing needs to
 * re-render on it. It lives as long as the tab does, so a reload starts fresh.
 */
const scrollTops: Record<LibraryFolderId, number> = Object.fromEntries(
  LIBRARY_FOLDER_IDS.map((id) => [id, 0]),
) as Record<LibraryFolderId, number>;

export function rememberLibraryScroll(folder: LibraryFolderId, top: number): void {
  scrollTops[folder] = top;
}

export function readLibraryScroll(folder: LibraryFolderId): number {
  return scrollTops[folder];
}

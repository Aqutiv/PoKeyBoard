/**
 * Library folders, in tab order. This module must stay free of track imports:
 * the settings store and its repository take the id type from here, and pulling
 * the catalog in would drag every track module into the boot bundle.
 */
export const LIBRARY_FOLDER_IDS = ['originals', 'classics'] as const;

export type LibraryFolderId = (typeof LIBRARY_FOLDER_IDS)[number];

export const DEFAULT_LIBRARY_FOLDER: LibraryFolderId = 'originals';

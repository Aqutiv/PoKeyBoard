import Dexie, { type EntityTable } from 'dexie';

/**
 * Row shapes. Take JSON lives in `takeJson`; the other take columns are
 * denormalized so the library list never parses (or even loads) full takes.
 * Cached export audio is a SEPARATE table so listing takes never
 * deserializes MP3 blobs.
 */
export interface TakeRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  bpm: number;
  noteCount: number;
  takeJson: string;
  revision: number;
  isDraft: 0 | 1;
}

export interface AudioCacheRow {
  takeId: string;
  hash: string;
  blob: Blob;
  mimeType: string;
  fileName: string;
  createdAt: string;
}

export interface KeyValueRow {
  key: string;
  value: unknown;
}

export const DB_NAME = 'pokeyboard';

/**
 * Dexie schema versions are the migration mechanism: each `version(n)`
 * declaration is applied exactly once per database, in order, which makes
 * upgrades idempotent by construction. Add `.version(2).stores({...})
 * .upgrade(tx => ...)` blocks here — never edit an existing version.
 */
class PoKeyBoardDatabase extends Dexie {
  takes!: EntityTable<TakeRow, 'id'>;
  audioCache!: EntityTable<AudioCacheRow, 'takeId'>;
  settings!: EntityTable<KeyValueRow, 'key'>;
  metadata!: EntityTable<KeyValueRow, 'key'>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      takes: 'id, updatedAt, isDraft',
      audioCache: 'takeId',
      settings: 'key',
      metadata: 'key',
    });
  }
}

export const db = new PoKeyBoardDatabase();

export function isQuotaError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return true;
    if ('inner' in error && (error as { inner?: Error }).inner?.name === 'QuotaExceededError') {
      return true;
    }
  }
  return false;
}

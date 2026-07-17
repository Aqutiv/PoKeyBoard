import { ImportValidationError } from '@/utils/errors';
import { CURRENT_SCHEMA_VERSION } from './takeTypes';

export type RawTakeData = Record<string, unknown>;

export interface TakeMigration {
  /** The schema version this migration upgrades from (to `from + 1`). */
  from: number;
  migrate: (data: RawTakeData) => RawTakeData;
}

/** One entry per schema-version bump. Empty while the schema is at v1. */
export const TAKE_MIGRATIONS: TakeMigration[] = [];

/**
 * Bring raw imported data up to CURRENT_SCHEMA_VERSION. A missing
 * schemaVersion is treated as v1 and left to schema validation to judge.
 * Data from a future schema version is rejected rather than guessed at.
 */
export function migrateRawTake(
  raw: unknown,
  registry: TakeMigration[] = TAKE_MIGRATIONS,
): RawTakeData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ImportValidationError(['The file does not contain a JSON object.']);
  }

  let data: RawTakeData = { ...(raw as RawTakeData) };
  let version =
    typeof data.schemaVersion === 'number' && Number.isInteger(data.schemaVersion)
      ? data.schemaVersion
      : 1;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ImportValidationError([
      `This take uses schema version ${version}, but this app supports up to ` +
        `${CURRENT_SCHEMA_VERSION}. Update PoKeyBoard to open it.`,
    ]);
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = registry.find((m) => m.from === version);
    if (!migration) {
      throw new ImportValidationError([`No migration exists from schema version ${version}.`]);
    }
    data = migration.migrate(data);
    version += 1;
    data.schemaVersion = version;
  }

  data.schemaVersion = version;
  return data;
}

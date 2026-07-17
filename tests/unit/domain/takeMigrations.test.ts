import { describe, expect, it } from 'vitest';
import { migrateRawTake, type TakeMigration } from '@/domain/takeMigrations';
import { CURRENT_SCHEMA_VERSION } from '@/domain/takeTypes';
import { ImportValidationError } from '@/utils/errors';

describe('migrateRawTake', () => {
  it('passes current-version data through unchanged', () => {
    const data = { schemaVersion: CURRENT_SCHEMA_VERSION, title: 'x' };
    const out = migrateRawTake(data);
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(out.title).toBe('x');
  });

  it('treats a missing schemaVersion as v1', () => {
    const out = migrateRawTake({ title: 'legacy' });
    expect(out.schemaVersion).toBe(1);
  });

  it('rejects data from a future schema version', () => {
    expect(() => migrateRawTake({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(
      ImportValidationError,
    );
  });

  it('applies a migration chain in order', () => {
    const registry: TakeMigration[] = [
      {
        from: 0,
        migrate: (data) => ({ ...data, upgraded: true }),
      },
    ];
    const out = migrateRawTake({ schemaVersion: 0, title: 'old' }, registry);
    expect(out.upgraded).toBe(true);
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('fails when a migration step is missing', () => {
    expect(() => migrateRawTake({ schemaVersion: 0 }, [])).toThrow(ImportValidationError);
  });

  it('rejects non-object input', () => {
    expect(() => migrateRawTake('nope')).toThrow(ImportValidationError);
    expect(() => migrateRawTake(null)).toThrow(ImportValidationError);
    expect(() => migrateRawTake([])).toThrow(ImportValidationError);
  });

  it('does not mutate the input object', () => {
    const input = { schemaVersion: 0, title: 'old' };
    const registry: TakeMigration[] = [{ from: 0, migrate: (d) => ({ ...d, touched: true }) }];
    migrateRawTake(input, registry);
    expect(input).toEqual({ schemaVersion: 0, title: 'old' });
  });
});

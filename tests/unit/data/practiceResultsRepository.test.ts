import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { META_PRACTICE_RESULTS, setMetadata } from '@/data/metadataRepository';
import { loadPracticeRecords, recordPracticeScore } from '@/data/practiceResultsRepository';
import { saveTake } from '@/data/takeRepository';
import { createEmptyTake } from '@/domain/noteEvents';
import { EMPTY_PRACTICE_RECORDS, type PracticeScore } from '@/features/practice/practiceRecords';
import { backupAllFile } from '@/features/takes/takesService';

const ODE = 'library:ode-to-joy-first-steps';
const ELISE = 'library:fur-elise';

function score(overrides: Partial<PracticeScore> = {}): PracticeScore {
  return {
    at: '2026-10-04T10:00:00.000Z',
    accuracy: 0.8,
    speed: 1,
    notes: 28,
    fingerprint: '28:32000',
    ...overrides,
  };
}

beforeEach(async () => {
  await db.takes.clear();
  await db.settings.clear();
  await db.metadata.clear();
});

describe('practice results repository', () => {
  it('starts empty when nothing was ever kept', async () => {
    expect(await loadPracticeRecords()).toEqual(EMPTY_PRACTICE_RECORDS);
  });

  it('round-trips a result, and says each time what the best and the last are', async () => {
    const first = score();
    expect(await recordPracticeScore(ODE, 'wait:right', first)).toEqual({
      best: first,
      last: first,
      newBest: false,
    });
    const better = score({ at: '2026-10-04T10:05:00.000Z', accuracy: 1, speed: 0.6 });
    expect(await recordPracticeScore(ODE, 'wait:right', better)).toEqual({
      best: better,
      last: better,
      newBest: true,
    });
    expect(await loadPracticeRecords()).toEqual({
      v: 1,
      tracks: { [ODE]: { 'wait:right': { best: better, last: better } } },
    });
  });

  it('keeps every one of several results written at once', async () => {
    // `setMetadata` is a blind put: read and written apart, each would write
    // over the others with the records as it found them.
    const waited = score();
    const kept = score({ onTime: 0.5 });
    const elise = score({ fingerprint: '640:120000' });
    await Promise.all([
      recordPracticeScore(ODE, 'wait:right', waited),
      recordPracticeScore(ODE, 'along:both', kept),
      recordPracticeScore(ELISE, 'wait:left', elise),
    ]);
    expect(await loadPracticeRecords()).toEqual({
      v: 1,
      tracks: {
        [ODE]: {
          'wait:right': { best: waited, last: waited },
          'along:both': { best: kept, last: kept },
        },
        [ELISE]: { 'wait:left': { best: elise, last: elise } },
      },
    });
  });

  it('reads a damaged row as far as it goes, and keeps a new result over it', async () => {
    const good = { best: score(), last: score() };
    await setMetadata(META_PRACTICE_RESULTS, {
      v: 1,
      tracks: { [ODE]: { 'wait:right': 'junk', 'wait:left': good } },
    });
    expect(await loadPracticeRecords()).toEqual({
      v: 1,
      tracks: { [ODE]: { 'wait:left': good } },
    });

    await setMetadata(META_PRACTICE_RESULTS, 'nonsense');
    expect(await loadPracticeRecords()).toEqual(EMPTY_PRACTICE_RECORDS);
    const next = score({ accuracy: 0.5 });
    expect(await recordPracticeScore(ODE, 'wait:right', next)).toMatchObject({ newBest: false });
    expect(await loadPracticeRecords()).toEqual({
      v: 1,
      tracks: { [ODE]: { 'wait:right': { best: next, last: next } } },
    });
  });
});

describe('a backup of every take', () => {
  it('carries no practice results: they stay on the device', async () => {
    await saveTake(createEmptyTake({ title: 'Scales' }));
    await recordPracticeScore(ODE, 'wait:right', score());

    const text = await (await backupAllFile()).text();
    const backup = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(backup).sort()).toEqual([
      'createdAt',
      'kind',
      'schemaVersion',
      'settings',
      'takes',
    ]);
    expect(backup.takes).toHaveLength(1);
    expect(text).not.toContain(META_PRACTICE_RESULTS);
    expect(text).not.toContain('wait:right');
    expect(text).not.toContain(ODE);
    // Still kept where it was.
    expect((await loadPracticeRecords()).tracks[ODE]).toBeDefined();
  });
});

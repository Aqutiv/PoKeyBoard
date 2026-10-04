import { describe, expect, it } from 'vitest';
import {
  chipFor,
  EMPTY_PRACTICE_RECORDS,
  headlinePercent,
  isBetter,
  isCompleteRun,
  isOwnBest,
  parsePracticeRecords,
  practiceModeKey,
  trackFingerprint,
  withScore,
  type ModeRecord,
  type PracticeRecords,
  type PracticeScore,
} from '@/features/practice/practiceRecords';
import { practiceRun } from './practiceFixtures';

const ODE = 'library:ode-to-joy-first-steps';
const ELISE = 'library:fur-elise';
/** The track as the catalog has it: 28 notes over 32 seconds. */
const SUMMARY = { noteCount: 28, durationMs: 32000 };
const FINGERPRINT = '28:32000';

/** A "wait for me" result: 90% right first time at the take's own speed. */
function waitScore(overrides: Partial<PracticeScore> = {}): PracticeScore {
  return {
    at: '2026-10-04T10:00:00.000Z',
    accuracy: 0.9,
    speed: 1,
    notes: 28,
    fingerprint: FINGERPRINT,
    ...overrides,
  };
}

/** A Keep-time result: 60% on time, 80% of the notes played. */
function keepTimeScore(overrides: Partial<PracticeScore> = {}): PracticeScore {
  return waitScore({ accuracy: 0.8, onTime: 0.6, ...overrides });
}

function records(tracks: PracticeRecords['tracks']): PracticeRecords {
  return { v: 1, tracks };
}

describe('practice records as stored', () => {
  it('keep every good entry, and drop a bad one on its own', () => {
    const good: ModeRecord = { best: waitScore(), last: waitScore({ accuracy: 0.5 }) };
    const goodKeepTime: ModeRecord = { best: keepTimeScore(), last: keepTimeScore() };
    const raw = {
      v: 1,
      tracks: {
        [ODE]: {
          'wait:right': good,
          // A share past the whole of the notes.
          'wait:left': { best: waitScore({ accuracy: 1.5 }), last: waitScore() },
          // A Keep-time result says how many notes were on time.
          'along:right': { best: waitScore(), last: waitScore() },
          'along:both': goodKeepTime,
          // No such hand, nor such a style.
          'wait:feet': good,
          'listen:right': good,
        },
        // Not a track at all, and a take of the user's, which keeps no record.
        [ELISE]: 'nonsense',
        'b7f3c2e0-0000-4000-8000-000000000001': { 'wait:right': good },
      },
    };
    expect(parsePracticeRecords(raw)).toEqual(
      records({ [ODE]: { 'wait:right': good, 'along:both': goodKeepTime } }),
    );
  });

  it('drop an entry whose best and last are of two different tracks', () => {
    const raw = records({
      [ODE]: { 'wait:right': { best: waitScore({ fingerprint: '27:31000' }), last: waitScore() } },
    });
    expect(parsePracticeRecords(raw)).toEqual(EMPTY_PRACTICE_RECORDS);
  });

  it('start empty from nothing, another version, or a record that is no record', () => {
    expect(parsePracticeRecords(undefined)).toEqual(EMPTY_PRACTICE_RECORDS);
    expect(parsePracticeRecords({ v: 2, tracks: {} })).toEqual(EMPTY_PRACTICE_RECORDS);
    expect(parsePracticeRecords({ v: 1, tracks: [] })).toEqual(EMPTY_PRACTICE_RECORDS);
    expect(parsePracticeRecords('{"v":1}')).toEqual(EMPTY_PRACTICE_RECORDS);
  });

  it('come back as they were written', () => {
    const { records: written } = withScore(
      EMPTY_PRACTICE_RECORDS,
      ODE,
      'along:left',
      keepTimeScore(),
    );
    expect(parsePracticeRecords(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });
});

describe('which result is better', () => {
  it('waiting for the player: the share right first time, then the speed', () => {
    expect(isBetter(waitScore({ accuracy: 0.95 }), waitScore(), 'wait')).toBe(true);
    expect(isBetter(waitScore(), waitScore({ accuracy: 0.95 }), 'wait')).toBe(false);
    // As right, and faster.
    expect(isBetter(waitScore({ speed: 1.25 }), waitScore(), 'wait')).toBe(true);
    expect(isBetter(waitScore({ speed: 0.6 }), waitScore(), 'wait')).toBe(false);
    // A slow perfect run stays the best until a run as perfect comes faster.
    const slowPerfect = waitScore({ accuracy: 1, speed: 0.5 });
    expect(isBetter(waitScore({ accuracy: 0.96, speed: 1 }), slowPerfect, 'wait')).toBe(false);
    expect(isBetter(waitScore({ accuracy: 1, speed: 0.6 }), slowPerfect, 'wait')).toBe(true);
  });

  it('keeping time: the share on time, then the notes played, then the speed', () => {
    expect(
      isBetter(keepTimeScore({ onTime: 0.7, accuracy: 0.5 }), keepTimeScore(), 'playAlong'),
    ).toBe(true);
    expect(isBetter(keepTimeScore({ accuracy: 0.9 }), keepTimeScore(), 'playAlong')).toBe(true);
    expect(
      isBetter(keepTimeScore({ accuracy: 0.9 }), keepTimeScore({ onTime: 0.61 }), 'playAlong'),
    ).toBe(false);
    expect(isBetter(keepTimeScore({ speed: 1.5 }), keepTimeScore(), 'playAlong')).toBe(true);
    expect(isBetter(keepTimeScore({ speed: 0.5 }), keepTimeScore(), 'playAlong')).toBe(false);
  });

  it('never a result that only equals the other', () => {
    expect(isBetter(waitScore(), waitScore(), 'wait')).toBe(false);
    expect(isBetter(keepTimeScore(), keepTimeScore(), 'playAlong')).toBe(false);
    // The same share counted out of different totals is the same share.
    expect(
      isBetter(waitScore({ accuracy: 24 / 30, notes: 30 }), waitScore({ accuracy: 0.8 }), 'wait'),
    ).toBe(false);
  });
});

describe('keeping a result', () => {
  it('makes a first result the best, but no new best', () => {
    const first = waitScore();
    const kept = withScore(EMPTY_PRACTICE_RECORDS, ODE, 'wait:right', first);
    expect(kept).toEqual({
      records: records({ [ODE]: { 'wait:right': { best: first, last: first } } }),
      best: first,
      last: first,
      newBest: false,
    });
  });

  it('makes a better result the new best', () => {
    const earlier = withScore(EMPTY_PRACTICE_RECORDS, ODE, 'wait:right', waitScore()).records;
    const better = waitScore({ at: '2026-10-04T10:05:00.000Z', accuracy: 1 });
    expect(withScore(earlier, ODE, 'wait:right', better)).toMatchObject({
      best: better,
      last: better,
      newBest: true,
    });
  });

  it('keeps the best through a worse result, or one only as good', () => {
    const best = waitScore();
    const earlier = withScore(EMPTY_PRACTICE_RECORDS, ODE, 'wait:right', best).records;
    for (const next of [
      waitScore({ accuracy: 0.5 }),
      waitScore({ at: '2026-10-05T09:00:00.000Z' }),
    ]) {
      const kept = withScore(earlier, ODE, 'wait:right', next);
      expect(kept).toMatchObject({ best, last: next, newBest: false });
      expect(kept.records.tracks[ODE]?.['wait:right']).toEqual({ best, last: next });
    }
  });

  it('starts afresh on a track whose notes have changed since its best', () => {
    const old = waitScore({ accuracy: 1, fingerprint: '27:31000' });
    const earlier = withScore(EMPTY_PRACTICE_RECORDS, ODE, 'wait:right', old).records;
    const worse = waitScore({ accuracy: 0.5 });
    // Worse than the old best, but the old best was on other notes: no measure.
    expect(withScore(earlier, ODE, 'wait:right', worse)).toMatchObject({
      best: worse,
      last: worse,
      newBest: false,
    });
  });

  it('keeps each way of practising, and each track, to itself', () => {
    let book = withScore(EMPTY_PRACTICE_RECORDS, ODE, 'wait:right', waitScore()).records;
    book = withScore(book, ELISE, 'wait:right', waitScore({ fingerprint: '200:60000' })).records;
    const kept = withScore(book, ODE, 'along:right', keepTimeScore({ accuracy: 0.2 }));
    expect(kept.newBest).toBe(false);
    expect(kept.records.tracks[ODE]?.['wait:right']).toEqual(book.tracks[ODE]?.['wait:right']);
    expect(kept.records.tracks[ELISE]).toEqual(book.tracks[ELISE]);
    // The records it was handed are left as they were.
    expect(book.tracks[ODE]?.['along:right']).toBeUndefined();
  });

  it('names each way of practising by its style and hand', () => {
    expect(practiceModeKey('wait', 'right')).toBe('wait:right');
    expect(practiceModeKey('playAlong', 'both')).toBe('along:both');
    expect(trackFingerprint(SUMMARY)).toBe(FINGERPRINT);
  });
});

describe('whether a run is its own best', () => {
  const later = '2026-10-04T10:05:00.000Z';

  it('is, for a first result or a new best', () => {
    const first = withScore(EMPTY_PRACTICE_RECORDS, ODE, 'wait:right', waitScore());
    expect(isOwnBest(first)).toBe(true);
    const better = withScore(
      first.records,
      ODE,
      'wait:right',
      waitScore({ at: later, accuracy: 1 }),
    );
    expect(isOwnBest(better)).toBe(true);
  });

  it('is not, while an earlier best stands, however near the run came to it', () => {
    const first = withScore(EMPTY_PRACTICE_RECORDS, ODE, 'wait:right', waitScore({ accuracy: 1 }));
    const worse = withScore(
      first.records,
      ODE,
      'wait:right',
      waitScore({ at: later, accuracy: 0.5 }),
    );
    expect(isOwnBest(worse)).toBe(false);
    const asGood = withScore(
      first.records,
      ODE,
      'wait:right',
      waitScore({ at: later, accuracy: 1 }),
    );
    expect(isOwnBest(asGood)).toBe(false);
  });

  it('is told by value, as a record read back from the device has to be', () => {
    const { best, last, newBest } = withScore(
      EMPTY_PRACTICE_RECORDS,
      ODE,
      'along:both',
      keepTimeScore(),
    );
    expect(isOwnBest(JSON.parse(JSON.stringify({ best, last, newBest })))).toBe(true);
  });
});

describe('a result’s headline share', () => {
  it('is right first time waiting, and on time keeping time, rounded down', () => {
    expect(headlinePercent(waitScore({ accuracy: 199 / 200, notes: 200 }), 'wait')).toBe(99);
    expect(headlinePercent(keepTimeScore({ onTime: 18 / 28 }), 'playAlong')).toBe(64);
  });

  it('is counted from the notes, never a hair under a whole percentage', () => {
    // 0.29 × 100 is 28.999… in floating point.
    expect(headlinePercent(waitScore({ accuracy: 0.29, notes: 100 }), 'wait')).toBe(29);
    expect(headlinePercent(keepTimeScore({ onTime: 0.57, notes: 100 }), 'playAlong')).toBe(57);
  });
});

describe('the Library’s chip for a track', () => {
  const at = (minutes: number) => `2026-10-04T10:${String(minutes).padStart(2, '0')}:00.000Z`;

  it('gives the best in the way practised most recently', () => {
    const waitBest = waitScore({ at: at(1), accuracy: 0.92 });
    const keepTimeBest = keepTimeScore({ at: at(2), onTime: 0.64 });
    const track = {
      'wait:right': { best: waitBest, last: waitScore({ at: at(20), accuracy: 0.4 }) },
      'along:both': { best: keepTimeBest, last: keepTimeScore({ at: at(10) }) },
    };
    expect(chipFor(track, SUMMARY)).toEqual({ mode: 'wait:right', best: waitBest });

    track['along:both'].last = keepTimeScore({ at: at(30) });
    expect(chipFor(track, SUMMARY)).toEqual({ mode: 'along:both', best: keepTimeBest });
  });

  it('passes over a way practised on the track before its notes changed', () => {
    const stale = waitScore({ at: at(30), fingerprint: '27:31000' });
    const waitBest = waitScore({ at: at(5) });
    const track = {
      'wait:left': { best: stale, last: stale },
      'wait:right': { best: waitBest, last: waitBest },
    };
    expect(chipFor(track, SUMMARY)).toEqual({ mode: 'wait:right', best: waitBest });
    expect(chipFor({ 'wait:left': { best: stale, last: stale } }, SUMMARY)).toBeNull();
  });

  it('shows nothing for a track never practised through', () => {
    expect(chipFor(undefined, SUMMARY)).toBeNull();
    expect(chipFor({}, SUMMARY)).toBeNull();
  });
});

describe('a complete run', () => {
  const asked = [
    { id: 'e', midi: 64, startMs: 500 },
    { id: 'd', midi: 62, startMs: 1000 },
  ];

  it('goes from no later than its first note to the end, round no loop', () => {
    expect(isCompleteRun(practiceRun({ asked }), 'end')).toBe(true);
    expect(isCompleteRun(practiceRun({ asked, fromMs: 500 }), 'end')).toBe(true);
  });

  it('is not one started past the first note, round a loop, or ended any other way', () => {
    expect(isCompleteRun(practiceRun({ asked, fromMs: 501 }), 'end')).toBe(false);
    expect(isCompleteRun(practiceRun({ asked, loop: { startMs: 0, endMs: 2000 } }), 'end')).toBe(
      false,
    );
    for (const reason of ['pause', 'stop', 'seek', 'loop', 'mode', 'restart'] as const) {
      expect(isCompleteRun(practiceRun({ asked }), reason)).toBe(false);
    }
  });

  it('is not one that asked for nothing', () => {
    expect(isCompleteRun(practiceRun({ asked: [] }), 'end')).toBe(false);
  });
});

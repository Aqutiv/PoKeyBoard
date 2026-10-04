import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NoteEvent, TempoSettings } from '@/domain/takeTypes';
import { createPracticeSession } from '@/features/practice/practiceSession';
import type { PracticeEvent, PracticeRun, RunEndReason } from '@/features/transport/practiceEvents';
import { usePracticeStore } from '@/state/usePracticeStore';
import { practiceRun, TEMPO } from './practiceFixtures';

/** A stand-in for a subscription: what was subscribed, and a way to send to it. */
function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe: (listener: (value: T) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    send: (value: T) => {
      for (const listener of listeners) listener(value);
    },
    get size() {
      return listeners.size;
    },
  };
}

const practice = channel<PracticeEvent>();
let session: { dispose(): void } | null = null;

/** The take open, as the session hears it. */
type OpenTake = { id: string; tempo: TempoSettings; notes: readonly NoteEvent[] };

const NOTES: readonly NoteEvent[] = [
  { id: 'n1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
  { id: 'n2', midi: 64, startMs: 500, durationMs: 400, velocity: 0.7 },
];

const takeListeners = new Set<(take: OpenTake, previous: OpenTake) => void>();
let open: OpenTake;

/** Edit the open take as the take store does, telling the session what it was before. */
function editTake(changes: Partial<OpenTake>): void {
  const previous = open;
  open = { ...open, ...changes };
  for (const listener of [...takeListeners]) listener(open, previous);
}

const start = (run: PracticeRun) => practice.send({ runId: run.runId, type: 'run-start', run });
const step = (runId: number, atMs: number) =>
  practice.send({ runId, type: 'step', atMs, midis: [60] });
const end = (runId: number, reason: RunEndReason = 'end') =>
  practice.send({ runId, type: 'run-end', reason, audioTime: null });

/** A "wait for me" run that plays `steps` steps and ends. */
function playRun(runId: number, steps: number, overrides: Partial<PracticeRun> = {}): void {
  start(practiceRun({ runId, ...overrides }));
  for (let index = 0; index < steps; index += 1) step(runId, index * 500);
  end(runId);
}

const store = () => usePracticeStore.getState();

beforeEach(() => {
  usePracticeStore.setState({ result: null, live: null, latestRunId: null });
  open = { id: 'take', tempo: TEMPO, notes: NOTES };
  session = createPracticeSession({
    subscribePractice: practice.subscribe,
    subscribeTake: (listener) => {
      takeListeners.add(listener);
      return () => void takeListeners.delete(listener);
    },
    store: usePracticeStore.getState(),
  });
});

afterEach(() => {
  session?.dispose();
  session = null;
});

describe('the practice session', () => {
  it('shows how a "wait for me" run went once it ends', () => {
    start(practiceRun({ runId: 3, takeId: 'scale', hand: 'left', speed: 0.6 }));
    expect(store().live).toEqual({ runId: 3, takeId: 'scale', style: 'wait' });
    step(3, 0);
    step(3, 500);
    expect(store().result).toBeNull();

    end(3, 'pause');
    expect(store().live).toBeNull();
    expect(store().result).toMatchObject({
      runId: 3,
      takeId: 'scale',
      style: 'wait',
      hand: 'left',
      slowestSpeed: 0.6,
      reason: 'pause',
      wait: { steps: 2, rightFirstTime: 2 },
    });
  });

  it('has nothing to show for a run of one step', () => {
    start(practiceRun({ runId: 1 }));
    expect(store().live?.runId).toBe(1);
    step(1, 0);
    end(1);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();
  });

  it('puts the card away when the next run starts', () => {
    playRun(1, 2);
    expect(store().result).not.toBeNull();

    start(practiceRun({ runId: 2 }));
    expect(store().result).toBeNull();
  });

  it('puts the card away when another take is opened', () => {
    playRun(1, 2);
    editTake({});
    expect(store().result).not.toBeNull();

    editTake({ id: 'etude', notes: [] });
    expect(store().result).toBeNull();
  });

  // A recording pass, a clear or an undo writes the take new notes: counts
  // made of the old ones no longer describe it.
  it('puts the card away when the take is given new notes', () => {
    playRun(1, 2);
    editTake({
      notes: [...NOTES, { id: 'n3', midi: 67, startMs: 1000, durationMs: 400, velocity: 0.7 }],
    });
    expect(store().result).toBeNull();
  });

  it('keeps the card through an edit that leaves the notes alone', () => {
    playRun(1, 2);
    editTake({ tempo: { ...TEMPO, countInBars: 0 } });
    expect(store().result).not.toBeNull();
  });

  // The notes stay where they are when the tempo changes, but the bar lines
  // move: the card's sections, and the steps counted in them, are bars that
  // are no longer there.
  it('puts the card away when a new tempo moves the bars it was scored on', () => {
    playRun(1, 2);
    editTake({ tempo: { ...TEMPO, bpm: 100 } });
    expect(store().result).toBeNull();
  });

  it('puts the card away when a new time signature moves its bars', () => {
    playRun(1, 2);
    editTake({ tempo: { ...TEMPO, timeSignature: { numerator: 3, denominator: 4 } } });
    expect(store().result).toBeNull();
  });

  it('puts the card away when a tempo change is marked partway through', () => {
    playRun(1, 2);
    editTake({ tempo: { ...TEMPO, changes: [{ atMs: 4000, bpm: 90 }] } });
    expect(store().result).toBeNull();
  });

  it('keeps the card through a change of count-in, or a tempo rebuilt the same', () => {
    playRun(1, 2);
    editTake({ tempo: { ...TEMPO, countInBars: 0 } });
    expect(store().result).not.toBeNull();

    // Every value the same, in objects of its own, and a key signature set.
    editTake({
      tempo: {
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        countInBars: 1,
        changes: [],
        keySignature: 2,
      },
    });
    expect(store().result).not.toBeNull();
  });

  it('ignores events from a run no longer under way', () => {
    start(practiceRun({ runId: 1 }));
    start(practiceRun({ runId: 2 }));
    // The first run's last words, arriving late.
    step(1, 0);
    step(1, 500);
    end(1);
    expect(store().result).toBeNull();
    expect(store().live?.runId).toBe(2);

    step(2, 0);
    end(2);
    // One step of its own: the first run's two were not counted toward it.
    expect(store().result).toBeNull();
  });

  it('has no card of its own for a run played along', () => {
    playRun(1, 2);
    expect(store().result).not.toBeNull();

    start(practiceRun({ runId: 2, style: 'playAlong' }));
    // Playing again puts the last card away, however the run is practised.
    expect(store().live).toEqual({ runId: 2, takeId: 'take', style: 'playAlong' });
    expect(store().result).toBeNull();
    for (let index = 0; index < 4; index += 1) step(2, index * 500);
    end(2);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();
  });

  it('stops listening once disposed', () => {
    expect(practice.size).toBe(1);
    expect(takeListeners.size).toBe(1);
    session?.dispose();
    session = null;
    expect(practice.size).toBe(0);
    expect(takeListeners.size).toBe(0);
    playRun(1, 2);
    expect(store().result).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputNoteEvent } from '@/audio/AudioEngine';
import type { NoteEvent, TempoSettings } from '@/domain/takeTypes';
import { END_GRACE_MS, type PlayAlongDeps } from '@/features/practice/playAlongSession';
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
const keys = channel<InputNoteEvent>();
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

/** The audio clock and the page's, as a Keep-time run reads them, and the keys it flashes. */
const clocks = { audio: 10, page: 5000 };
let flashed: number[] = [];

/** The engine and the transport as a Keep-time run uses them, with no output latency. */
const playAlong: PlayAlongDeps = {
  subscribeInput: keys.subscribe,
  outputLatencyMs: () => 0,
  audioTime: () => clocks.audio,
  now: () => clocks.page,
  flashWrongKey: (midi) => flashed.push(midi),
};

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
  clocks.audio = 10;
  clocks.page = 5000;
  flashed = [];
  session = createPracticeSession({
    subscribePractice: practice.subscribe,
    subscribeTake: (listener) => {
      takeListeners.add(listener);
      return () => void takeListeners.delete(listener);
    },
    store: usePracticeStore.getState(),
    playAlong,
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

  // The same edits made while a run is under way, before it has a result:
  // the run was asked on bars, or notes, the take no longer has.
  it('has no card for a run whose bars a new tempo moved under it', () => {
    start(practiceRun({ runId: 1 }));
    step(1, 0);
    step(1, 500);
    editTake({ tempo: { ...TEMPO, bpm: 100 } });
    end(1);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();

    // The next run is asked on the bars as they are now.
    playRun(2, 2, { tempo: { ...TEMPO, bpm: 100 } });
    expect(store().result?.runId).toBe(2);
  });

  it('has no card for a run whose bars a new time signature moved under it', () => {
    start(practiceRun({ runId: 1 }));
    step(1, 0);
    editTake({ tempo: { ...TEMPO, timeSignature: { numerator: 3, denominator: 4 } } });
    step(1, 500);
    end(1);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();
  });

  it('still has a card for a run whose count-in changed under it', () => {
    start(practiceRun({ runId: 1 }));
    step(1, 0);
    editTake({ tempo: { ...TEMPO, countInBars: 2 } });
    step(1, 500);
    end(1);
    expect(store().result?.runId).toBe(1);
  });

  it('has no card for a run whose take was given new notes under it', () => {
    // An Undo pass at a hold, say.
    start(practiceRun({ runId: 1 }));
    step(1, 0);
    step(1, 500);
    editTake({ notes: NOTES.slice(0, 1) });
    end(1);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();
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

  it('puts the card away for a run played along, however it is practised', () => {
    playRun(1, 2);
    expect(store().result).not.toBeNull();

    start(practiceRun({ runId: 2, style: 'playAlong' }));
    expect(store().live).toMatchObject({ runId: 2, takeId: 'take', style: 'playAlong' });
    expect(store().result).toBeNull();
    // It asked for nothing, so it has nothing to show.
    endPlayAlong(2, 'pause', 12);
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

const C4 = 60;
const D4 = 62;
const E4 = 64;

/**
 * A Keep-time run of C4, D4 and E4 half a second apart, set off at 12 s on
 * the audio clock after a bar counted in from 10: the notes fall due at 12,
 * 12.5 and 13.
 */
function keepTimeRun(runId: number, overrides: Partial<PracticeRun> = {}): PracticeRun {
  return practiceRun({
    runId,
    style: 'playAlong',
    anchorAudioTime: 12,
    countInMs: 2000,
    asked: [
      { id: 'c', midi: C4, startMs: 0 },
      { id: 'd', midi: D4, startMs: 500 },
      { id: 'e', midi: E4, startMs: 1000 },
    ],
    ...overrides,
  });
}

/** A key pressed at `audioTime`, as the engine tells it. */
function press(midi: number, audioTime: number): void {
  clocks.audio = audioTime;
  keys.send({ type: 'on', midi, velocity: 0.7, audioTime, sourceId: 'kbd' });
}

/** End a run that keeps time at `audioTime`: it says when, as such a run does. */
function endPlayAlong(runId: number, reason: RunEndReason, audioTime: number): void {
  clocks.audio = audioTime;
  practice.send({ runId, type: 'run-end', reason, audioTime });
}

describe('the practice session, keeping time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows how a Keep-time run went once it ends', () => {
    start(keepTimeRun(5, { hand: 'left' }));
    // Where a press lands on the run's start, for as long as the run lasts.
    expect(store().live).toEqual({
      runId: 5,
      takeId: 'take',
      style: 'playAlong',
      pressOriginMs: 7000,
    });
    press(C4, 12);
    press(D4, 12.55);
    endPlayAlong(5, 'pause', 13.3);
    expect(store().live).toBeNull();
    expect(store().result).toMatchObject({
      runId: 5,
      takeId: 'take',
      style: 'playAlong',
      hand: 'left',
      slowestSpeed: 1,
      reason: 'pause',
      keepTime: { notes: 3, hits: 2, onTime: 2, missed: 1, wrong: 0 },
    });
    // It listens to the keys while it lasts, and no longer.
    expect(keys.size).toBe(0);
  });

  it('flashes a key the run does not ask for, while it plays', () => {
    start(keepTimeRun(5));
    press(71, 12.3);
    expect(flashed).toEqual([71]);
  });

  it('waits for a Keep-time run’s last notes to be played late, once it plays to its end', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    press(D4, 12.5);
    endPlayAlong(5, 'end', 13.05);
    press(E4, 13.15);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();

    vi.advanceTimersByTime(END_GRACE_MS);
    expect(store().result).toMatchObject({
      runId: 5,
      reason: 'end',
      keepTime: { notes: 3, onTime: 2, late: 1 },
    });
  });

  it('has nothing to show for a Keep-time run stopped after one note', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    // D4's window was still open, and E4's not yet: C4 alone is judged.
    endPlayAlong(5, 'pause', 12.3);
    expect(store().result).toBeNull();
  });

  it('drops a Keep-time result that a newer run overtook while it waited for late notes', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    press(D4, 12.5);
    endPlayAlong(5, 'end', 13.05);
    start(practiceRun({ runId: 6 }));
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(store().result).toBeNull();
    expect(store().live?.runId).toBe(6);
  });

  it('stops listening to the keys once disposed, late notes and all', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    press(D4, 12.5);
    endPlayAlong(5, 'end', 13.05);
    expect(keys.size).toBe(1);
    session?.dispose();
    session = null;
    expect(keys.size).toBe(0);
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(store().result).toBeNull();
  });

  // A Keep-time run is held to the same rules as one that waits: its result
  // describes the take as it was, in the bars it was scored on.
  it('has no card for a Keep-time run whose bars a new tempo moved under it', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    press(D4, 12.5);
    editTake({ tempo: { ...TEMPO, bpm: 100 } });
    endPlayAlong(5, 'pause', 13.3);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();
    expect(keys.size).toBe(0);
  });

  it('has no card for a Keep-time run whose take was given new notes under it', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    press(D4, 12.5);
    editTake({ notes: NOTES.slice(0, 1) });
    endPlayAlong(5, 'pause', 13.3);
    expect(store().result).toBeNull();
  });

  it('has no card for a Keep-time run whose bars moved while it waited for its last notes', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    press(D4, 12.5);
    endPlayAlong(5, 'end', 13.05);
    // Within the grace for late notes, before there is a result to put away.
    editTake({ tempo: { ...TEMPO, timeSignature: { numerator: 3, denominator: 4 } } });
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(store().result).toBeNull();
  });

  it('still has a card for a Keep-time run whose count-in changed while it waited', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    press(D4, 12.5);
    endPlayAlong(5, 'end', 13.05);
    editTake({ tempo: { ...TEMPO, countInBars: 2 } });
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(store().result?.runId).toBe(5);
  });

  it('puts a Keep-time card away when a new tempo moves the bars it was scored on', () => {
    start(keepTimeRun(5));
    press(C4, 12);
    press(D4, 12.5);
    endPlayAlong(5, 'pause', 13.3);
    expect(store().result).toMatchObject({ style: 'playAlong', tempo: TEMPO });
    editTake({ tempo: { ...TEMPO, countInBars: 0 } });
    expect(store().result).not.toBeNull();

    editTake({ tempo: { ...TEMPO, bpm: 90 } });
    expect(store().result).toBeNull();
  });
});

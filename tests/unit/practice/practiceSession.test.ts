import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputNoteEvent } from '@/audio/AudioEngine';
import { END_GRACE_MS, type PlayAlongDeps } from '@/features/practice/playAlongSession';
import { createPracticeSession } from '@/features/practice/practiceSession';
import type { PracticeEvent, PracticeRun, RunEndReason } from '@/features/transport/practiceEvents';
import { usePracticeStore } from '@/state/usePracticeStore';
import { practiceRun } from './practiceFixtures';

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
const takeIds = channel<string>();
const keys = channel<InputNoteEvent>();
let session: { dispose(): void } | null = null;

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
  clocks.audio = 10;
  clocks.page = 5000;
  flashed = [];
  session = createPracticeSession({
    subscribePractice: practice.subscribe,
    subscribeTakeId: takeIds.subscribe,
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
    playRun(1, 2, { takeId: 'scale' });
    takeIds.send('scale');
    expect(store().result).not.toBeNull();

    takeIds.send('etude');
    expect(store().result).toBeNull();
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
    expect(takeIds.size).toBe(1);
    session?.dispose();
    session = null;
    expect(practice.size).toBe(0);
    expect(takeIds.size).toBe(0);
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
});

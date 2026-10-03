import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputNoteEvent } from '@/audio/AudioEngine';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';

/**
 * The engine is the clock and the ear, as in the other playback tests: `now`
 * drives the transport clock, `scheduled` records what would have sounded, and
 * `inputs` is who listens to the keys. `clicks` records what the transport
 * asked of the metronome, grids and all, so a test can read where they click.
 */
const h = vi.hoisted(() => ({
  now: 0,
  scheduled: [] as Array<{ midi: number; when: number; durationMs: number }>,
  inputs: new Set<(event: InputNoteEvent) => void>(),
  clicks: [] as Array<{ call: string; grid?: unknown }>,
}));

vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    get currentTime() {
      return h.now;
    },
    unlockFromUserGesture: vi.fn(async () => {}),
    getLoadProgress: vi.fn(() => ({ phase: 'core-ready' })),
    bank: { isCoreReady: () => true },
    isSwitching: () => false,
    setInstrument: vi.fn(() => Promise.resolve()),
    scheduleNote: vi.fn((event: { midi: number; durationMs: number }, when: number) =>
      h.scheduled.push({ midi: event.midi, when, durationMs: event.durationMs }),
    ),
    cancelPending: vi.fn((_sourceId: string, after: number) => {
      h.scheduled = h.scheduled.filter((event) => event.when <= after);
    }),
    retimeReleases: vi.fn(),
    subscribeSchedulerTick: vi.fn(() => () => {}),
    subscribeInput: vi.fn((listener: (event: InputNoteEvent) => void) => {
      h.inputs.add(listener);
      return () => h.inputs.delete(listener);
    }),
    allNotesOff: vi.fn(),
    getAudioContext: vi.fn(() => null),
    getOutputDestination: vi.fn(() => null),
    activeInstrument: { packVersion: 'test-pack' },
  },
}));

// The grids are the real ones, so a test can read where each click falls.
vi.mock('@/audio/MetronomeEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/audio/MetronomeEngine')>()),
  MetronomeEngine: class {
    isRunning = false;
    attach(): void {}
    configure(): void {}
    start(grid: unknown): void {
      this.isRunning = true;
      h.clicks.push({ call: 'start', grid });
    }
    setGrid(grid: unknown): void {
      h.clicks.push({ call: 'setGrid', grid });
    }
    retime(grid: unknown): void {
      h.clicks.push({ call: 'retime', grid });
    }
    stop(): void {
      this.isRunning = false;
      h.clicks.push({ call: 'stop' });
    }
    finish(): void {
      this.isRunning = false;
      h.clicks.push({ call: 'finish' });
    }
    topUpSchedule(): void {}
  },
}));

function note(
  id: string,
  midi: number,
  startMs: number,
  staff: NoteEvent['staff'],
  durationMs = 200,
): NoteEvent {
  return { id, midi, startMs, durationMs, velocity: 0.6, staff };
}

/**
 * One bar at 120 bpm in 4/4, two seconds of it: the right hand on every beat,
 * the left on the first and the third.
 */
const NOTES = [
  note('r0', 64, 0, 'treble'),
  note('l0', 48, 0, 'bass'),
  note('r1', 65, 500, 'treble'),
  note('r2', 67, 1000, 'treble'),
  note('l1', 43, 1000, 'bass'),
  note('r3', 69, 1500, 'treble'),
];

/** Advance the audio clock `seconds`, ticking the 25 ms scheduler as it goes. */
function run(seconds: number): void {
  for (let step = 0; step < Math.round(seconds * 100); step += 1) {
    h.now += 0.01;
    vi.advanceTimersByTime(10);
  }
}

/** Run on until the playhead has reached `takeMs`, or the transport has stopped moving. */
function runTo(takeMs: number): void {
  for (let step = 0; step < 2000; step += 1) {
    if (transportController.getPlayheadMs() >= takeMs) return;
    if (transportController.getState() !== 'playing') return;
    run(0.01);
  }
}

/** Run on until playback has played to the end and paused there. */
function runToEnd(): void {
  for (let step = 0; step < 2000 && transportController.getState() === 'playing'; step += 1) {
    run(0.01);
  }
}

/** The keys the take sounded, in the order they were handed to the engine. */
function sounded(): number[] {
  return h.scheduled.map((event) => event.midi);
}

/** Everything the practice listener has been told since the test began. */
let heard: PracticeEvent[] = [];
let stopListening: () => void = () => {};

function told(): string[] {
  return heard.map((event) =>
    event.type === 'run-start'
      ? `run-start ${event.run.style} ${event.run.hand}`
      : event.type === 'run-end'
        ? `run-end ${event.reason}`
        : event.type,
  );
}

function lastRun(): PracticeRun {
  const last = heard.filter((event) => event.type === 'run-start').at(-1);
  if (!last) throw new Error('No run was started');
  return last.run;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.now = 0;
  h.scheduled = [];
  h.inputs.clear();
  h.clicks = [];
  useTakeStore.getState().setTake(createEmptyTake({ notes: NOTES, durationMs: 2000 }));
  useSettingsStore.getState().setPlaybackMode('playalong-right');
  transportController.setMetronomeOn(false);
  transportController.seek(0);
  h.clicks = [];
  heard = [];
  stopListening = transportController.subscribePractice((event) => heard.push(event));
});

afterEach(() => {
  stopListening();
  transportController.stop();
  transportController.setMetronomeOn(false);
  useSettingsStore.getState().setPlaybackMode('simple');
  vi.useRealTimers();
});

describe('Keep time', () => {
  it('never stops for a note, nor listens to the keys', () => {
    transportController.play();
    for (let step = 0; step < 600 && transportController.getState() === 'playing'; step += 1) {
      run(0.01);
      expect(transportController.isWaitingForTraining()).toBe(false);
      expect(h.inputs.size).toBe(0);
    }
    expect(transportController.getState()).toBe('paused');
    expect(transportController.getPlayheadMs()).toBe(2000);
  });

  it('leaves the hand chosen to the player, and plays the other', () => {
    transportController.play();
    runToEnd();
    expect(sounded()).toEqual([48, 43]);

    useSettingsStore.getState().setPlaybackMode('playalong-left');
    transportController.seek(0);
    h.scheduled = [];
    transportController.play();
    runToEnd();
    expect(sounded()).toEqual([64, 65, 67, 69]);
  });

  it('leaves a hidden copy of the player’s note to them, and plays a hidden trill', () => {
    const hide = (n: NoteEvent): NoteEvent => ({ ...n, hidden: true });
    const notes = [
      note('written', 77, 0, 'treble'),
      hide(note('trill', 79, 0, 'treble')),
      note('held', 65, 500, 'treble'),
      hide(note('copy', 65, 500, 'bass')),
      note('left', 48, 1000, 'bass'),
    ];
    useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 2000 }));
    transportController.play();
    runToEnd();
    expect(sounded()).toEqual([79, 48]);
  });

  it('plays the take whole once the run ends on another page', () => {
    transportController.play();
    runTo(600);
    expect(sounded()).toEqual([48]);
    transportController.handleNavigation();
    expect(transportController.getState()).toBe('playing');
    runToEnd();
    // The right hand from where the page changed, the left as before.
    expect(sounded().sort((a, b) => a - b)).toEqual([43, 48, 67, 69]);
    expect(told()).toEqual(['run-start playAlong right', 'run-end navigation']);
  });

  it('turns the metronome on where nothing would sound, for the player to switch off', () => {
    useSettingsStore.getState().setPlaybackMode('playalong-both');
    transportController.play();
    // On, as its switch shows it, rather than clicking behind it.
    expect(transportController.isMetronomeOn()).toBe(true);
    transportController.stop();
    transportController.setMetronomeOn(false);

    // One hand of a piece written for one hand alone is the same.
    const rightOnly = NOTES.filter((n) => n.staff === 'treble');
    useTakeStore.getState().setTake(createEmptyTake({ notes: rightOnly, durationMs: 2000 }));
    useSettingsStore.getState().setPlaybackMode('playalong-right');
    transportController.play();
    expect(transportController.isMetronomeOn()).toBe(true);
    transportController.stop();
    transportController.setMetronomeOn(false);

    // The other hand of it sounds the whole piece.
    useSettingsStore.getState().setPlaybackMode('playalong-left');
    transportController.play();
    expect(transportController.isMetronomeOn()).toBe(false);
  });

  it('turns the metronome on where nothing is left to sound from where the run starts', () => {
    // The left hand has nothing after 1000; from there, the right hand's run is silent.
    transportController.seek(1200);
    transportController.play();
    expect(transportController.isMetronomeOn()).toBe(true);
  });

  it('tells when a run ends, by the audio clock', () => {
    transportController.play();
    runTo(600);
    h.now += 0.005;
    transportController.pause();
    expect(heard.at(-1)).toEqual({
      type: 'run-end',
      runId: lastRun().runId,
      reason: 'pause',
      audioTime: h.now,
    });
  });
});

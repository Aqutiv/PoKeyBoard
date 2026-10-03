import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputNoteEvent } from '@/audio/AudioEngine';
import type { ClickGrid } from '@/audio/MetronomeEngine';
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

/** The grid the transport last handed the metronome, by `start`, `retime` or `setGrid`. */
function clickGrid(): ClickGrid {
  const last = h.clicks.filter((click) => click.grid !== undefined).at(-1);
  if (!last) throw new Error('The metronome was given no grid');
  return last.grid as ClickGrid;
}

/** What the transport asked of the metronome, the calls alone. */
function metronomeCalls(): string[] {
  return h.clicks.map((click) => click.call);
}

/** Run on until the count-in is over, a tick at a time. */
function countIn(): void {
  for (let step = 0; step < 1000 && transportController.isCountingIn(); step += 1) run(0.01);
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

describe('the Keep time count-in', () => {
  beforeEach(() => {
    // The right hand plays, so there is something to hear when it sets off.
    useSettingsStore.getState().setPlaybackMode('playalong-left');
  });

  it.each([
    [1, 1, 2.06],
    [0.5, 1, 4.06],
    [1, 2, 4.06],
  ] as const)(
    'counts a fresh run in ahead of its first note: at %s×, %s bar(s)',
    (speed, countInBars, firstAt) => {
      useTakeStore.getState().setTempo({ ...useTakeStore.getState().take.tempo, countInBars });
      transportController.setSpeed(speed);
      transportController.play();
      runTo(100);
      // The 60 ms every start leads in by, then the bars counted in.
      expect(h.scheduled[0]).toMatchObject({ midi: 64, when: expect.closeTo(firstAt, 9) });
    },
  );

  it('counts a bar in when the take counts none in for a recording', () => {
    useTakeStore.getState().setTempo({ ...useTakeStore.getState().take.tempo, countInBars: 0 });
    transportController.play();
    runTo(100);
    expect(h.scheduled[0]!.when).toBeCloseTo(2.06, 9);
  });

  it('holds the playhead where the run starts until the count-in is over, and says so', () => {
    transportController.seek(500);
    transportController.play();
    expect(transportController.isCountingIn()).toBe(true);
    run(1.5);
    expect(transportController.getPlayheadMs()).toBe(500);
    expect(transportController.getPassStartMs()).toBe(500);
    const notified = vi.fn();
    const unsubscribe = transportController.subscribeState(notified);
    countIn();
    unsubscribe();
    // Over on the first tick to find the clock past the run's start, and told.
    expect(h.now).toBeGreaterThanOrEqual(2.06);
    expect(h.now).toBeLessThan(2.06 + 0.03);
    expect(notified).toHaveBeenCalled();
    run(0.1);
    expect(transportController.getPlayheadMs()).toBeGreaterThan(500);
  });

  it('clicks the count-in, and nothing from where the run starts with the metronome off', () => {
    transportController.setSpeed(0.5);
    transportController.play();
    expect(metronomeCalls()).toEqual(['start']);
    const grid = clickGrid();
    // A beat of the take's 500 ms at half speed is a second; four make the bar.
    expect(grid.audioTimeAt(0)).toBeCloseTo(0.06, 9);
    expect(grid.audioTimeAt(3)).toBeCloseTo(3.06, 9);
    expect(grid.isAccent(0)).toBe(true);
    expect(grid.isAccent(1)).toBe(false);
    expect(grid.audioTimeAt(4)).toBe(Number.POSITIVE_INFINITY);
    countIn();
    // The clicks already queued still sound; none are queued past the count-in.
    expect(metronomeCalls()).toEqual(['start', 'finish']);
  });

  it('clicks on in the take’s own beat from where the run starts with the metronome on', () => {
    transportController.setMetronomeOn(true);
    // From halfway through a beat: the take's next beat comes 250 ms after it.
    transportController.seek(250);
    h.clicks = [];
    transportController.play();
    expect(metronomeCalls()).toEqual(['start']);
    const grid = clickGrid();
    expect(grid.audioTimeAt(3)).toBeCloseTo(1.56, 9);
    expect(grid.audioTimeAt(4)).toBeCloseTo(2.06 + 0.25, 9);
    expect(grid.audioTimeAt(5)).toBeCloseTo(2.06 + 0.75, 9);
    expect(grid.indexAt(2.06 + 0.25)).toBeCloseTo(4, 9);
    countIn();
    // Handed over to the take's own grid, which goes on as that one did.
    expect(metronomeCalls()).toEqual(['start', 'setGrid']);
    expect(clickGrid().audioTimeAt(1)).toBeCloseTo(2.06 + 0.25, 9);
  });

  it('clicks the run’s first beat, where it starts on one, with the metronome on', () => {
    transportController.setMetronomeOn(true);
    // The bar's second beat.
    transportController.seek(500);
    h.clicks = [];
    transportController.play();
    const grid = clickGrid();
    // The count-in's bar, its downbeat accented…
    expect(grid.audioTimeAt(0)).toBeCloseTo(0.06, 9);
    expect(grid.isAccent(0)).toBe(true);
    // …then the take's second beat as the run sets off, as the take accents it.
    expect(grid.audioTimeAt(4)).toBeCloseTo(2.06, 9);
    expect(grid.isAccent(4)).toBe(false);
    expect(grid.beatInBar(4)).toBe(1);
  });

  it('keeps counting in when the metronome is switched, and goes by the switch after', () => {
    transportController.play();
    run(0.5);
    h.clicks = [];
    transportController.setMetronomeOn(true);
    // Not started again: the clicks to come gain the take's beat after the count-in.
    expect(metronomeCalls()).toEqual(['retime']);
    expect(clickGrid().audioTimeAt(4)).toBeCloseTo(2.06, 9);
    transportController.refreshMetronomeConfig();
    expect(metronomeCalls()).toEqual(['retime']);
    transportController.setMetronomeOn(false);
    expect(metronomeCalls()).toEqual(['retime', 'retime']);
    expect(clickGrid().audioTimeAt(4)).toBe(Number.POSITIVE_INFINITY);
    countIn();
    expect(metronomeCalls()).toEqual(['retime', 'retime', 'finish']);
  });

  it('counts the clicks in, and the take’s beat after, for a run with nothing to sound', () => {
    useSettingsStore.getState().setPlaybackMode('playalong-both');
    transportController.play();
    expect(transportController.isMetronomeOn()).toBe(true);
    expect(clickGrid().audioTimeAt(3)).toBeCloseTo(1.56, 9);
    expect(clickGrid().audioTimeAt(4)).toBeCloseTo(2.06, 9);
    countIn();
    expect(metronomeCalls().at(-1)).toBe('setGrid');
  });

  it('counts in only a fresh run, and never between the passes of a loop', () => {
    transportController.setLoop({ startMs: 0, endMs: 1000 });
    transportController.play();
    countIn();
    run(3);
    expect(metronomeCalls()).toEqual(['start', 'finish']);
    expect(transportController.isCountingIn()).toBe(false);
    // The right hand's two notes a pass, half a second apart, pass after pass.
    const times = h.scheduled.map((event) => event.when);
    expect(times.length).toBeGreaterThanOrEqual(6);
    times.forEach((when, i) => expect(when).toBeCloseTo(2.06 + 0.5 * i, 9));
  });

  it('pauses during the count-in where the run starts', () => {
    transportController.seek(500);
    transportController.play();
    run(1);
    transportController.pause();
    expect(transportController.getState()).toBe('paused');
    expect(transportController.getPlayheadMs()).toBe(500);
    expect(transportController.isCountingIn()).toBe(false);
    expect(metronomeCalls().at(-1)).toBe('stop');
    expect(told()).toEqual(['run-start playAlong left', 'run-end pause']);
  });

  it('counts in again, from the run’s start, at a speed chosen during the count-in', () => {
    transportController.seek(500);
    transportController.play();
    run(0.5);
    transportController.setSpeed(0.5);
    expect(told()).toEqual([
      'run-start playAlong left',
      'run-end restart',
      'run-start playAlong left',
    ]);
    expect(lastRun()).toMatchObject({
      fromMs: 500,
      speed: 0.5,
      countInMs: 4000,
      anchorAudioTime: expect.closeTo(h.now + 0.06 + 4, 9),
    });
    expect(transportController.getState()).toBe('playing');
    expect(transportController.isCountingIn()).toBe(true);
    expect(transportController.getPlayheadMs()).toBe(500);
  });

  it('changes speed as ever once the count-in is over, and tells of it', () => {
    transportController.play();
    runTo(600);
    transportController.setSpeed(0.5);
    expect(heard.at(-1)).toEqual({
      type: 'speed',
      runId: lastRun().runId,
      speed: 0.5,
      audioTime: h.now,
    });
    expect(told()).toEqual(['run-start playAlong left', 'speed']);
    expect(transportController.getState()).toBe('playing');
  });

  it('tells what a Keep-time run starts with: its count-in, and where the music sets off', () => {
    h.now = 1;
    transportController.play();
    expect(lastRun()).toMatchObject({
      style: 'playAlong',
      hand: 'left',
      fromMs: 0,
      speed: 1,
      countInMs: 2000,
      anchorAudioTime: expect.closeTo(1 + 0.06 + 2, 9),
      asked: [
        { id: 'l0', midi: 48, startMs: 0 },
        { id: 'l1', midi: 43, startMs: 1000 },
      ],
    });
  });
});

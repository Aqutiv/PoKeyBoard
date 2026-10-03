import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputNoteEvent } from '@/audio/AudioEngine';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent, PlaybackLoop } from '@/domain/takeTypes';
import type { PlaybackMode } from '@/features/transport/modes';
import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';

/**
 * The engine is the clock and the ear, as in the training tests: `now` drives
 * the transport clock, `scheduled` records what would have sounded, and when,
 * and `inputs` lets a test play a key the way the keyboard, MIDI and the
 * pointer all do.
 */
const h = vi.hoisted(() => ({
  now: 0,
  scheduled: [] as Array<{ midi: number; when: number; durationMs: number }>,
  inputs: new Set<(event: InputNoteEvent) => void>(),
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
    // What a change of speed asks of the voices: notes not yet begun are called
    // off, and those sounding let go where `at` moves their key-up.
    cancelPending: vi.fn((_sourceId: string, after: number) => {
      h.scheduled = h.scheduled.filter((event) => event.when <= after);
    }),
    retimeReleases: vi.fn(
      (_sourceId: string, from: number, at: (releaseTime: number) => number) => {
        for (const event of h.scheduled) {
          const releaseTime = event.when + event.durationMs / 1000;
          if (event.when > from || releaseTime <= from) continue;
          event.durationMs = (at(releaseTime) - event.when) * 1000;
        }
      },
    ),
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

vi.mock('@/audio/MetronomeEngine', () => ({
  MetronomeEngine: class {
    isRunning = false;
    attach(): void {}
    configure(): void {}
    start(): void {}
    stop(): void {}
    finish(): void {}
    setGrid(): void {}
    topUpSchedule(): void {}
  },
  gridForTake: () => ({}),
  constantClickGrid: () => ({}),
}));

function note(id: string, midi: number, startMs: number, staff: NoteEvent['staff']): NoteEvent {
  return { id, midi, startMs, durationMs: 200, velocity: 0.6, staff };
}

/** Left hand at 0 and 600; a right-hand third at 300. */
const NOTES = [
  note('l1', 48, 0, 'bass'),
  note('r1', 64, 300, 'treble'),
  note('r2', 67, 310, 'treble'),
  note('l2', 50, 600, 'bass'),
];

/** Round the first two thirds of the take, the right hand's third and all. */
const LOOP: PlaybackLoop = { startMs: 0, endMs: 600 };

/**
 * Run the audio clock forward until the playhead reaches `takeMs`, ticking the
 * 25 ms scheduler as it goes, and stopping early at a training hold, which is
 * where the playhead stops too.
 */
function runTo(takeMs: number): void {
  for (let step = 0; step < 500; step += 1) {
    if (transportController.getPlayheadMs() >= takeMs) return;
    if (transportController.isWaitingForTraining()) return;
    h.now += 0.01;
    vi.advanceTimersByTime(25);
  }
}

function press(midi: number): void {
  for (const listener of [...h.inputs]) {
    listener({ type: 'on', midi, velocity: 0.7, audioTime: h.now, sourceId: 'kbd' });
  }
}

/** Choose a playback mode as the Modes menu does, taking effect mid-flight. */
function choose(mode: PlaybackMode): void {
  useSettingsStore.getState().setPlaybackMode(mode);
  transportController.refreshTrainingMode();
}

/** Everything the practice listener has been told since the test began. */
let heard: PracticeEvent[] = [];
let stopListening: () => void = () => {};

/**
 * What the listener was told, in a few words an event: its type, with the
 * hand a run was started for, why one ended, or that a hold was skipped.
 */
function told(): string[] {
  return heard.map((event) => {
    switch (event.type) {
      case 'run-start':
        return `run-start ${event.run.hand}`;
      case 'run-end':
        return `run-end ${event.reason}`;
      case 'hold-cleared':
        return event.skipped ? 'hold-cleared skipped' : 'hold-cleared';
      default:
        return event.type;
    }
  });
}

/** The run the listener was last told had started. */
function lastRun(): PracticeRun {
  const last = heard.filter((event) => event.type === 'run-start').at(-1);
  if (!last) throw new Error('No run was started');
  return last.run;
}

/**
 * Every event carries the id of the run it happened in, the one started last
 * and not yet ended, and every run a new id, higher than any before it.
 */
function expectEachInItsRun(): void {
  let live: number | null = null;
  let last = 0;
  for (const event of heard) {
    if (event.type === 'run-start') {
      expect(live).toBeNull();
      expect(event.runId).toBeGreaterThan(last);
      expect(event.run.runId).toBe(event.runId);
      live = event.runId;
      last = event.runId;
      continue;
    }
    expect(event.runId).toBe(live);
    if (event.type === 'run-end') live = null;
  }
}

describe('practice runs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.now = 0;
    h.scheduled = [];
    h.inputs.clear();
    useTakeStore.getState().setTake(createEmptyTake({ notes: NOTES, durationMs: 900 }));
    useSettingsStore.getState().setPlaybackMode('training-right');
    transportController.seek(0);
    heard = [];
    stopListening = transportController.subscribePractice((event) => heard.push(event));
  });

  afterEach(() => {
    stopListening();
    transportController.stop();
    transportController.reset();
    useSettingsStore.getState().setPlaybackMode('simple');
    vi.useRealTimers();
  });

  it('tells nothing of playback in simple mode', () => {
    useSettingsStore.getState().setPlaybackMode('simple');
    transportController.play();
    runTo(400);
    transportController.setSpeed(0.5);
    transportController.pause();
    transportController.play();
    runTo(900);
    transportController.stop();
    expect(heard).toEqual([]);
  });

  it('starts a run at Play: the hand, from where, how fast, and every note it will ask for', () => {
    // The pedal holds the left hand's last note on past the take's own end.
    const pedalEvents = [
      { atMs: 550, down: true },
      { atMs: 1200, down: false },
    ];
    useTakeStore
      .getState()
      .setTake(createEmptyTake({ notes: NOTES, durationMs: 900, pedalEvents }));
    transportController.setSpeed(0.5);
    transportController.seek(100);
    const take = useTakeStore.getState().take;
    h.now = 2;
    transportController.play();
    expect(told()).toEqual(['run-start right']);
    expect(heard[0]!.runId).toBe(lastRun().runId);
    expect(lastRun()).toEqual({
      runId: expect.any(Number),
      takeId: take.id,
      style: 'wait',
      hand: 'right',
      fromMs: 100,
      loop: null,
      speed: 0.5,
      // Every start leads in 60 ms ahead of the audio clock.
      anchorAudioTime: expect.closeTo(2.06, 9),
      countInMs: 0,
      durationMs: 1200,
      tempo: take.tempo,
      asked: [
        { id: 'r1', midi: 64, startMs: 300 },
        { id: 'r2', midi: 67, startMs: 310 },
      ],
      noteCount: 4,
      takeDurationMs: 900,
    });
  });

  it('tells when each hold’s notes fell due, by the clock the run was playing to', () => {
    useSettingsStore.getState().setPlaybackMode('training-both');
    transportController.setSpeed(0.5);
    transportController.play();
    runTo(900);
    // The player takes their time over the first.
    h.now += 0.5;
    press(48);
    const pressedAt = h.now;
    runTo(900);
    const runId = lastRun().runId;
    expect(heard.filter((event) => event.type === 'hold')).toEqual([
      // The start's 60 ms lead, and no take at all before the first note.
      { type: 'hold', runId, atMs: 0, midis: [48], dueAudioTime: expect.closeTo(0.06, 9) },
      // The 20 ms a resumed run leads in by, then 300 ms of take at half speed.
      {
        type: 'hold',
        runId,
        atMs: 300,
        midis: [64, 67],
        dueAudioTime: expect.closeTo(pressedAt + 0.02 + 0.6, 9),
      },
    ]);
    expect(told()).toEqual(['run-start both', 'hold', 'hold-key', 'hold-cleared', 'hold']);
  });

  it('tells every key played at a hold, wanted or not, and then the hold clearing', () => {
    useSettingsStore.getState().setPlaybackMode('training-left');
    transportController.play();
    runTo(50);
    expect(transportController.isWaitingForTraining()).toBe(true);
    h.now += 0.2;
    press(49);
    const wrongAt = h.now;
    h.now += 0.3;
    press(48);
    const rightAt = h.now;
    const runId = lastRun().runId;
    expect(told()).toEqual(['run-start left', 'hold', 'hold-key', 'hold-key', 'hold-cleared']);
    expect(heard.slice(2)).toEqual([
      { type: 'hold-key', runId, midi: 49, wanted: false, audioTime: wrongAt },
      { type: 'hold-key', runId, midi: 48, wanted: true, audioTime: rightAt },
      { type: 'hold-cleared', runId, skipped: false, audioTime: rightAt },
    ]);
    expect(transportController.getState()).toBe('playing');
  });

  it('tells of Play letting a hold through as a skip, and runs on in the same run', () => {
    transportController.play();
    runTo(350);
    h.now += 0.1;
    transportController.play();
    expect(heard[2]).toEqual({
      type: 'hold-cleared',
      runId: lastRun().runId,
      skipped: true,
      audioTime: h.now,
    });
    runTo(900);
    expect(told()).toEqual(['run-start right', 'hold', 'hold-cleared skipped', 'run-end end']);
    expectEachInItsRun();
  });

  it('tells of a chord played a moment before its note as a step, with no hold', () => {
    transportController.play();
    runTo(200);
    // A tenth of a second early, inside the window.
    press(64);
    press(67);
    runTo(900);
    expect(told()).toEqual(['run-start right', 'step', 'run-end end']);
    expect(heard[1]).toEqual({ type: 'step', runId: lastRun().runId, atMs: 300, midis: [64, 67] });
  });

  it('ends a run once, where the take ends, however many holds it stopped at', () => {
    useSettingsStore.getState().setPlaybackMode('training-both');
    transportController.play();
    for (const keys of [[48], [64, 67], [50]]) {
      runTo(900);
      for (const midi of keys) press(midi);
    }
    runTo(900);
    expect(transportController.getState()).toBe('paused');
    // Stopped once it has played to its end, there is no run left to end.
    transportController.stop();
    expect(told().filter((said) => said.startsWith('run-'))).toEqual([
      'run-start both',
      'run-end end',
    ]);
    expect(heard.at(-1)).toEqual({
      type: 'run-end',
      runId: lastRun().runId,
      reason: 'end',
      audioTime: null,
    });
  });

  it('ends a run once, for a listener that stops the transport as it hears the end', () => {
    stopListening();
    stopListening = transportController.subscribePractice((event) => {
      heard.push(event);
      if (event.type === 'run-end') transportController.stop();
    });
    transportController.play();
    runTo(100);
    transportController.pause();
    expect(told()).toEqual(['run-start right', 'run-end pause']);
  });

  it.each<[name: string, from: 'playing' | 'at a hold', act: () => unknown, then: string[]]>([
    ['a pause ends the run', 'playing', () => transportController.pause(), ['run-end pause']],
    ['stopping ends the run', 'playing', () => transportController.stop(), ['run-end stop']],
    ['stopping ends the run', 'at a hold', () => transportController.stop(), ['run-end stop']],
    ['a seek ends the run', 'at a hold', () => transportController.seek(0), ['run-end seek']],
    // The transport waits for a pause before it seeks, and so does the run.
    ['a seek leaves the run be', 'playing', () => transportController.seek(0), []],
    ['a scrub ends the run', 'at a hold', () => transportController.beginScrub(), ['run-end seek']],
    // A pause, then the seek.
    [
      'going back to the start ends the run',
      'playing',
      () => transportController.returnToStart(),
      ['run-end pause'],
    ],
    [
      'going back to the start ends the run',
      'at a hold',
      () => transportController.returnToStart(),
      ['run-end seek'],
    ],
    [
      'going to another page ends the run',
      'playing',
      () => transportController.handleNavigation(),
      ['run-end navigation'],
    ],
    [
      'going to another page ends the run',
      'at a hold',
      () => transportController.handleNavigation(),
      ['run-end navigation'],
    ],
    [
      'an interruption ends the run',
      'playing',
      () => transportController.handleInterruption(),
      ['run-end interrupted'],
    ],
    [
      'an interruption ends the run',
      'at a hold',
      () => transportController.handleInterruption(),
      ['run-end interrupted'],
    ],
    ['recording ends the run', 'at a hold', () => transportController.record(), ['run-end record']],
    [
      'a failure ends the run',
      'playing',
      () => transportController.fail('No sound'),
      ['run-end failed'],
    ],
    [
      'a loop set ends the run, and playback starts the next',
      'playing',
      () => transportController.setLoop(LOOP),
      ['run-end loop', 'run-start right'],
    ],
    [
      'a loop set ends the run',
      'at a hold',
      () => transportController.setLoop(LOOP),
      ['run-end loop'],
    ],
    [
      'the other hand chosen ends the run and starts its own',
      'playing',
      () => choose('training-left'),
      ['run-end mode', 'run-start left'],
    ],
    [
      'the other hand chosen ends the run and starts its own',
      'at a hold',
      () => choose('training-left'),
      ['run-end mode', 'run-start left'],
    ],
    ['listening chosen ends the run', 'playing', () => choose('simple'), ['run-end mode']],
    ['listening chosen ends the run', 'at a hold', () => choose('simple'), ['run-end mode']],
    ['the same hand chosen again leaves the run be', 'playing', () => choose('training-right'), []],
    // As any change of mode at a hold does, it carries on.
    [
      'the same hand chosen again lets the hold through',
      'at a hold',
      () => choose('training-right'),
      ['hold-cleared skipped'],
    ],
  ])('%s (%s)', async (_name, from, act, then) => {
    transportController.play();
    runTo(from === 'playing' ? 100 : 350);
    expect(transportController.isWaitingForTraining()).toBe(from === 'at a hold');
    const before = heard.length;
    await act();
    expect(told().slice(before)).toEqual(then);
    expectEachInItsRun();
  });

  it('starts the other hand’s run from where it was chosen', () => {
    transportController.play();
    runTo(100);
    const at = transportController.getPlayheadMs();
    choose('training-left');
    expect(lastRun()).toMatchObject({
      hand: 'left',
      fromMs: Math.round(at),
      anchorAudioTime: h.now,
      loop: null,
    });
    expect(lastRun().asked.map((asked) => asked.id)).toEqual(['l1', 'l2']);
  });

  it('starts the other hand’s run from the hold it was chosen at', () => {
    transportController.play();
    runTo(350);
    choose('training-left');
    // The hold is let through, and a run resumed from one leads in by 20 ms.
    expect(lastRun()).toMatchObject({
      hand: 'left',
      fromMs: 300,
      anchorAudioTime: expect.closeTo(h.now + 0.02, 9),
    });
  });

  it('starts the next run round a loop set mid-run, from where it was', () => {
    transportController.play();
    runTo(100);
    const at = transportController.getPlayheadMs();
    transportController.setLoop(LOOP);
    expect(lastRun()).toMatchObject({
      hand: 'right',
      fromMs: Math.round(at),
      loop: LOOP,
      anchorAudioTime: expect.closeTo(h.now + 0.06, 9),
    });
  });

  it('starts the next run from a hold a loop was set at, once the hold is played', () => {
    transportController.play();
    runTo(350);
    transportController.setLoop(LOOP);
    // No run is under way to be told of the keys.
    press(64);
    press(67);
    expect(told()).toEqual(['run-start right', 'hold', 'run-end loop', 'run-start right']);
    expect(lastRun()).toMatchObject({ fromMs: 300, loop: LOOP });
    expectEachInItsRun();
  });

  it('lets playback run on after a change of page, with nothing more to tell', () => {
    transportController.play();
    runTo(100);
    transportController.handleNavigation();
    runTo(900);
    expect(transportController.getState()).toBe('paused');
    expect(told()).toEqual(['run-start right', 'run-end navigation']);
  });

  it('tells of a change of speed, from that moment while playing and not until a hold resumes', () => {
    transportController.play();
    runTo(100);
    const changedAt = h.now;
    transportController.setSpeed(0.5);
    const runId = lastRun().runId;
    expect(heard.at(-1)).toEqual({ type: 'speed', runId, speed: 0.5, audioTime: changedAt });
    runTo(350);
    expect(transportController.isWaitingForTraining()).toBe(true);
    transportController.setSpeed(0.75);
    expect(heard.at(-1)).toEqual({ type: 'speed', runId, speed: 0.75, audioTime: null });
    press(64);
    press(67);
    expect(told()).toEqual([
      'run-start right',
      'speed',
      'hold',
      'speed',
      'hold-key',
      'hold-key',
      'hold-cleared',
    ]);
  });

  it('tells nothing of Play from the very end, where there is nothing left to practise', () => {
    transportController.seek(900);
    transportController.play();
    h.now += 0.1;
    vi.advanceTimersByTime(100);
    expect(transportController.getState()).toBe('paused');
    expect(heard).toEqual([]);
  });

  it('gives each run a new id, and every event the id of its run', () => {
    transportController.play();
    runTo(350);
    press(64);
    press(67);
    transportController.pause();
    transportController.play();
    transportController.stop();
    transportController.seek(0);
    choose('training-both');
    transportController.play();
    runTo(50);
    press(48);
    transportController.stop();
    expect(told()).toEqual([
      'run-start right',
      'hold',
      'hold-key',
      'hold-key',
      'hold-cleared',
      'run-end pause',
      'run-start right',
      'run-end stop',
      'run-start both',
      'hold',
      'hold-key',
      'hold-cleared',
      'run-end stop',
    ]);
    expectEachInItsRun();
  });

  it('carries on whatever a listener does', () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    // One that throws, told first: the one after it hears everything only if
    // the throw is contained, and the transport has to finish what it started.
    stopListening();
    const stopThrowing = transportController.subscribePractice(() => {
      throw new Error('A listener broke');
    });
    stopListening = transportController.subscribePractice((event) => heard.push(event));
    try {
      transportController.play();
      runTo(350);
      expect(transportController.isWaitingForTraining()).toBe(true);
      press(64);
      press(67);
      expect(transportController.getState()).toBe('playing');
      transportController.pause();
      expect(transportController.getState()).toBe('paused');
      // The pause dropped the gate as well, and with it the keys' listener.
      expect(h.inputs.size).toBe(0);
      expect(told()).toEqual([
        'run-start right',
        'hold',
        'hold-key',
        'hold-key',
        'hold-cleared',
        'run-end pause',
      ]);
      expect(reported).toHaveBeenCalledTimes(heard.length);
    } finally {
      stopThrowing();
      reported.mockRestore();
    }
  });
});

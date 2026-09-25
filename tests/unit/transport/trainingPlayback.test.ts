import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine, type InputNoteEvent } from '@/audio/AudioEngine';
import type { SampleLoadPhase } from '@/audio/audioTypes';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';

/**
 * The engine is the clock and the ear here: `now` drives the transport clock,
 * `scheduled` records what would have sounded, and `inputs` lets a test play a
 * key the way the keyboard, MIDI and the pointer all do.
 */
const h = vi.hoisted(() => ({
  now: 0,
  scheduled: [] as number[],
  inputs: new Set<(event: InputNoteEvent) => void>(),
  phase: 'core-ready' as SampleLoadPhase,
  coreReady: true,
  switchPromise: null as Promise<void> | null,
}));

vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    get currentTime() {
      return h.now;
    },
    unlockFromUserGesture: vi.fn(async () => {}),
    getLoadProgress: vi.fn(() => ({ phase: h.phase })),
    bank: { isCoreReady: () => h.coreReady },
    setInstrument: vi.fn(() => h.switchPromise ?? Promise.resolve()),
    scheduleNote: vi.fn((event: { midi: number }) => h.scheduled.push(event.midi)),
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

/**
 * Run the audio clock forward until the playhead reaches `takeMs`, ticking the
 * 25 ms scheduler as it goes. Take time is not wall time — every start anchors
 * the clock a slack ahead of `currentTime` — so tests steer by the playhead.
 * Stops early at a training hold, which is where the playhead stops too.
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

describe('training playback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.now = 0;
    h.scheduled = [];
    h.inputs.clear();
    h.phase = 'core-ready';
    h.coreReady = true;
    h.switchPromise = null;
    useSettingsStore.setState({ pianoInstrument: 'salamander-grand' });
    useTakeStore.getState().setTake(createEmptyTake({ notes: NOTES, durationMs: 900 }));
    useSettingsStore.getState().setPlaybackMode('training-right');
    transportController.seek(0);
  });

  afterEach(() => {
    transportController.stop();
    useSettingsStore.getState().setPlaybackMode('simple');
    vi.useRealTimers();
  });

  it('pauses and rejects playback, recording, and another selection until the piano is decoded', async () => {
    useSettingsStore.getState().setPlaybackMode('simple');
    transportController.play();
    runTo(100);
    let finish!: () => void;
    h.switchPromise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const switching = transportController.selectPiano('headroom-grand');
    expect(transportController.getState()).toBe('paused');
    const position = transportController.getPlayheadMs();
    transportController.play();
    await transportController.record();
    expect(await transportController.selectPiano('wurlitzer-ep203w')).toBe(false);
    expect(transportController.getState()).toBe('paused');
    expect(transportController.getPlayheadMs()).toBe(position);
    finish();
    expect(await switching).toBe(true);
    transportController.play();
    expect(transportController.getState()).toBe('playing');
    // Playback schedules its first sound 60 ms ahead of the audio clock.
    h.now += 0.06;
    expect(transportController.getPlayheadMs()).toBeCloseTo(position);
  });

  it('disarms a training hold when changing piano so a keypress cannot resume during loading', async () => {
    transportController.play();
    runTo(350);
    expect(transportController.isWaitingForTraining()).toBe(true);
    let finish!: () => void;
    h.switchPromise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const switching = transportController.selectPiano('headroom-grand');
    expect(transportController.isWaitingForTraining()).toBe(false);
    press(64);
    press(67);
    expect(transportController.getState()).toBe('paused');
    finish();
    await switching;
  });

  it('keeps playback blocked after failed decoding and permits it after retry succeeds', async () => {
    h.phase = 'error';
    h.coreReady = false;
    expect(await transportController.selectPiano('headroom-grand')).toBe(false);
    expect(transportController.isPianoSwitching()).toBe(false);
    transportController.play();
    expect(transportController.getState()).toBe('idle');
    h.phase = 'core-ready';
    h.coreReady = true;
    transportController.play();
    expect(transportController.getState()).toBe('playing');
  });

  it('allows playback and recording after optional sample loading fails with the core intact', async () => {
    h.phase = 'error';
    h.switchPromise = Promise.reject(new Error('Optional range samples unavailable'));
    expect(await transportController.selectPiano('headroom-grand')).toBe(true);
    expect(transportController.isPianoReady()).toBe(true);
    transportController.play();
    expect(transportController.getState()).toBe('playing');
    transportController.stop();
    await transportController.record();
    expect(transportController.getState()).toBe('countIn');
  });

  it('plays the other hand through and then holds at the trained hand', () => {
    transportController.play();
    runTo(200);

    // The left hand at 0 has sounded; the right-hand third has not, even
    // though 300ms is inside the 150ms lookahead from 200ms.
    expect(h.scheduled).toEqual([48]);
    expect(transportController.isWaitingForTraining()).toBe(false);

    runTo(350);
    expect(transportController.isWaitingForTraining()).toBe(true);
    expect(transportController.getTrainingTargets()).toEqual(new Set([64, 67]));
    // Parked exactly on the gate, not wherever the tick landed.
    expect(transportController.getPlayheadMs()).toBe(300);
    expect(transportController.getState()).toBe('paused');
  });

  it.each(['release', 'navigation', 'interruption'] as const)(
    'restores idle or paused after a scrub ends through %s',
    (ending) => {
      const end = () => {
        if (ending === 'release') transportController.endScrub(200);
        else if (ending === 'navigation') transportController.handleNavigation();
        else transportController.handleInterruption();
      };
      transportController.stop();
      expect(transportController.beginScrub()).toBe(true);
      transportController.setScrubTime(200);
      end();
      expect(transportController.getState()).toBe('idle');
      expect(transportController.getPlayheadMs()).toBe(200);

      transportController.play();
      transportController.pause();
      expect(transportController.beginScrub()).toBe(true);
      transportController.setScrubTime(200);
      end();
      expect(transportController.getState()).toBe('paused');
      expect(transportController.getPlayheadMs()).toBe(200);
    },
  );

  it('flags a wrong key without letting it through, and resumes on the right ones', () => {
    transportController.play();
    runTo(350);
    expect(transportController.isWaitingForTraining()).toBe(true);

    press(65);
    expect(transportController.getTrainingWrongMidis()).toEqual(new Set([65]));
    expect(transportController.isWaitingForTraining()).toBe(true);

    // Presses accumulate rather than having to land together.
    press(64);
    expect(transportController.isWaitingForTraining()).toBe(true);
    press(67);
    expect(transportController.isWaitingForTraining()).toBe(false);
    expect(transportController.getState()).toBe('playing');
    expect(transportController.getTrainingWrongMidis().size).toBe(0);
  });

  it('does not echo the notes the user just played, and gates the next one', () => {
    transportController.play();
    runTo(350);
    press(64);
    press(67);
    h.scheduled = [];

    runTo(700);
    // The left hand at 600 sounds; the right-hand third the user covered
    // themselves is not replayed on top of it.
    expect(h.scheduled).toEqual([50]);
    // Nothing left for the right hand, so playback runs on to the end.
    expect(transportController.isWaitingForTraining()).toBe(false);
  });

  it('lets Play through a wait rather than fighting the hold', () => {
    transportController.play();
    runTo(350);
    expect(transportController.isWaitingForTraining()).toBe(true);

    h.scheduled = [];
    transportController.play();
    expect(transportController.isWaitingForTraining()).toBe(false);
    runTo(360);
    // Nothing was played, so the take sounds the notes itself this time.
    expect(h.scheduled).toEqual([64, 67]);
  });

  it('drops the wait on stop, and on a seek away from it', () => {
    transportController.play();
    runTo(350);
    transportController.stop();
    expect(transportController.isWaitingForTraining()).toBe(false);
    expect(h.inputs.size).toBe(0);

    transportController.seek(0);
    transportController.play();
    runTo(350);
    expect(transportController.isWaitingForTraining()).toBe(true);
    transportController.seek(0);
    expect(transportController.isWaitingForTraining()).toBe(false);
    expect(h.inputs.size).toBe(0);
  });

  it('holds the very first note instead of sounding it under the hold', () => {
    // The gate has to exist before the scheduler's first tick: a note at the
    // playhead sits inside the lookahead, so an unarmed tick would queue the
    // note the hold is meant to be asking for.
    useSettingsStore.getState().setPlaybackMode('training-both');
    transportController.play();
    runTo(50);

    expect(transportController.isWaitingForTraining()).toBe(true);
    expect(transportController.getTrainingTargets()).toEqual(new Set([48]));
    expect(h.scheduled).toEqual([]);
  });

  it('never gates in simple mode', () => {
    useSettingsStore.getState().setPlaybackMode('simple');
    transportController.play();
    runTo(400);
    expect(transportController.isWaitingForTraining()).toBe(false);
    expect(h.scheduled).toEqual([48, 64, 67]);
  });

  it('lets the last notes ring out when the take plays to its end', () => {
    useSettingsStore.getState().setPlaybackMode('simple');
    vi.mocked(audioEngine.allNotesOff).mockClear();
    transportController.play();
    runTo(900);
    expect(transportController.getState()).toBe('paused');
    // Every note has been let go; what still sounds is dying away by itself,
    // for seconds on a top string with no damper.
    expect(audioEngine.allNotesOff).not.toHaveBeenCalled();
    transportController.stop();
    expect(audioEngine.allNotesOff).toHaveBeenCalledOnce();
  });

  it('carries on rather than parking when the mode changes under a hold', () => {
    transportController.play();
    runTo(350);
    expect(transportController.isWaitingForTraining()).toBe(true);

    useSettingsStore.getState().setPlaybackMode('simple');
    transportController.refreshTrainingMode();
    expect(transportController.isWaitingForTraining()).toBe(false);
    expect(transportController.getTrainingTargets().size).toBe(0);
    // Stripping the targets but leaving the transport parked is not what
    // changing a mode mid-playback promises.
    expect(transportController.getState()).toBe('playing');
    runTo(400);
    expect(h.scheduled).toEqual([48, 64, 67]);
  });
});

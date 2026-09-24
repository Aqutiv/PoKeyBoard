import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputNoteEvent } from '@/audio/AudioEngine';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';

/**
 * The engine is the clock and the ear: `now` drives the transport clock and
 * `scheduled` records what would have sounded, and when, and for how long.
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
    setInstrument: vi.fn(() => Promise.resolve()),
    scheduleNote: vi.fn((event: { midi: number; durationMs: number }, when: number) =>
      h.scheduled.push({ midi: event.midi, when, durationMs: event.durationMs }),
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
    setGrid(): void {}
    topUpSchedule(): void {}
  },
  gridForTake: () => ({}),
  constantClickGrid: () => ({}),
}));

function note(id: string, midi: number, startMs: number, durationMs = 200): NoteEvent {
  return { id, midi, startMs, durationMs, velocity: 0.6, staff: 'treble' };
}

/** A note every half second: 60 at 0 ms, 61 at 500 ms … 67 at 3500 ms. */
const NOTES = Array.from({ length: 8 }, (_, i) => note(`n${i}`, 60 + i, i * 500));

/** Advance the audio clock `seconds`, ticking the 25 ms scheduler as it goes. */
function run(seconds: number): void {
  for (let step = 0; step < Math.round(seconds * 100); step += 1) {
    h.now += 0.01;
    vi.advanceTimersByTime(10);
  }
}

describe('playback speed and looping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.now = 0;
    h.scheduled = [];
    h.inputs.clear();
    useSettingsStore.getState().setPlaybackMode('simple');
    useTakeStore.getState().setTake(createEmptyTake({ notes: NOTES, durationMs: 4000 }));
    transportController.seek(0);
  });

  afterEach(() => {
    transportController.stop();
    useSettingsStore.getState().setPlaybackMode('simple');
    vi.useRealTimers();
  });

  it('plays the same notes further apart at half speed, held twice as long', () => {
    transportController.setSpeed(0.5);
    transportController.play();
    run(2.2);
    const [first, second, third] = h.scheduled;
    // 500 ms of take between notes is a second of audio.
    expect(second!.when - first!.when).toBeCloseTo(1, 6);
    expect(third!.when - second!.when).toBeCloseTo(1, 6);
    expect(first!.durationMs).toBeCloseTo(400, 6);
    expect(transportController.getPlayheadMs()).toBeLessThan(1100);
  });

  it('keeps the speed with the take, and 100% as no setting at all', () => {
    transportController.setSpeed(0.75);
    expect(useTakeStore.getState().take.display.speed).toBe(0.75);
    transportController.setSpeed(1);
    expect(useTakeStore.getState().take.display.speed).toBeUndefined();
    transportController.setSpeed(9);
    expect(transportController.getSpeed()).toBe(1.5);
  });

  it('changes speed mid-playback from where it is, without starting again', () => {
    transportController.play();
    run(1.07); // just past the note at 1000 ms
    const position = transportController.getPlayheadMs();
    const heard = h.scheduled.length;
    transportController.setSpeed(0.5);
    expect(transportController.getState()).toBe('playing');
    expect(transportController.getPlayheadMs()).toBeCloseTo(position, 0);
    run(2);
    // Nothing heard twice, and the rest a second apart.
    const midis = h.scheduled.map((event) => event.midi);
    expect(new Set(midis).size).toBe(midis.length);
    const after = h.scheduled.slice(heard);
    expect(after[1]!.when - after[0]!.when).toBeCloseTo(1, 6);
  });

  it('repeats a loop, pass after pass, and never plays past its end', () => {
    // Loop the second second: the notes at 1000 and 1500 ms.
    transportController.setLoop({ startMs: 1000, endMs: 2000 });
    transportController.play();
    let furthest = 0;
    for (let i = 0; i < 40; i += 1) {
      run(0.1);
      furthest = Math.max(furthest, transportController.getPlayheadMs());
    }
    expect(furthest).toBeLessThan(2000);
    expect(transportController.getState()).toBe('playing');
    // 60 and 61 on the way in, then 62 and 63 again and again, a second apart.
    const midis = h.scheduled.map((event) => event.midi);
    expect(midis.slice(0, 6)).toEqual([60, 61, 62, 63, 62, 63]);
    expect(midis).not.toContain(64);
    const second62 = h.scheduled.filter((event) => event.midi === 62);
    expect(second62[1]!.when - second62[0]!.when).toBeCloseTo(1, 6);
  });

  it('lets a note go at the loop’s end rather than over its top', () => {
    useTakeStore
      .getState()
      .setTake(createEmptyTake({ notes: [note('long', 60, 0, 3000)], durationMs: 3000 }));
    transportController.setLoop({ startMs: 0, endMs: 1000 });
    transportController.play();
    run(0.5);
    expect(h.scheduled[0]!.durationMs).toBe(1000);
  });

  it('starts a loop from its top when playing from past its end', () => {
    transportController.seek(3000);
    transportController.setLoop({ startMs: 1000, endMs: 2000 });
    transportController.play();
    run(0.2);
    expect(h.scheduled.map((event) => event.midi)).toEqual([62]);
  });

  it('jumps to the loop when one is set mid-playback outside it, and plays on when cleared', () => {
    transportController.play();
    run(0.3);
    transportController.setLoop({ startMs: 2000, endMs: 3000 });
    // Every start is anchored 60 ms ahead of the audio clock.
    h.now += 0.06;
    expect(transportController.getPlayheadMs()).toBeCloseTo(2000, 6);
    run(1.5);
    expect(transportController.getPlayheadMs()).toBeLessThan(3000);
    transportController.setLoop(null);
    run(2);
    expect(h.scheduled.map((event) => event.midi)).toContain(67);
  });

  it('holds for the trained hand every time round the loop', () => {
    const notes = [
      note('a', 64, 0),
      note('b', 65, 500),
      { ...note('c', 48, 250), staff: 'bass' as const },
    ];
    useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 1000 }));
    useSettingsStore.getState().setPlaybackMode('training-left');
    transportController.setLoop({ startMs: 0, endMs: 1000 });
    transportController.play();
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < 200 && !transportController.isWaitingForTraining(); i += 1) run(0.01);
      expect(transportController.isWaitingForTraining()).toBe(true);
      expect(transportController.getPlayheadMs()).toBe(250);
      for (const listener of [...h.inputs]) {
        listener({ type: 'on', midi: 48, velocity: 0.7, audioTime: h.now, sourceId: 'kbd' });
      }
      expect(transportController.isWaitingForTraining()).toBe(false);
    }
  });

  it('still holds for a note already in sight when the speed changes', () => {
    const notes = [note('a', 64, 0), { ...note('b', 48, 500), staff: 'bass' as const }];
    useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 1000 }));
    useSettingsStore.getState().setPlaybackMode('training-left');
    transportController.play();
    while (transportController.getPlayheadMs() < 420) run(0.01);
    // Faster: the look-ahead now reaches past the hold, which must stay put.
    transportController.setSpeed(1.5);
    for (let i = 0; i < 200 && !transportController.isWaitingForTraining(); i += 1) run(0.01);
    expect(transportController.isWaitingForTraining()).toBe(true);
    expect(transportController.getPlayheadMs()).toBe(500);
    expect(h.scheduled.map((event) => event.midi)).toEqual([64]);
  });

  it('records at the take’s own speed, straight through any loop', async () => {
    transportController.setSpeed(0.5);
    transportController.setLoop({ startMs: 0, endMs: 1000 });
    useTakeStore.getState().setTempo({
      ...useTakeStore.getState().take.tempo,
      countInBars: 0,
    });
    await transportController.record('overdub');
    run(1.6);
    // The backing plays at full speed and past the loop's end.
    const midis = h.scheduled.map((event) => event.midi);
    expect(midis.slice(0, 4)).toEqual([60, 61, 62, 63]);
    expect(h.scheduled[1]!.when - h.scheduled[0]!.when).toBeCloseTo(0.5, 6);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputNoteEvent } from '@/audio/AudioEngine';
import type { AskedNote } from '@/domain/trainingGate';
import {
  END_GRACE_MS,
  reducePlayAlongRun,
  startPlayAlongRun,
  type KeepTimeReport,
  type PlayAlongDeps,
  type PlayAlongRun,
} from '@/features/practice/playAlongSession';
import type { PracticeRun, RunEndReason } from '@/features/transport/practiceEvents';
import { practiceRun } from './practiceFixtures';

const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const B4 = 71;

const asked = (id: string, midi: number, startMs: number): AskedNote => ({ id, midi, startMs });

/**
 * A Keep-time run of the right hand's C4, D4, E4 and F4, half a second apart,
 * at 120 bpm. Play was pressed at 10 s on the audio clock, and a bar was
 * counted in: the run sets off at 12, so its notes fall due at 12, 12.5, 13
 * and 13.5.
 */
const RUN: PracticeRun = practiceRun({
  runId: 4,
  style: 'playAlong',
  anchorAudioTime: 12,
  countInMs: 2000,
  durationMs: 2000,
  takeDurationMs: 2000,
  asked: [asked('c', C4, 0), asked('d', D4, 500), asked('e', E4, 1000), asked('f', F4, 1500)],
});

/** The engine and the page as the session sees them: both clocks, the keys, and the flash. */
const h = {
  audio: 10,
  performance: 5000,
  latencyMs: 180,
  inputs: new Set<(event: InputNoteEvent) => void>(),
  flashed: [] as number[],
};

const deps: PlayAlongDeps = {
  subscribeInput: (listener) => {
    h.inputs.add(listener);
    return () => void h.inputs.delete(listener);
  },
  outputLatencyMs: () => h.latencyMs,
  audioTime: () => h.audio,
  now: () => h.performance,
  flashWrongKey: (midi) => h.flashed.push(midi),
};

/** Press a key at `audioTime` on the audio clock, as the engine stamps it, and let it go. */
function press(midi: number, audioTime: number): void {
  h.audio = audioTime;
  for (const listener of [...h.inputs]) {
    listener({ type: 'on', midi, velocity: 0.7, audioTime, sourceId: 'kbd' });
  }
  for (const listener of [...h.inputs]) {
    listener({ type: 'off', midi, audioTime: audioTime + 0.1, sourceId: 'kbd' });
  }
}

let session: PlayAlongRun | null = null;
let reports: KeepTimeReport[] = [];

function start(run: PracticeRun = RUN): PlayAlongRun {
  session = startPlayAlongRun(run, deps);
  return session;
}

/** End the run at `audioTime`, for `reason`. */
function end(reason: RunEndReason, audioTime: number): void {
  h.audio = audioTime;
  session?.end({ reason, audioTime }, (report) => reports.push(report));
}

beforeEach(() => {
  vi.useFakeTimers();
  h.audio = 10;
  h.performance = 5000;
  h.latencyMs = 180;
  h.inputs.clear();
  h.flashed = [];
  reports = [];
});

afterEach(() => {
  session?.cancel();
  session = null;
  vi.useRealTimers();
});

describe('a Keep-time run’s presses', () => {
  it('are heard as the music the player heard: 180 ms late through 180 ms of latency is on time', () => {
    start();
    // Each pressed just as its note reached the player's ears.
    press(C4, 12.18);
    press(D4, 12.68);
    press(E4, 13.18);
    // F4 a tenth of a second after that.
    press(F4, 13.78);
    end('end', 13.8);
    vi.advanceTimersByTime(END_GRACE_MS + 180);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ notes: 4, onTime: 3, late: 1, wrong: 0 });
    expect(h.flashed).toEqual([]);
  });

  it('count for nothing while the run counts the player in, though the first note may come early', () => {
    start();
    // The count-in's beats, played along on the keys.
    press(C4, 10.18);
    press(E4, 10.68);
    press(B4, 11.18);
    // 150 ms ahead of the first note, which is in its window.
    press(C4, 12.03);
    end('pause', 12.2);
    expect(reports[0]).toMatchObject({ notes: 1, early: 1, wrong: 0 });
    expect(h.flashed).toEqual([]);
  });

  // The first note falls due as the run sets off, at 12, so its window opens
  // in the last 200 ms of the count-in: heard there, a press is 11.8 or later.
  it('count for nothing in the last of the count-in unless they play the first note', () => {
    start();
    // Heard at 11.85 and 11.9: E4 is asked for nowhere near.
    press(E4, 12.03);
    press(B4, 12.08);
    expect(h.flashed).toEqual([]);
    // Heard at 12, as the run sets off.
    press(C4, 12.18);
    end('pause', 12.25);
    expect(reports[0]).toMatchObject({ notes: 1, onTime: 1, wrong: 0 });
    expect(h.flashed).toEqual([]);
  });

  it('play the first note early in the last of the count-in', () => {
    start();
    // Heard at 11.88, 120 ms ahead of C4.
    press(C4, 12.06);
    end('pause', 12.25);
    expect(reports[0]).toMatchObject({ notes: 1, early: 1, wrong: 0 });
    expect(h.flashed).toEqual([]);
  });

  it('flash, and count as wrong, a key played just after the run sets off with no note near', () => {
    start();
    press(C4, 12.18);
    // Heard at 12.05, past the anchor: E4 is not due until 13.
    press(E4, 12.23);
    expect(h.flashed).toEqual([E4]);
    end('pause', 12.25);
    expect(reports[0]).toMatchObject({ notes: 1, onTime: 1, wrong: 1 });
  });

  it('flash a key at once where no note near it asks for that key', () => {
    start();
    // Asked for nowhere.
    press(B4, 12.3);
    // D4 150 ms ahead of its note: near enough.
    press(D4, 12.53);
    // Twice: the second strike of a key in its window is no wrong note.
    press(D4, 12.7);
    // C4, but its note was more than a second ago.
    press(C4, 13.1);
    expect(h.flashed).toEqual([B4, C4]);
  });

  it('look for the notes where the speed has put them', () => {
    start();
    // Halved at 12.5, as D4 falls due: E4 comes a second later, at 13.5.
    session?.hear({ runId: 4, type: 'speed', speed: 0.5, audioTime: 12.5 });
    // E4 heard at 13.45, near its note now, though nowhere near 13.
    press(E4, 13.63);
    expect(h.flashed).toEqual([]);
    end('pause', 13.9);
    expect(reports[0]).toMatchObject({ onTime: 1, wrong: 0, slowestSpeed: 0.5 });
  });

  it('are listened for a little longer once the run plays to its end, for the last note late', () => {
    // A short last note: the run ends at 13.6, just after F4 falls due at 13.5.
    start();
    press(C4, 12.18);
    press(D4, 12.68);
    press(E4, 13.18);
    end('end', 13.6);
    // F4 150 ms late, which reaches the run after it has ended…
    press(F4, 13.83);
    // …and a key played once the music is over, which is no wrong note.
    press(B4, 13.95);
    expect(h.flashed).toEqual([]);
    expect(reports).toEqual([]);
    expect(h.inputs.size).toBe(1);

    vi.advanceTimersByTime(END_GRACE_MS + 180);
    expect(h.inputs.size).toBe(0);
    expect(reports[0]).toMatchObject({ notes: 4, onTime: 3, late: 1, missed: 0, wrong: 0 });
  });

  it('stop being listened for when a run is paused, and leave out a note it was still open for', () => {
    start();
    press(C4, 12.18);
    // Paused 100 ms after D4 fell due, before its window closed: neither
    // played nor missed. E4's window was not open yet.
    end('pause', 12.6);
    expect(h.inputs.size).toBe(0);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ notes: 1, onTime: 1, missed: 0 });
  });

  it('count a note played before a stop cut its window short', () => {
    start();
    press(C4, 12.18);
    press(D4, 12.66);
    end('stop', 12.7);
    expect(reports[0]).toMatchObject({ notes: 2, onTime: 2 });
  });

  it('stop being listened for once the run is put away unended', () => {
    start();
    expect(h.inputs.size).toBe(1);
    session?.cancel();
    expect(h.inputs.size).toBe(0);
  });
});

describe('where a Keep-time run’s presses land', () => {
  it('is published as the moment on the page’s clock a press would land on the run’s start', () => {
    // Pressed then, a key is heard 180 ms on, as the run sets off at 12 s.
    expect(start().pressOriginMs).toBeCloseTo(5000 + (12 + 0.18 - 10) * 1000, 6);
  });
});

describe('a Keep-time run’s report', () => {
  it('tells a run through the take in sections of four bars, by the share on time', () => {
    const report = reducePlayAlongRun(
      RUN,
      [],
      [
        { midi: C4, audioTime: 12 },
        { midi: D4, audioTime: 12.5 },
      ],
      { endAudioTime: 13.6, heardUntil: Number.POSITIVE_INFINITY },
    );
    expect(report.cells).toEqual([
      {
        kind: 'bars',
        fromBar: 1,
        toBar: 1,
        startMs: 0,
        endMs: 2000,
        good: 2,
        total: 4,
        grade: 'weak',
      },
    ]);
  });

  it('tells a run round a loop pass by pass, from where the run started', () => {
    // Round 0–1000, from 500: D4 alone the first time, C4 and D4 every time after.
    const run = practiceRun({
      ...RUN,
      fromMs: 500,
      loop: { startMs: 0, endMs: 1000 },
      asked: [asked('c', C4, 0), asked('d', D4, 500)],
    });
    // The run reaches 500 at 12, and comes round to the loop's top at 12.5
    // and every second after.
    const report = reducePlayAlongRun(
      run,
      [],
      [
        { midi: D4, audioTime: 12 },
        { midi: C4, audioTime: 12.5 },
        { midi: C4, audioTime: 13.5 },
        { midi: D4, audioTime: 14 },
      ],
      { endAudioTime: 14.2, heardUntil: 14.2 },
    );
    expect(report.cells).toEqual([
      { kind: 'pass', pass: 1, good: 1, total: 1, grade: 'good' },
      { kind: 'pass', pass: 2, good: 1, total: 2, grade: 'weak' },
      { kind: 'pass', pass: 3, good: 2, total: 2, grade: 'good' },
    ]);
  });
});

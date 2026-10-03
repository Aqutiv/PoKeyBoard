import { describe, expect, it } from 'vitest';
import type { AskedNote } from '@/domain/trainingGate';
import { audioTimeAt, dueNotes, runMsAt, runTimeline } from '@/features/practice/runTimeline';
import type { PracticeEvent } from '@/features/transport/practiceEvents';
import { practiceRun } from './practiceFixtures';

const asked = (id: string, midi: number, startMs: number): AskedNote => ({ id, midi, startMs });

const speed = (value: number, audioTime: number | null, runId = 1): PracticeEvent => ({
  runId,
  type: 'speed',
  speed: value,
  audioTime,
});

describe('a Keep-time run’s timeline', () => {
  it('reaches the run’s start at its anchor, after a count-in', () => {
    // Play pressed at 10 s; a bar counted in at 120 bpm sets the run off at 12.
    const run = practiceRun({ style: 'playAlong', fromMs: 500, anchorAudioTime: 12 });
    const timeline = runTimeline(run);
    expect(timeline).toEqual([{ audioTime: 12, runMs: 500, rate: 1 }]);
    // Counting in, the run is still short of where it starts.
    expect(runMsAt(timeline, 10)).toBeCloseTo(-1500, 9);
    expect(runMsAt(timeline, 12)).toBeCloseTo(500, 9);
    expect(runMsAt(timeline, 12.5)).toBeCloseTo(1000, 9);
    expect(audioTimeAt(timeline, 500)).toBeCloseTo(12, 9);
    expect(audioTimeAt(timeline, 1000)).toBeCloseTo(12.5, 9);
  });

  it('runs at the speed it started at', () => {
    const run = practiceRun({ style: 'playAlong', speed: 0.5, anchorAudioTime: 10 });
    const timeline = runTimeline(run);
    expect(runMsAt(timeline, 12)).toBeCloseTo(1000, 9);
    expect(audioTimeAt(timeline, 1500)).toBeCloseTo(13, 9);
  });

  it('carries on from where it had got to at a change of speed', () => {
    const run = practiceRun({ style: 'playAlong', anchorAudioTime: 10 });
    // Halved a second in, at 1000; doubled two seconds after, at 2000.
    const timeline = runTimeline(run, [speed(0.5, 11), speed(2, 13)]);
    expect(timeline).toEqual([
      { audioTime: 10, runMs: 0, rate: 1 },
      { audioTime: 11, runMs: 1000, rate: 0.5 },
      { audioTime: 13, runMs: 2000, rate: 2 },
    ]);
    expect(runMsAt(timeline, 10.5)).toBeCloseTo(500, 9);
    expect(runMsAt(timeline, 12)).toBeCloseTo(1500, 9);
    expect(runMsAt(timeline, 13.5)).toBeCloseTo(3000, 9);
    expect(audioTimeAt(timeline, 500)).toBeCloseTo(10.5, 9);
    expect(audioTimeAt(timeline, 1500)).toBeCloseTo(12, 9);
    expect(audioTimeAt(timeline, 3000)).toBeCloseTo(13.5, 9);
  });

  it('leaves out a change of speed told without a time, or for another run', () => {
    const run = practiceRun({ style: 'playAlong', anchorAudioTime: 10 });
    const timeline = runTimeline(run, [speed(0.5, null), speed(0.5, 11, 2)]);
    expect(timeline).toEqual([{ audioTime: 10, runMs: 0, rate: 1 }]);
  });

  it('goes on growing round a loop, a pass further on each time', () => {
    const run = practiceRun({
      style: 'playAlong',
      loop: { startMs: 1000, endMs: 3000 },
      anchorAudioTime: 10,
    });
    const timeline = runTimeline(run);
    // Not folded back: the second pass's 1000 is 3000 on, the third's 5000.
    expect(runMsAt(timeline, 14)).toBeCloseTo(4000, 9);
    expect(audioTimeAt(timeline, 5000)).toBeCloseTo(15, 9);
  });
});

describe('the notes a Keep-time run asks for', () => {
  const SCALE = [
    asked('c', 60, 0),
    asked('d', 62, 500),
    asked('e', 64, 1000),
    asked('f', 65, 1500),
    asked('g', 67, 2000),
  ];

  it('are those from where the run starts, up to where it has got to', () => {
    const run = practiceRun({ style: 'playAlong', fromMs: 400, asked: SCALE });
    expect(dueNotes(run, 1500)).toEqual([
      { id: 'd', midi: 62, atMs: 500, runMs: 500, pass: 0 },
      { id: 'e', midi: 64, atMs: 1000, runMs: 1000, pass: 0 },
      { id: 'f', midi: 65, atMs: 1500, runMs: 1500, pass: 0 },
    ]);
    expect(dueNotes(run, 399)).toEqual([]);
    expect(dueNotes(run, Number.POSITIVE_INFINITY).map((note) => note.id)).toEqual([
      'd',
      'e',
      'f',
      'g',
    ]);
  });

  it('come round a loop pass by pass, from where the run started the first time', () => {
    // Started at 1200, inside the loop 1000–2000: the first pass asks for
    // 1500 alone, every pass after for 1000 and 1500.
    const run = practiceRun({
      style: 'playAlong',
      fromMs: 1200,
      loop: { startMs: 1000, endMs: 2000 },
      asked: SCALE,
    });
    expect(dueNotes(run, 3600)).toEqual([
      { id: 'f', midi: 65, atMs: 1500, runMs: 1500, pass: 0 },
      { id: 'e', midi: 64, atMs: 1000, runMs: 2000, pass: 1 },
      { id: 'f', midi: 65, atMs: 1500, runMs: 2500, pass: 1 },
      { id: 'e', midi: 64, atMs: 1000, runMs: 3000, pass: 2 },
      { id: 'f', midi: 65, atMs: 1500, runMs: 3500, pass: 2 },
    ]);
  });

  it('need a point to stop at round a loop, which goes round for ever', () => {
    const run = practiceRun({
      style: 'playAlong',
      loop: { startMs: 0, endMs: 1000 },
      asked: SCALE,
    });
    expect(() => dueNotes(run, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('take in what comes before a loop on the way into it, and never its end', () => {
    const run = practiceRun({
      style: 'playAlong',
      loop: { startMs: 1000, endMs: 2000 },
      asked: SCALE,
    });
    expect(dueNotes(run, 3000).map((note) => `${note.id}${note.pass}`)).toEqual([
      'c0',
      'd0',
      'e0',
      'f0',
      'e1',
      'f1',
      'e2',
    ]);
  });

  it('ask for a key once where two voices strike it together, or a chord’s width apart', () => {
    const run = practiceRun({
      style: 'playAlong',
      asked: [
        // A unison in two voices.
        asked('upper', 67, 0),
        asked('lower', 67, 0),
        asked('third', 64, 0),
        // The same key a hair later, as a rolled chord might give it.
        asked('roll', 64, 40),
        // Further apart than a chord: struck again.
        asked('again', 64, 120),
      ],
    });
    expect(dueNotes(run, 1000).map((note) => note.id)).toEqual(['upper', 'third', 'again']);
  });

  it('ask for a key once where a loop’s end and its top strike it a hair apart', () => {
    const run = practiceRun({
      style: 'playAlong',
      loop: { startMs: 0, endMs: 1000 },
      asked: [asked('top', 60, 10), asked('end', 60, 980)],
    });
    // 980 in the first pass, and 1010 at the top of the second: one strike.
    expect(dueNotes(run, 2000).map((note) => `${note.id}${note.pass}`)).toEqual([
      'top0',
      'end0',
      'end1',
    ]);
  });
});

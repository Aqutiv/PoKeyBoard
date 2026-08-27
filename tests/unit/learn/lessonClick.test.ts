import { describe, expect, it } from 'vitest';
import { lessonGrid, nextBarAudioTimeOn } from '@/features/learn/lessonClick';

const FOUR_FOUR = { numerator: 4, denominator: 4 } as const;

describe('lessonGrid', () => {
  it('places a beat a second apart at 60bpm', () => {
    const grid = lessonGrid(60, FOUR_FOUR, 10);
    expect(grid.audioTimeAt(0)).toBeCloseTo(10);
    expect(grid.audioTimeAt(4) - grid.audioTimeAt(0)).toBeCloseTo(4);
  });

  it('round-trips a beat index through the audio clock', () => {
    const grid = lessonGrid(60, FOUR_FOUR, 10);
    for (const index of [0, 1, 7, 12, 33]) {
      expect(grid.indexAt(grid.audioTimeAt(index))).toBeCloseTo(index);
    }
  });

  it('reads a moment between beats as a fraction', () => {
    const grid = lessonGrid(60, FOUR_FOUR, 10);
    expect(grid.indexAt(10.5)).toBeCloseTo(0.5);
    expect(grid.indexAt(13.25)).toBeCloseTo(3.25);
  });

  it('accents beat zero and every bar line after it', () => {
    // The rhythm matcher's bar arithmetic is exact rather than a search
    // *because* of this: bar lines are the whole multiples of the numerator,
    // so `round((at - beats[0]) / barBeats) * barBeats` is the bar. Swap in a
    // grid whose beat 0 is not a downbeat and the whole rule breaks silently.
    const grid = lessonGrid(60, FOUR_FOUR, 10);
    expect(grid.numerator).toBe(4);
    for (let index = 0; index < 12; index += 1) {
      expect(grid.isAccent(index), `beat ${index}`).toBe(index % 4 === 0);
    }
  });

  it('reads a moment before the first click as negative', () => {
    // What `startRhythm`'s `origin < 0` guard exists for: a press before the
    // click began would otherwise be measured against a bar that never sounded.
    const grid = lessonGrid(60, FOUR_FOUR, 10);
    expect(grid.indexAt(9.5)).toBeLessThan(0);
  });

  it('follows the tempo it is given', () => {
    const fast = lessonGrid(120, FOUR_FOUR, 0);
    expect(fast.audioTimeAt(1) - fast.audioTimeAt(0)).toBeCloseTo(0.5);
  });
});

describe('nextBarAudioTimeOn', () => {
  const grid = lessonGrid(60, FOUR_FOUR, 10);

  it('finds the bar line a demo should start on', () => {
    // A Listen demo has to land *on* the beats the user is about to be graded
    // against; started wherever the button happened to be pressed, the same
    // phrase drifts and teaches the opposite of the step.
    expect(nextBarAudioTimeOn(grid, 10)).toBeCloseTo(10);
    expect(nextBarAudioTimeOn(grid, 10.25)).toBeCloseTo(14);
    expect(nextBarAudioTimeOn(grid, 13.9)).toBeCloseTo(14);
    expect(nextBarAudioTimeOn(grid, 14)).toBeCloseTo(14);
    expect(nextBarAudioTimeOn(grid, 14.1)).toBeCloseTo(18);
  });

  it('never points before the click began', () => {
    expect(nextBarAudioTimeOn(grid, 5)).toBeCloseTo(10);
  });
});

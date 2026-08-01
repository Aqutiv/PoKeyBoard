import { describe, expect, it } from 'vitest';
import {
  initExercise,
  needsRangeShift,
  progressOf,
  reduceExercise,
  targetMidisFor,
  type ExerciseState,
} from '@/features/learn/exerciseMatcher';
import { goalTotal, type ExerciseSpec } from '@/features/learn/exerciseSpec';

/** One scripted event: press or release a midi at an audio-clock millisecond. */
type Beat = ['on' | 'off', number, number?];

/**
 * Fold a script through the same normalization `useExercise` applies, so the
 * tests exercise the held-set bookkeeping the adapter is responsible for —
 * including the orphan releases `AudioEngine.noteOff` emits unconditionally.
 */
function run(spec: ExerciseSpec, script: readonly Beat[]): ExerciseState {
  const held = new Set<number>();
  let state = initExercise();
  for (const [type, midi, atMs = 0] of script) {
    if (type === 'on') {
      if (held.has(midi)) continue;
      held.add(midi);
      state = reduceExercise(spec, state, { kind: 'press', midi, atMs, held: new Set(held) });
    } else {
      if (!held.delete(midi)) continue;
      state = reduceExercise(spec, state, { kind: 'release', midi, atMs, held: new Set(held) });
    }
  }
  return state;
}

function progress(spec: ExerciseSpec, script: readonly Beat[]): string {
  const { done, total, satisfied } = progressOf(spec, run(spec, script));
  return `${done}/${total}${satisfied ? ' ok' : ''}`;
}

const C4 = 60;
const C5 = 72;
const C3 = 48;

describe('distinctKeys', () => {
  const spec: ExerciseSpec = { kind: 'distinctKeys', count: 3 };

  it('counts three different keys', () => {
    expect(
      progress(spec, [
        ['on', 60],
        ['on', 62],
        ['on', 64],
      ]),
    ).toBe('3/3 ok');
  });

  it('does not count the same key repeatedly', () => {
    expect(
      progress(spec, [
        ['on', 60],
        ['off', 60],
        ['on', 60],
        ['off', 60],
        ['on', 60],
      ]),
    ).toBe('1/3');
  });

  it('ignores a duplicate note-on with no intervening note-off', () => {
    expect(
      progress(spec, [
        ['on', 60],
        ['on', 60],
        ['on', 62],
      ]),
    ).toBe('2/3');
  });

  it('tolerates a release for a note that never sounded', () => {
    expect(
      progress(spec, [
        ['off', 99],
        ['on', 60],
      ]),
    ).toBe('1/3');
  });

  it('offers no targets, because any key is correct', () => {
    expect(targetMidisFor(spec, initExercise(), { lowMidi: 48, highMidi: 72 }).size).toBe(0);
    expect(needsRangeShift(spec, initExercise(), { lowMidi: 48, highMidi: 72 })).toBe(false);
  });
});

describe('risingLeap', () => {
  const spec: ExerciseSpec = { kind: 'risingLeap', minSemitoneGap: 12 };

  it('accepts a low note then a much higher one', () => {
    expect(
      progress(spec, [
        ['on', C3],
        ['on', C5],
      ]),
    ).toBe('2/2 ok');
  });

  it('accepts the leap played downwards too', () => {
    expect(
      progress(spec, [
        ['on', C5],
        ['on', C3],
      ]),
    ).toBe('2/2 ok');
  });

  it('rejects two neighbouring keys', () => {
    expect(
      progress(spec, [
        ['on', 60],
        ['on', 62],
      ]),
    ).toBe('1/2');
  });

  it('counts a single key as half the gesture', () => {
    expect(progress(spec, [['on', 60]])).toBe('1/2');
  });

  it('offers no targets and never asks for a range shift', () => {
    const range = { lowMidi: 60, highMidi: 71 };
    expect(targetMidisFor(spec, initExercise(), range).size).toBe(0);
    expect(needsRangeShift(spec, initExercise(), range)).toBe(false);
  });
});

describe('pitchClass', () => {
  const threeCs: ExerciseSpec = { kind: 'pitchClass', pitchClass: 0, octaves: 3 };

  it('counts three different Cs', () => {
    expect(
      progress(threeCs, [
        ['on', C3],
        ['on', C4],
        ['on', C5],
      ]),
    ).toBe('3/3 ok');
  });

  it('does not count one C three times', () => {
    expect(
      progress(threeCs, [
        ['on', C4],
        ['off', C4],
        ['on', C4],
        ['off', C4],
        ['on', C4],
      ]),
    ).toBe('1/3');
  });

  it('ignores notes of other pitch classes', () => {
    expect(
      progress(threeCs, [
        ['on', 59],
        ['on', 62],
        ['on', C4],
      ]),
    ).toBe('1/3');
  });

  it('accumulates across a keyboard range shift', () => {
    // The phone case: no window ever shows three Cs, so credit must survive
    // the user sliding the keyboard between presses.
    expect(
      progress(threeCs, [
        ['on', C4],
        ['off', C4],
        ['on', C5],
        ['off', C5],
        ['on', 84],
      ]),
    ).toBe('3/3 ok');
  });

  it('defaults to a single octave when none is asked for', () => {
    const anyC: ExerciseSpec = { kind: 'pitchClass', pitchClass: 0 };
    expect(goalTotal(anyC)).toBe(1);
    expect(progress(anyC, [['on', C4]])).toBe('1/1 ok');
  });

  it('targets every uncredited C on screen', () => {
    const after = run(threeCs, [['on', C4]]);
    expect([...targetMidisFor(threeCs, after, { lowMidi: 48, highMidi: 84 })]).toEqual([
      48, 72, 84,
    ]);
  });

  it('asks for a range shift when no C is on screen', () => {
    const range = { lowMidi: 61, highMidi: 71 };
    expect(needsRangeShift(threeCs, initExercise(), range)).toBe(true);
  });
});

describe('interval', () => {
  const octave: ExerciseSpec = {
    kind: 'interval',
    semitones: 12,
    lowerPitchClass: 0,
    together: { overlap: true },
  };

  it('accepts two Cs held together', () => {
    expect(
      progress(octave, [
        ['on', C4],
        ['on', C5],
      ]),
    ).toBe('2/2 ok');
  });

  it('rejects the same two Cs played one after the other', () => {
    expect(
      progress(octave, [
        ['on', C4],
        ['off', C4],
        ['on', C5],
      ]),
    ).toBe('1/2');
  });

  it('rejects an octave on the wrong pitch class', () => {
    expect(
      progress(octave, [
        ['on', 62],
        ['on', 74],
      ]),
    ).toBe('0/2');
  });

  it('rejects a fifth', () => {
    expect(
      progress(octave, [
        ['on', C4],
        ['on', 67],
      ]),
    ).toBe('1/2');
  });

  it('rejects two octaves apart', () => {
    expect(
      progress(octave, [
        ['on', C4],
        ['on', 84],
      ]),
    ).toBe('1/2');
  });

  it('accepts a fast roll when an onset window is allowed', () => {
    // A desktop mouse is one pointer and cannot hold two keys at once.
    const rolled: ExerciseSpec = { ...octave, together: { overlap: true, onsetWindowMs: 400 } };
    expect(
      progress(rolled, [
        ['on', C4, 0],
        ['off', C4, 100],
        ['on', C5, 300],
      ]),
    ).toBe('2/2 ok');
    expect(
      progress(rolled, [
        ['on', C4, 0],
        ['off', C4, 100],
        ['on', C5, 900],
      ]),
    ).toBe('1/2');
  });

  it('targets the first playable pair on screen', () => {
    expect([...targetMidisFor(octave, initExercise(), { lowMidi: 55, highMidi: 79 })]).toEqual([
      60, 72,
    ]);
  });
});

describe('blackKeyGroup', () => {
  const two: ExerciseSpec = { kind: 'blackKeyGroup', size: 2, together: { overlap: true } };
  const three: ExerciseSpec = { kind: 'blackKeyGroup', size: 3, together: { overlap: true } };

  it('accepts C#4 and D#4 together', () => {
    expect(
      progress(two, [
        ['on', 61],
        ['on', 63],
      ]),
    ).toBe('2/2 ok');
  });

  it('reports a half-finished group', () => {
    expect(progress(two, [['on', 61]])).toBe('1/2');
  });

  it('rejects two black keys from the group of three', () => {
    expect(
      progress(two, [
        ['on', 66],
        ['on', 68],
      ]),
    ).toBe('0/2');
  });

  it('rejects two black keys straddling different groups', () => {
    expect(
      progress(two, [
        ['on', 61],
        ['on', 70],
      ]),
    ).toBe('1/2');
  });

  it('accepts all three of F#4 G#4 A#4', () => {
    expect(
      progress(three, [
        ['on', 66],
        ['on', 68],
        ['on', 70],
      ]),
    ).toBe('3/3 ok');
  });

  it('reports two of three', () => {
    expect(
      progress(three, [
        ['on', 66],
        ['on', 68],
      ]),
    ).toBe('2/3');
  });

  it('targets one concrete group rather than every group on screen', () => {
    expect([...targetMidisFor(two, initExercise(), { lowMidi: 60, highMidi: 84 })]).toEqual([
      61, 63,
    ]);
  });
});

describe('exactKeys', () => {
  const cMajor: ExerciseSpec = {
    kind: 'exactKeys',
    midis: [60, 64, 67],
    together: { overlap: true },
  };

  it('accepts the whole chord held', () => {
    expect(
      progress(cMajor, [
        ['on', 60],
        ['on', 64],
        ['on', 67],
      ]),
    ).toBe('3/3 ok');
  });

  it('reports partial progress', () => {
    expect(
      progress(cMajor, [
        ['on', 60],
        ['on', 64],
      ]),
    ).toBe('2/3');
  });

  it('ignores notes outside the chord', () => {
    expect(
      progress(cMajor, [
        ['on', 62],
        ['on', 60],
      ]),
    ).toBe('1/3');
  });
});

describe('satisfaction is sticky', () => {
  it('does not fall back when the keys are released', () => {
    const spec: ExerciseSpec = {
      kind: 'interval',
      semitones: 12,
      lowerPitchClass: 0,
      together: { overlap: true },
    };
    expect(
      progress(spec, [
        ['on', C4],
        ['on', C5],
        ['off', C4],
        ['off', C5],
      ]),
    ).toBe('2/2 ok');
  });

  it('reports a fresh state as zero', () => {
    const spec: ExerciseSpec = { kind: 'distinctKeys', count: 3 };
    expect(progressOf(spec, initExercise())).toEqual({ done: 0, total: 3, satisfied: false });
  });
});

import { describe, expect, it } from 'vitest';
import {
  dueNoteId,
  initExercise,
  needsRangeShift,
  progressOf,
  reduceExercise,
  struckNoteIds,
  targetMidisFor,
  type ExerciseState,
} from '@/features/learn/exerciseMatcher';
import { goalTotal, type ExerciseSpec } from '@/features/learn/exerciseSpec';
import type { LearnPhrase } from '@/features/learn/types';
import type { TrackEvent } from '@/features/library/trackBuilder';

/**
 * One scripted event: press or release a midi at an audio-clock millisecond,
 * and optionally at a fractional click beat.
 *
 * `atBeats` defaults to `null` — no click running — which is what every spec
 * but `rhythm` is judged under.
 */
type Beat = ['on' | 'off', number, number?, (number | null)?];

/**
 * Fold a script through the same normalization `useExercise` applies, so the
 * tests exercise the held-set bookkeeping the adapter is responsible for —
 * including the orphan releases `AudioEngine.noteOff` emits unconditionally.
 */
function run(spec: ExerciseSpec, script: readonly Beat[]): ExerciseState {
  const held = new Set<number>();
  let state = initExercise();
  for (const [type, midi, atMs = 0, atBeats = null] of script) {
    if (type === 'on') {
      if (held.has(midi)) continue;
      held.add(midi);
      state = reduceExercise(spec, state, {
        kind: 'press',
        midi,
        atMs,
        atBeats,
        held: new Set(held),
      });
    } else {
      if (!held.delete(midi)) continue;
      state = reduceExercise(spec, state, {
        kind: 'release',
        midi,
        atMs,
        atBeats,
        held: new Set(held),
      });
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

describe('sequence', () => {
  // C D E F G A B C — the first and last note share a pitch class, which is
  // exactly why a run cannot be a set.
  const scaleUp: ExerciseSpec = {
    kind: 'sequence',
    pitchClasses: [0, 2, 4, 5, 7, 9, 11, 0],
    direction: 'up',
  };

  const walk = (from: number, degrees: readonly number[]): Beat[] =>
    degrees.map((semitones) => ['on', from + semitones] as Beat);

  it('accepts the scale walked up in order', () => {
    expect(progress(scaleUp, walk(C4, [0, 2, 4, 5, 7, 9, 11, 12]))).toBe('8/8 ok');
  });

  it('counts a repeated pitch class twice, at its own position', () => {
    expect(progress(scaleUp, walk(C4, [0, 2, 4, 5, 7, 9, 11]))).toBe('7/8');
  });

  it('rejects the closing C played below the B', () => {
    // Same pitch classes, wrong shape: `direction: 'up'` is what forbids it.
    expect(progress(scaleUp, walk(C4, [0, 2, 4, 5, 7, 9, 11, 0]))).toBe('7/8');
  });

  it('clears the run on a wrong note', () => {
    expect(
      progress(scaleUp, [
        ['on', C4],
        ['on', 62],
        ['on', 65], // F, where E was expected
      ]),
    ).toBe('0/8');
  });

  it('restarts at one when the wrong note could begin a fresh run', () => {
    // A slip should cost an attempt, not the whole line.
    expect(
      progress(scaleUp, [
        ['on', C4],
        ['on', 62],
        ['on', C5], // a C: wrong here, but a legal opening
      ]),
    ).toBe('1/8');
  });

  it('ignores releases entirely', () => {
    expect(
      progress(scaleUp, [
        ['on', C4],
        ['off', C4],
        ['on', 62],
        ['off', 62],
      ]),
    ).toBe('2/8');
  });

  it('walks down when the direction says so', () => {
    const scaleDown: ExerciseSpec = {
      kind: 'sequence',
      pitchClasses: [0, 11, 9, 7, 5, 4, 2, 0],
      direction: 'down',
    };
    expect(progress(scaleDown, walk(C4, [12, 11, 9, 7, 5, 4, 2, 0]))).toBe('8/8 ok');
    // A B *above* the opening C is the right letter going the wrong way, and a
    // B cannot open this line either — so the run clears rather than stalling.
    // Ignoring wrong notes instead would let someone mash their way through.
    expect(
      progress(scaleDown, [
        ['on', C4],
        ['on', 71],
      ]),
    ).toBe('0/8');
  });

  it('ignores height when no direction is asked for', () => {
    const anyOrder: ExerciseSpec = { kind: 'sequence', pitchClasses: [2, 5, 9] };
    expect(
      progress(anyOrder, [
        ['on', 62],
        ['on', 53],
        ['on', 81],
      ]),
    ).toBe('3/3 ok');
  });

  it('targets only the next note, and only where it is legal', () => {
    const started = run(scaleUp, [['on', C4]]);
    // D above C4, not the D below it, and not the E after it.
    expect([...targetMidisFor(scaleUp, started, { lowMidi: 48, highMidi: 84 })]).toEqual([62, 74]);
  });

  it('asks for a range shift when the next note is off screen', () => {
    const started = run(scaleUp, [['on', 72]]);
    expect(needsRangeShift(scaleUp, started, { lowMidi: 60, highMidi: 73 })).toBe(true);
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

describe('rhythm', () => {
  const C4 = 60;
  const PULSE: ExerciseSpec = { kind: 'rhythm', beats: [0, 1, 2, 3], barBeats: 4 };
  const ON_C4: ExerciseSpec = { kind: 'rhythm', beats: [0, 1, 2, 3], barBeats: 4, midi: C4 };
  /** The chapter's rest figure: a hole where beat 1 would be. */
  const WITH_REST: ExerciseSpec = { kind: 'rhythm', beats: [0, 2, 3], barBeats: 4, midi: C4 };

  /** Press `midi` at each of these grid beats. Time in ms is irrelevant here. */
  function atBeats(midi: number, beats: readonly number[]): Beat[] {
    return beats.flatMap((beat): Beat[] => [
      ['on', midi, 0, beat],
      ['off', midi, 0, beat],
    ]);
  }

  it('credits a pattern played on the beat', () => {
    expect(progress(PULSE, atBeats(C4, [0, 1, 2, 3]))).toBe('4/4 ok');
  });

  it('accepts the pattern at any bar, so nobody has to catch the first one', () => {
    // The whole reason `beats` are offsets from a bar line: you listen for a
    // bar or two, then come in. That is what counting in means.
    expect(progress(PULSE, atBeats(C4, [8, 9, 10, 11]))).toBe('4/4 ok');
  });

  it('forgives playing consistently a little behind', () => {
    expect(progress(PULSE, atBeats(C4, [0.2, 1.2, 2.2, 3.2]))).toBe('4/4 ok');
  });

  it('drops the attempt on a note that is properly late, and takes the next bar', () => {
    // 2.4 is 0.4 from the beat it was due on and 1.6 from the nearest bar
    // line, so it neither continues the attempt nor begins one: the readout
    // goes to nothing rather than back to one.
    expect(progress(PULSE, atBeats(C4, [0, 1, 2.4]))).toBe('0/4');
    // The point of resetting rather than failing: the next clean bar stands on
    // its own, so a slip costs a bar and not the step.
    expect(progress(PULSE, atBeats(C4, [0, 1, 2.4, 4, 5, 6, 7]))).toBe('4/4 ok');
  });

  it('cannot be passed by mashing', () => {
    // The reason a press that misses is *re-tested as a start* rather than
    // ignored. Ignoring it would let a press land inside every window in order.
    const mash: number[] = [];
    for (let beat = 0; beat < 8; beat += 0.125) mash.push(beat);
    expect(progress(PULSE, atBeats(C4, mash))).toBe('1/4');
  });

  it('counts an extra note between targets as a wrong attempt', () => {
    // Only ordered matching can see this at all: graded independently, every
    // one of these presses is on or near a beat.
    expect(progress(PULSE, atBeats(C4, [0, 0.5, 1, 2, 3]))).toBe('0/4');
    expect(progress(PULSE, atBeats(C4, [0, 0.5, 1, 2, 3, 4, 5, 6, 7]))).toBe('4/4 ok');
  });

  it('does not credit a press in a rest', () => {
    // Ordered matching earning its keep: graded against the nearest target,
    // a press at beat 1 would be credited to beat 2 and the hole would vanish.
    expect(progress(WITH_REST, atBeats(C4, [0, 1, 2, 3]))).toBe('0/3');
    expect(progress(WITH_REST, atBeats(C4, [0, 2, 3]))).toBe('3/3 ok');
  });

  it('takes any key when no pitch is pinned', () => {
    expect(
      progress(PULSE, [
        ['on', 60, 0, 0],
        ['off', 60, 0, 0],
        ['on', 64, 0, 1],
        ['off', 64, 0, 1],
        ['on', 67, 0, 2],
        ['off', 67, 0, 2],
        ['on', 72, 0, 3],
        ['off', 72, 0, 3],
      ]),
    ).toBe('4/4 ok');
  });

  it('treats the wrong key as a wrong attempt when a pitch is pinned', () => {
    // Not merely ignored: otherwise a two-finger user passes a one-pitch
    // rhythm by alternating hands.
    expect(
      progress(ON_C4, [
        ['on', 60, 0, 0],
        ['off', 60, 0, 0],
        ['on', 62, 0, 1],
        ['off', 62, 0, 1],
        ['on', 60, 0, 2],
        ['off', 60, 0, 2],
      ]),
    ).toBe('0/4');
  });

  it('ignores releases', () => {
    expect(
      progress(ON_C4, [
        ['on', C4, 0, 0],
        ['off', C4, 0, 0.5],
        ['on', C4, 0, 1],
        ['off', C4, 0, 1.5],
      ]),
    ).toBe('2/4');
  });

  it('neither credits nor resets while no click is running', () => {
    // `atBeats` defaults to null in the helper: nothing to be in time with, so
    // nothing happens rather than something arbitrary.
    expect(
      progress(ON_C4, [
        ['on', C4],
        ['off', C4],
        ['on', C4],
        ['off', C4],
      ]),
    ).toBe('0/4');
    // And a press before the click cannot poison an attempt made after it.
    expect(progress(ON_C4, [['on', C4], ['off', C4], ...atBeats(C4, [0, 1, 2, 3])])).toBe('4/4 ok');
  });

  it('never starts an attempt against a bar that has not clicked yet', () => {
    expect(progress(ON_C4, atBeats(C4, [-4, -3, -2, -1]))).toBe('0/4');
  });

  it('keeps satisfaction once the pattern lands', () => {
    const state = run(PULSE, atBeats(C4, [0, 1, 2, 3, 4, 5.7, 6.3]));
    expect(state.satisfied).toBe(true);
    expect(progressOf(PULSE, state).done).toBe(4);
  });

  it('offers the pinned note as a hint target, and nothing when any key will do', () => {
    const range = { lowMidi: 60, highMidi: 72 };
    expect([...targetMidisFor(ON_C4, initExercise(), range)]).toEqual([C4]);
    expect([...targetMidisFor(PULSE, initExercise(), range)]).toEqual([]);
  });

  it('asks for a range shift only when the pinned note is off screen', () => {
    const offScreen = { lowMidi: 72, highMidi: 84 };
    expect(needsRangeShift(ON_C4, initExercise(), offScreen)).toBe(true);
    expect(needsRangeShift(ON_C4, initExercise(), { lowMidi: 60, highMidi: 72 })).toBe(false);
    // "Any key" has no targets by design, so an empty set is not a hint.
    expect(needsRangeShift(PULSE, initExercise(), offScreen)).toBe(false);
  });
});

describe('playAlong', () => {
  const D4 = 62;
  const EB4 = 63;
  const E4 = 64;
  const F4 = 65;
  const G4 = 67;

  /** 4/4 at 60bpm, one event per [beat, note or chord, beats]. */
  function line(...events: readonly [number, string | string[], number][]): LearnPhrase {
    return {
      bpm: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      events: events.map(([beat, note, beats]): TrackEvent => [beat, note, beats, 0.7]),
    };
  }

  /** E E F G | G(h) E(h) — two bars, opening on a repeated pitch. */
  const TUNE = line(
    [0, 'E4', 1],
    [1, 'E4', 1],
    [2, 'F4', 1],
    [3, 'G4', 1],
    [4, 'G4', 2],
    [6, 'E4', 2],
  );
  const UNTIMED: ExerciseSpec = { kind: 'playAlong', phrase: TUNE };
  const TIMED: ExerciseSpec = { kind: 'playAlong', phrase: TUNE, timed: {} };

  /** Press and release each midi in turn, with no click running. */
  function taps(...midis: readonly number[]): Beat[] {
    return midis.flatMap((midi, i): Beat[] => [
      ['on', midi, i * 1000],
      ['off', midi, i * 1000 + 50],
    ]);
  }

  /** Press and release each [midi, grid beat]. */
  function timedTaps(...notes: readonly (readonly [number, number])[]): Beat[] {
    return notes.flatMap(([midi, beat]): Beat[] => [
      ['on', midi, beat * 1000, beat],
      ['off', midi, beat * 1000 + 50, beat + 0.05],
    ]);
  }

  describe('untimed', () => {
    it('counts the line in order, one moment at a time', () => {
      expect(goalTotal(UNTIMED)).toBe(6);
      expect(progress(UNTIMED, taps(E4, E4, F4))).toBe('3/6');
      expect(progress(UNTIMED, taps(E4, E4, F4, G4, G4, E4))).toBe('6/6 ok');
    });

    it('drops back to the start on a wrong note, and re-tests it there', () => {
      // D is nowhere in the line: back to nothing, and marked wrong.
      const wrong = run(UNTIMED, taps(E4, E4, D4));
      expect(progressOf(UNTIMED, wrong).done).toBe(0);
      expect(wrong.wrongMidi).toBe(D4);
      // A slip onto E is the line's first note, so the line begins again there.
      expect(progress(UNTIMED, taps(E4, E4, F4, E4))).toBe('1/6');
    });

    it('falls back to the latest checkpoint, not the start', () => {
      const spec: ExerciseSpec = { kind: 'playAlong', phrase: TUNE, checkpoints: [0, 4] };
      expect(progress(spec, taps(E4, E4, F4, G4, G4, D4))).toBe('4/6');
      // A slip before the checkpoint still goes all the way back.
      expect(progress(spec, taps(E4, E4, D4))).toBe('0/6');
    });

    it('clears the wrong mark on the next press', () => {
      expect(run(UNTIMED, taps(D4, E4)).wrongMidi).toBeNull();
    });

    it('cannot be passed by mashing every key in turn', () => {
      const mash = Array.from({ length: 13 }, (_, i) => 60 + i);
      expect(progress(UNTIMED, [...taps(...mash), ...taps(...mash)])).not.toContain('ok');
    });

    it('lights the heads played so far, by position rather than by pitch', () => {
      if (UNTIMED.kind !== 'playAlong') throw new Error('expected playAlong');
      const played = run(UNTIMED, taps(E4, E4));
      // The third E, at beat 6, stays dark: only the two already played light.
      expect([...struckNoteIds(UNTIMED, played)]).toEqual(['learn-n0-0', 'learn-n1-0']);
      expect(dueNoteId(UNTIMED, played)).toBe('learn-n2-0');
    });

    it('accumulates a chord in any order, however far apart', () => {
      // One mouse pointer can finish a moment meant for two hands.
      const spec: ExerciseSpec = {
        kind: 'playAlong',
        phrase: line([0, ['C3', 'E3', 'G3', 'E4'], 4], [4, 'D4', 4]),
      };
      expect(progress(spec, taps(55, 64, 48))).toBe('0/2');
      expect(progress(spec, taps(55, 64, 48, 52))).toBe('1/2');
      // Striking one of the chord's notes twice costs nothing.
      expect(progress(spec, taps(55, 55, 64, 48, 52, D4))).toBe('2/2 ok');
    });

    it('points at what is left of the due moment, and asks for a shift if any of it is off screen', () => {
      const spec: ExerciseSpec = { kind: 'playAlong', phrase: line([0, ['C3', 'E4'], 4]) };
      const range = { lowMidi: 60, highMidi: 72 };
      const state = run(spec, taps(E4));
      expect([...targetMidisFor(spec, state, range)]).toEqual([]);
      expect(needsRangeShift(spec, state, range)).toBe(true);
      expect(needsRangeShift(spec, initExercise(), { lowMidi: 48, highMidi: 72 })).toBe(false);
    });
  });

  describe('together', () => {
    const TOGETHER = { overlap: true, onsetWindowMs: 400 };
    /** C major, then C minor: one note moves. */
    const TO_MINOR: ExerciseSpec = {
      kind: 'playAlong',
      phrase: line([0, ['C4', 'E4', 'G4'], 4], [4, ['C4', 'Eb4', 'G4'], 4]),
      together: TOGETHER,
    };

    it('takes a block chord, then the chord with one note moved', () => {
      expect(
        progress(TO_MINOR, [
          ['on', C4, 0],
          ['on', E4, 10],
          ['on', G4, 20],
          ['off', E4, 1000],
          ['on', EB4, 1500],
        ]),
      ).toBe('2/2 ok');
    });

    it('refuses the second chord while the old third is still held', () => {
      const script: Beat[] = [
        ['on', C4, 0],
        ['on', E4, 10],
        ['on', G4, 20],
        ['on', EB4, 1500],
      ];
      expect(progress(TO_MINOR, script)).toBe('1/2');
      // Letting the E go is what moves it — and it finishes the chord.
      expect(progress(TO_MINOR, [...script, ['off', E4, 1600]])).toBe('2/2 ok');
    });

    it('lets a mouse roll a chord inside the onset window', () => {
      const roll: Beat[] = [C4, E4, G4].flatMap((midi, i): Beat[] => [
        ['on', midi, i * 100],
        ['off', midi, i * 100 + 50],
      ]);
      expect(progress(TO_MINOR, roll)).toBe('1/2');
    });
  });

  describe('timed', () => {
    const TUNE_BEATS: readonly (readonly [number, number])[] = [
      [E4, 0],
      [E4, 1],
      [F4, 2],
      [G4, 3],
      [G4, 4],
      [E4, 6],
    ];
    const shifted = (by: number) => TUNE_BEATS.map(([midi, beat]) => [midi, beat + by] as const);

    it('credits the line played in time, from any bar line', () => {
      expect(progress(TIMED, timedTaps(...TUNE_BEATS))).toBe('6/6 ok');
      expect(progress(TIMED, timedTaps(...shifted(8)))).toBe('6/6 ok');
    });

    it('drops the attempt on the right note at the wrong time', () => {
      // The F comes half a beat late: twice the tolerance.
      const late = timedTaps([E4, 0], [E4, 1], [F4, 2.5]);
      expect(progress(TIMED, late)).toBe('0/6');
      expect(run(TIMED, late).wrongMidi).toBe(F4);
    });

    it('drops the attempt on a wrong note on the beat', () => {
      expect(progress(TIMED, timedTaps([E4, 0], [E4, 1], [D4, 2]))).toBe('0/6');
    });

    it('does not begin between bar lines', () => {
      expect(progress(TIMED, timedTaps(...shifted(1)))).not.toContain('ok');
    });

    it('cannot be passed by mashing on the beats', () => {
      const mash: [number, number][] = [];
      for (let beat = 0; beat < 16; beat += 1) {
        for (const midi of [E4, F4, G4]) mash.push([midi, beat]);
      }
      expect(progress(TIMED, timedTaps(...mash))).not.toContain('ok');
    });

    it('comes back in at a later checkpoint on a downbeat', () => {
      // Checkpoint at moment 4, which is beat 4 of the line. After the slip in
      // bar 2, coming back in on grid beat 8 measures from bar line 4.
      const spec: ExerciseSpec = {
        kind: 'playAlong',
        phrase: TUNE,
        timed: {},
        checkpoints: [0, 4],
      };
      const slip = timedTaps(...TUNE_BEATS.slice(0, 5), [D4, 5]);
      expect(progress(spec, slip)).toBe('4/6');
      expect(progress(spec, [...slip, ...timedTaps([G4, 8], [E4, 10])])).toBe('6/6 ok');
    });

    it('re-enters at a checkpoint whose bar line comes before the click began', () => {
      // Entering moment 4 (beat 4 of the line) on grid beat 0 measures from
      // bar line -4. The note itself is on a beat that sounded, so it counts.
      const spec: ExerciseSpec = {
        kind: 'playAlong',
        phrase: TUNE,
        timed: {},
        checkpoints: [0, 4],
      };
      const reentry: ExerciseState = {
        ...initExercise(),
        along: { index: 4, struck: new Set(), origin: null },
      };
      const state = reduceExercise(spec, reentry, {
        kind: 'press',
        midi: G4,
        atMs: 0,
        atBeats: 0,
        held: new Set([G4]),
      });
      expect(state.along?.index).toBe(5);
      expect(state.along?.origin).toBe(-4);
    });

    it('takes a chord whose notes each land in the window, in any order', () => {
      const spec: ExerciseSpec = {
        kind: 'playAlong',
        phrase: line([0, ['C4', 'E4'], 2], [2, 'G4', 2]),
        timed: {},
      };
      expect(progress(spec, timedTaps([E4, 0.1], [C4, 0.05], [G4, 2]))).toBe('2/2 ok');
      // The next moment's note before the chord is complete is a break.
      expect(progress(spec, timedTaps([E4, 0], [G4, 2]))).toBe('0/2');
    });
  });
});

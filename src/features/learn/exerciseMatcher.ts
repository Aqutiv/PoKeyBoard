import {
  blackGroupRootPitchClass,
  goalTotal,
  pitchClassOf,
  type ExerciseSpec,
  type Togetherness,
  type UnorderedSpec,
} from './exerciseSpec';

/**
 * Exercise matching, as a pure reducer.
 *
 * Nothing here touches the audio engine or React, so the whole matcher suite
 * runs in jsdom against a synthetic event log. The React adapter
 * (`useExercise`) owns the subscription and the held-set bookkeeping and hands
 * both to `reduceExercise` — which is what keeps this a pure function of its
 * input log rather than of engine state.
 */

/** Normalized user input. `held` is the adapter's own bookkeeping. */
export type ExerciseInput =
  | { kind: 'press'; midi: number; atMs: number; held: ReadonlySet<number> }
  | { kind: 'release'; midi: number; atMs: number; held: ReadonlySet<number> };

export interface ExerciseState {
  /** Midis counted toward the goal. Grows monotonically for cumulative specs;
   *  reflects the current gesture for specs that require simultaneity. */
  credited: ReadonlySet<number>;
  /** `sequence` only: the midis matched so far, in the order they were played.
   *  A set cannot carry order, nor a scale whose first and last note are both C. */
  run: readonly number[];
  /** Last press time per midi, audio-clock ms — backs `onsetWindowMs`. */
  onsets: ReadonlyMap<number, number>;
  satisfied: boolean;
}

export interface ExerciseProgress {
  done: number;
  total: number;
  satisfied: boolean;
}

export interface MidiRange {
  lowMidi: number;
  highMidi: number;
}

export function initExercise(): ExerciseState {
  return { credited: new Set(), run: [], onsets: new Map(), satisfied: false };
}

/**
 * Fold one input into the state.
 *
 * Satisfaction is sticky: once the step is met, later input is ignored
 * entirely, so releasing the keys cannot walk the readout backwards or flicker
 * the Next button off under the user's finger.
 */
export function reduceExercise(
  spec: ExerciseSpec,
  state: ExerciseState,
  input: ExerciseInput,
): ExerciseState {
  if (state.satisfied) return state;

  const onsets = new Map(state.onsets);
  if (input.kind === 'press') onsets.set(input.midi, input.atMs);

  if (spec.kind === 'sequence') {
    // Order is a story about onsets; releasing a key says nothing about where
    // in the line you are.
    const run = input.kind === 'press' ? advanceRun(spec, state.run, input.midi) : state.run;
    return { ...state, run, onsets, satisfied: run.length >= goalTotal(spec) };
  }

  const candidate = candidateSet(input, onsets, togethernessOf(spec));
  const credited = creditFrom(spec, candidate);
  return { ...state, credited, onsets, satisfied: credited.size >= goalTotal(spec) };
}

export function progressOf(spec: ExerciseSpec, state: ExerciseState): ExerciseProgress {
  const total = goalTotal(spec);
  const done = spec.kind === 'sequence' ? state.run.length : state.credited.size;
  return {
    done: state.satisfied ? total : Math.min(done, total),
    total,
    satisfied: state.satisfied,
  };
}

/**
 * Which keys to mark as targets, given the window currently on screen.
 *
 * Open-ended specs return nothing on purpose — lighting up every key says no
 * more than lighting up none, and group specs return exactly one concrete
 * group because a hint should point somewhere, not paper the keyboard.
 */
export function targetMidisFor(
  spec: ExerciseSpec,
  state: ExerciseState,
  range: MidiRange,
): ReadonlySet<number> {
  const out = new Set<number>();
  const inRange = (midi: number): boolean => midi >= range.lowMidi && midi <= range.highMidi;

  switch (spec.kind) {
    case 'distinctKeys':
    case 'risingLeap':
      return out;

    case 'pitchClass':
      for (let midi = range.lowMidi; midi <= range.highMidi; midi += 1) {
        if (pitchClassOf(midi) === spec.pitchClass && !state.credited.has(midi)) out.add(midi);
      }
      return out;

    case 'exactKeys':
      for (const midi of spec.midis) {
        if (inRange(midi) && !state.credited.has(midi)) out.add(midi);
      }
      return out;

    case 'blackKeyGroup': {
      const rootPitchClass = blackGroupRootPitchClass(spec.size);
      for (let root = range.lowMidi; root <= range.highMidi; root += 1) {
        if (pitchClassOf(root) !== rootPitchClass) continue;
        const members = groupMembers(root, spec.size);
        if (!members.every(inRange)) continue;
        for (const midi of members) out.add(midi);
        return out;
      }
      return out;
    }

    case 'interval': {
      for (let lower = range.lowMidi; lower <= range.highMidi; lower += 1) {
        if (spec.lowerPitchClass !== undefined && pitchClassOf(lower) !== spec.lowerPitchClass) {
          continue;
        }
        if (!inRange(lower + spec.semitones)) continue;
        out.add(lower);
        out.add(lower + spec.semitones);
        return out;
      }
      return out;
    }

    case 'sequence': {
      // Only the next note is a target: showing the whole line at once would
      // tell the user the answer instead of where they are in it.
      const expected = spec.pitchClasses[state.run.length];
      if (expected === undefined) return out;
      const previous = state.run[state.run.length - 1];
      for (let midi = range.lowMidi; midi <= range.highMidi; midi += 1) {
        if (pitchClassOf(midi) !== expected) continue;
        if (previous !== undefined && !directionHolds(spec.direction, previous, midi)) continue;
        out.add(midi);
      }
      return out;
    }
  }
}

/**
 * The step still needs notes, but none of them are on screen — the cue to point
 * a phone user at the range shifter rather than let them hunt.
 */
export function needsRangeShift(
  spec: ExerciseSpec,
  state: ExerciseState,
  range: MidiRange,
): boolean {
  if (state.satisfied) return false;
  // Open-ended specs have no targets by design; absence is not a hint here.
  if (spec.kind === 'distinctKeys' || spec.kind === 'risingLeap') return false;
  return targetMidisFor(spec, state, range).size === 0;
}

// ---- internals ----------------------------------------------------------

/**
 * Walk the run on by one note.
 *
 * A wrong note breaks the run — but if it could begin a fresh one, it starts
 * there rather than making the user lift their hands and re-begin. A slip then
 * costs one attempt instead of the whole line.
 */
function advanceRun(
  spec: Extract<ExerciseSpec, { kind: 'sequence' }>,
  run: readonly number[],
  midi: number,
): readonly number[] {
  if (fitsNext(spec, run, midi)) return [...run, midi];
  return fitsNext(spec, [], midi) ? [midi] : [];
}

function fitsNext(
  spec: Extract<ExerciseSpec, { kind: 'sequence' }>,
  run: readonly number[],
  midi: number,
): boolean {
  const expected = spec.pitchClasses[run.length];
  if (expected === undefined || pitchClassOf(midi) !== expected) return false;
  const previous = run[run.length - 1];
  return previous === undefined || directionHolds(spec.direction, previous, midi);
}

function directionHolds(
  direction: 'up' | 'down' | 'any' | undefined,
  previous: number,
  midi: number,
): boolean {
  if (direction === 'up') return midi > previous;
  if (direction === 'down') return midi < previous;
  return true;
}

function togethernessOf(spec: UnorderedSpec): Togetherness | undefined {
  switch (spec.kind) {
    case 'distinctKeys':
    case 'risingLeap':
    case 'pitchClass':
      return undefined;
    case 'exactKeys':
    case 'interval':
    case 'blackKeyGroup':
      return spec.together;
  }
}

/**
 * The notes currently eligible to be counted.
 *
 * Without a `together` rule that is everything pressed since the step opened,
 * so progress survives a keyboard range shift — which chapter 1 depends on,
 * since a phone cannot show three Cs at once.
 */
function candidateSet(
  input: ExerciseInput,
  onsets: ReadonlyMap<number, number>,
  together: Togetherness | undefined,
): ReadonlySet<number> {
  if (!together) return new Set(onsets.keys());

  const out = new Set<number>(together.overlap ? input.held : []);
  const windowMs = together.onsetWindowMs;
  if (windowMs !== undefined) {
    let newest = Number.NEGATIVE_INFINITY;
    for (const at of onsets.values()) if (at > newest) newest = at;
    for (const [midi, at] of onsets) if (newest - at <= windowMs) out.add(midi);
  }
  return out;
}

function creditFrom(spec: UnorderedSpec, candidate: ReadonlySet<number>): ReadonlySet<number> {
  switch (spec.kind) {
    case 'distinctKeys':
      return candidate;

    case 'risingLeap': {
      if (candidate.size === 0) return new Set();
      const lowest = Math.min(...candidate);
      const highest = Math.max(...candidate);
      // One key played is half the gesture; the leap itself is the other half.
      return highest - lowest >= spec.minSemitoneGap
        ? new Set([lowest, highest])
        : new Set([lowest]);
    }

    case 'pitchClass': {
      const out = new Set<number>();
      for (const midi of candidate) if (pitchClassOf(midi) === spec.pitchClass) out.add(midi);
      return out;
    }

    case 'exactKeys': {
      const out = new Set<number>();
      for (const midi of spec.midis) if (candidate.has(midi)) out.add(midi);
      return out;
    }

    case 'blackKeyGroup':
      return bestBlackGroup(candidate, spec.size);

    case 'interval':
      return bestInterval(candidate, spec.semitones, spec.lowerPitchClass);
  }
}

/** Black-key groups step in whole tones: C♯ D♯, and F♯ G♯ A♯. */
function groupMembers(root: number, size: 2 | 3): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i += 1) out.push(root + i * 2);
  return out;
}

/** The most complete group present, so partial progress reads "1 of 2". */
function bestBlackGroup(candidate: ReadonlySet<number>, size: 2 | 3): ReadonlySet<number> {
  const rootPitchClass = blackGroupRootPitchClass(size);
  let best = new Set<number>();
  for (const midi of candidate) {
    // Any member could be the one that was pressed, so walk back to each root.
    for (let step = 0; step < size; step += 1) {
      const root = midi - step * 2;
      // `%` keeps the sign in JS, so a root below 0 would compare wrongly.
      if (root < 0 || pitchClassOf(root) !== rootPitchClass) continue;
      const present = new Set(groupMembers(root, size).filter((m) => candidate.has(m)));
      if (present.size > best.size) best = present;
    }
  }
  return best;
}

/** The most complete matching pair present. */
function bestInterval(
  candidate: ReadonlySet<number>,
  semitones: number,
  lowerPitchClass: number | undefined,
): ReadonlySet<number> {
  let best = new Set<number>();
  for (const midi of candidate) {
    // The pressed note could be either end of the pair.
    for (const lower of [midi, midi - semitones]) {
      if (lower < 0) continue;
      if (lowerPitchClass !== undefined && pitchClassOf(lower) !== lowerPitchClass) continue;
      const present = new Set([lower, lower + semitones].filter((m) => candidate.has(m)));
      if (present.size > best.size) best = present;
    }
  }
  return best;
}

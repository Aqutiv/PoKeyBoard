import {
  blackGroupRootPitchClass,
  DEFAULT_RHYTHM_TOLERANCE_BEATS,
  goalTotal,
  pitchClassOf,
  type ExerciseSpec,
  type Togetherness,
  type UnorderedSpec,
} from './exerciseSpec';
import { momentsOf, type PhraseMoment } from './phrase';

/**
 * Exercise matching, as a pure reducer.
 *
 * Nothing here touches the audio engine or React, so the whole matcher suite
 * runs in jsdom against a synthetic event log. The React adapter
 * (`useExercise`) owns the subscription and the held-set bookkeeping and hands
 * both to `reduceExercise` — which is what keeps this a pure function of its
 * input log rather than of engine state.
 */

/**
 * Normalized user input. `held` is the adapter's own bookkeeping.
 *
 * `atBeats` is the moment in fractional click-grid beats, or `null` when no
 * click is running. Nullable rather than optional on purpose: the "nothing to
 * judge against" branch then has to be written once, visibly, instead of
 * arriving as an `undefined` nobody handled.
 */
export type ExerciseInput =
  | {
      kind: 'press';
      midi: number;
      atMs: number;
      atBeats: number | null;
      held: ReadonlySet<number>;
    }
  | {
      kind: 'release';
      midi: number;
      atMs: number;
      atBeats: number | null;
      held: ReadonlySet<number>;
    };

/** `rhythm` only: the attempt in progress. */
export interface RhythmRun {
  /** Grid beat of the bar line this attempt started from. */
  origin: number;
  /** Targets landed so far, which is also the index of the next one due. */
  hits: number;
}

/** `playAlong` only: how far along the written line the attempt has got. */
export interface AlongRun {
  /** The moment due next — which is also how many are done. */
  index: number;
  /** Notes of the due moment already down: half a chord, so far. */
  struck: ReadonlySet<number>;
  /**
   * `together` only: the keys struck since this moment became due — the only
   * presses its onset window may count. The exercise-wide onset history would
   * otherwise carry a finished chord into the next moment: two identical
   * chords in a row, and letting go of one key would credit the second.
   */
  fresh: ReadonlySet<number>;
  /**
   * Timed only: grid beat of the bar line the attempt is measured from, or
   * `null` while waiting to come in at `index`. Always `null` untimed.
   */
  origin: number | null;
}

export interface ExerciseState {
  /** Midis counted toward the goal. Grows monotonically for cumulative specs;
   *  reflects the current gesture for specs that require simultaneity. */
  credited: ReadonlySet<number>;
  /** `sequence` only: the midis matched so far, in the order they were played.
   *  A set cannot carry order, nor a scale whose first and last note are both C. */
  run: readonly number[];
  /** Last press time per midi, audio-clock ms — backs `onsetWindowMs`. */
  onsets: ReadonlyMap<number, number>;
  /** `rhythm` only. Cannot live in `onsets`, which is keyed by midi and so
   *  holds only the last press of a pitch — a rhythm on one note would
   *  overwrite itself every time. */
  rhythm: RhythmRun | null;
  /** `playAlong` only. */
  along: AlongRun | null;
  /**
   * `playAlong` only: the last press that counted for nothing, kept until the
   * next press. The keyboard marks it, so a wrong note reads as wrong rather
   * than as silence — held in state rather than on a timer, which keeps the
   * reducer pure and still leaves a mouse click's mark on screen.
   */
  wrongMidi: number | null;
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
  return {
    credited: new Set(),
    run: [],
    onsets: new Map(),
    rhythm: null,
    along: null,
    wrongMidi: null,
    satisfied: false,
  };
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

  if (spec.kind === 'rhythm') {
    // Order is a story about onsets; a release says nothing about where in the
    // bar you are — the same reason `sequence` ignores them. `onsets` is left
    // untouched rather than cloned, since nothing here reads it.
    const rhythm = input.kind === 'press' ? advanceRhythm(spec, state.rhythm, input) : state.rhythm;
    return { ...state, rhythm, satisfied: (rhythm?.hits ?? 0) >= goalTotal(spec) };
  }

  const onsets = new Map(state.onsets);
  if (input.kind === 'press') onsets.set(input.midi, input.atMs);

  if (spec.kind === 'playAlong') {
    const { run, wrong } = advanceAlong(spec, state.along ?? AT_START, input, onsets);
    return {
      ...state,
      along: run,
      onsets,
      // A release leaves the mark alone; only the next press replaces it.
      wrongMidi: input.kind === 'press' ? (wrong ? input.midi : null) : state.wrongMidi,
      satisfied: run.index >= goalTotal(spec),
    };
  }

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
  const done = doneFor(spec, state);
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

    case 'rhythm':
      // Nothing to point at when any key will do. A pinned pitch is the same
      // key every time, so it simply stays lit for the whole attempt.
      if (spec.midi !== undefined && inRange(spec.midi)) out.add(spec.midi);
      return out;

    case 'playAlong':
      // The moment due, and only what is left of it — `sequence`'s reasoning:
      // lighting the whole line would read the page for the user.
      for (const midi of remainingAlong(spec, state)) if (inRange(midi)) out.add(midi);
      return out;

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
  if (spec.kind === 'rhythm' && spec.midi === undefined) return false;
  if (spec.kind === 'playAlong') {
    // Any note of the moment off screen, not only all of them: a chord that is
    // half visible cannot be played, and the visible half would otherwise
    // silence the hint for the rest.
    return remainingAlong(spec, state).some(
      (midi) => midi < range.lowMidi || midi > range.highMidi,
    );
  }
  return targetMidisFor(spec, state, range).size === 0;
}

/**
 * The written heads an attempt at a `playAlong` line has played so far — what
 * the stave lights. By position, not by pitch: a tune with six Es would
 * otherwise light all six at once and say nothing about where the player is.
 */
export function struckNoteIds(
  spec: Extract<ExerciseSpec, { kind: 'playAlong' }>,
  state: ExerciseState,
): ReadonlySet<string> {
  const moments = momentsOf(spec.phrase);
  const run = state.along ?? AT_START;
  const out = new Set<string>();
  moments.forEach((moment, index) => {
    for (const note of moment.notes) {
      if (index < run.index || (index === run.index && run.struck.has(note.midi))) {
        out.add(note.id);
      }
    }
  });
  return out;
}

/** The first written head of the moment due next, or `null` once the line is played. */
export function dueNoteId(
  spec: Extract<ExerciseSpec, { kind: 'playAlong' }>,
  state: ExerciseState,
): string | null {
  const moment = momentsOf(spec.phrase)[(state.along ?? AT_START).index];
  return moment?.notes[0]?.id ?? null;
}

// ---- internals ----------------------------------------------------------

/**
 * How much of the goal is done, per kind.
 *
 * A switch rather than a ternary: the expression this replaced read
 * `sequence ? run.length : credited.size`, which failed open — a kind nobody
 * remembered to add here would have reported 0 forever, with nothing to say so.
 */
function doneFor(spec: ExerciseSpec, state: ExerciseState): number {
  switch (spec.kind) {
    case 'sequence':
      return state.run.length;
    case 'rhythm':
      return state.rhythm?.hits ?? 0;
    case 'playAlong':
      return state.along?.index ?? 0;
    default:
      return state.credited.size;
  }
}

// ---- playAlong ----------------------------------------------------------

type PlayAlongSpec = Extract<ExerciseSpec, { kind: 'playAlong' }>;

const NOTHING_STRUCK: ReadonlySet<number> = new Set();
const AT_START: AlongRun = {
  index: 0,
  struck: NOTHING_STRUCK,
  fresh: NOTHING_STRUCK,
  origin: null,
};

interface AlongStep {
  run: AlongRun;
  /** The press counted for nothing, anywhere. */
  wrong: boolean;
}

function remainingAlong(spec: PlayAlongSpec, state: ExerciseState): readonly number[] {
  const run = state.along ?? AT_START;
  const moment = momentsOf(spec.phrase)[run.index];
  return moment ? moment.midis.filter((midi) => !run.struck.has(midi)) : [];
}

/**
 * Walk the line on by one input.
 *
 * Three ways to play a line, one rule for getting it wrong: a press that is
 * not one of the due moment's remaining notes — or, timed, not where it was
 * due — breaks the attempt back to its checkpoint, and is then re-tested
 * there. That is `sequence`'s restart and `rhythm`'s re-test as a start, and it
 * is what stops a line being passed by mashing.
 */
function advanceAlong(
  spec: PlayAlongSpec,
  run: AlongRun,
  input: ExerciseInput,
  onsets: ReadonlyMap<number, number>,
): AlongStep {
  const moments = momentsOf(spec.phrase);
  if (spec.timed) {
    // A release says nothing about where in the bar you are.
    return input.kind === 'press' ? advanceTimed(spec, moments, run, input) : { run, wrong: false };
  }
  if (spec.together) return advanceTogether(spec, moments, run, input, onsets, spec.together);
  return input.kind === 'press'
    ? advanceAccumulating(spec, moments, run, input.midi)
    : { run, wrong: false };
}

/**
 * Untimed, notes in any order: the "wait for you" of Play's Training. A moment
 * is done once every one of its notes has been struck, however far apart —
 * which is what lets one mouse pointer play a moment meant for two hands.
 */
function advanceAccumulating(
  spec: PlayAlongSpec,
  moments: readonly PhraseMoment[],
  run: AlongRun,
  midi: number,
): AlongStep {
  const struck = strike(moments, run, midi);
  if (struck) return { run: struck, wrong: false };
  // Striking again a note this moment already has is not a mistake.
  if (run.struck.has(midi)) return { run, wrong: false };
  const fallback = fallbackFrom(spec, run.index);
  const retried = strike(moments, fallback, midi);
  return retried ? { run: retried, wrong: false } : { run: fallback, wrong: true };
}

/**
 * Untimed, a chord at a time: the moment is done when the keys down together
 * are exactly its notes. Exactly, because "turn a major chord minor by moving
 * one note" is only moving one if the old note has to come up — and a release
 * can finish a moment for the same reason.
 */
function advanceTogether(
  spec: PlayAlongSpec,
  moments: readonly PhraseMoment[],
  run: AlongRun,
  input: ExerciseInput,
  onsets: ReadonlyMap<number, number>,
  together: Togetherness,
): AlongStep {
  const moment = moments[run.index];
  if (!moment) return { run, wrong: false };
  if (input.kind === 'press' && !moment.midis.includes(input.midi)) {
    const fallback = fallbackFrom(spec, run.index);
    const target = moments[fallback.index];
    if (!target?.midis.includes(input.midi)) return { run: fallback, wrong: true };
    const retry = { ...fallback, fresh: new Set([input.midi]) };
    return { run: gesture(target, retry, input, onsets, together), wrong: false };
  }
  const fresh = input.kind === 'press' ? new Set(run.fresh).add(input.midi) : run.fresh;
  return { run: gesture(moment, { ...run, fresh }, input, onsets, together), wrong: false };
}

function gesture(
  moment: PhraseMoment,
  run: AlongRun,
  input: ExerciseInput,
  onsets: ReadonlyMap<number, number>,
  together: Togetherness,
): AlongRun {
  // Keys held down still count, however long ago they were struck — that is
  // how "move one note" keeps the other two. Only the onset window is scoped.
  const recent = new Map([...onsets].filter(([midi]) => run.fresh.has(midi)));
  const candidate = candidateSet(input, recent, together);
  const exact =
    candidate.size === moment.midis.length && moment.midis.every((midi) => candidate.has(midi));
  if (exact) return { ...AT_START, index: run.index + 1 };
  return { ...run, struck: new Set(moment.midis.filter((midi) => candidate.has(midi))) };
}

/**
 * Timed: each note of the due moment within tolerance of its beat, measured
 * from the bar line the attempt came in on. A chord's notes each land in the
 * window, in any order; the next moment's note before the chord is complete is
 * a break, since it is then neither in time nor part of what was due.
 */
function advanceTimed(
  spec: PlayAlongSpec,
  moments: readonly PhraseMoment[],
  run: AlongRun,
  input: Extract<ExerciseInput, { kind: 'press' }>,
): AlongStep {
  const at = input.atBeats;
  // No click, nothing to be in time with — the runner never offers a timed
  // line without one, so this is a guard rather than a state anyone meets.
  if (at === null) return { run, wrong: false };
  const tolerance = spec.timed?.toleranceBeats ?? DEFAULT_RHYTHM_TOLERANCE_BEATS;

  if (run.origin !== null) {
    const moment = moments[run.index];
    if (moment && Math.abs(at - (run.origin + moment.beat)) <= tolerance) {
      const struck = strike(moments, run, input.midi);
      if (struck) return { run: struck, wrong: false };
    }
  }

  // Broken, or not yet begun: come in at the moment this attempt falls back to.
  const waiting = run.origin === null ? run : fallbackFrom(spec, run.index);
  const entry = moments[waiting.index];
  const barBeats = spec.phrase.timeSignature.numerator;
  const origin = entry ? barOriginFor(at, entry.beat, barBeats, tolerance) : null;
  const entered = origin === null ? null : strike(moments, { ...waiting, origin }, input.midi);
  return entered ? { run: entered, wrong: false } : { run: waiting, wrong: true };
}

/** Credit `midi` to the due moment, if it is one of the notes still owed. */
function strike(moments: readonly PhraseMoment[], run: AlongRun, midi: number): AlongRun | null {
  const moment = moments[run.index];
  if (!moment || !moment.midis.includes(midi) || run.struck.has(midi)) return null;
  const struck = new Set(run.struck).add(midi);
  return struck.size >= moment.midis.length
    ? { ...AT_START, index: run.index + 1, origin: run.origin }
    : { ...run, struck };
}

/** Back to the latest checkpoint at or before `index`, waiting to come in. */
function fallbackFrom(spec: PlayAlongSpec, index: number): AlongRun {
  let checkpoint = 0;
  for (const candidate of spec.checkpoints ?? [0]) {
    if (candidate <= index && candidate > checkpoint) checkpoint = candidate;
  }
  return { ...AT_START, index: checkpoint };
}

/**
 * The bar line a press at `at` would come in from, if it lands on
 * `entryBeat` of that bar within tolerance — or `null`.
 *
 * The grid's beat 0 is a downbeat by construction (`constantClickGrid` accents
 * `index % numerator === 0`), so bar lines are whole multiples of `barBeats`
 * and this is arithmetic rather than a search. Shared by `rhythm` and a timed
 * `playAlong`, whose restart rules are the same rule.
 */
function barOriginFor(
  at: number,
  entryBeat: number,
  barBeats: number,
  tolerance: number,
): number | null {
  // Subtract the entry offset *before* snapping. Snapping first would pick the
  // wrong bar for any press in the first half of one whenever the entry beat
  // is not itself 0.
  const origin = Math.round((at - entryBeat) / barBeats) * barBeats;
  // Guarded on where the note falls, not on the bar line: a checkpoint in bar 5
  // legitimately measures from a bar line four bars before the click began. A
  // note before the click's own first beat would be timed against nothing.
  if (origin + entryBeat < 0) return null;
  return Math.abs(at - (origin + entryBeat)) <= tolerance ? origin : null;
}

/**
 * Walk the attempt on by one note.
 *
 * A press that is not where the next note was due breaks the attempt — but if
 * it could *begin* one, it begins there, exactly as `advanceRun` restarts a
 * broken sequence. That one rule does all the work: it forgives a single late
 * note, it forgives a whole bad bar, and it is what stops the step being
 * passed by mashing, since an extra press between targets is neither on the
 * next beat nor on a bar line and so resets to nothing.
 */
function advanceRhythm(
  spec: Extract<ExerciseSpec, { kind: 'rhythm' }>,
  run: RhythmRun | null,
  input: Extract<ExerciseInput, { kind: 'press' }>,
): RhythmRun | null {
  const at = input.atBeats;
  // No click running: there is nothing to be in time with, so nothing happens
  // rather than something arbitrary. The runner never offers a rhythm step
  // without its click, so this is a guard rather than a state anyone meets.
  if (at === null) return run;
  // A pinned pitch is part of the answer, not a filter on the input: playing
  // the rhythm on the wrong key is a wrong attempt, not an absent one.
  if (spec.midi !== undefined && input.midi !== spec.midi) return null;

  const tolerance = spec.toleranceBeats ?? DEFAULT_RHYTHM_TOLERANCE_BEATS;
  if (run !== null) {
    const expected = run.origin + (spec.beats[run.hits] as number);
    if (Math.abs(at - expected) <= tolerance) return { origin: run.origin, hits: run.hits + 1 };
  }
  return startRhythm(spec, at, tolerance);
}

/** Begin an attempt, if this press lands where the pattern's first note falls in a bar. */
function startRhythm(
  spec: Extract<ExerciseSpec, { kind: 'rhythm' }>,
  at: number,
  tolerance: number,
): RhythmRun | null {
  const origin = barOriginFor(at, spec.beats[0] as number, spec.barBeats, tolerance);
  return origin === null ? null : { origin, hits: 1 };
}

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

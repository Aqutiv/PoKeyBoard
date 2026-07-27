/**
 * Reading dynamics out of how hard the keys were struck.
 *
 * Velocity has been recorded and imported since the beginning and has never
 * been drawn, so the expressive layer of every take is sitting in the data
 * unseen. The whole difficulty is restraint: a performance is noisy, and a mark
 * on every change of touch would be unreadable and would say nothing. What is
 * wanted is the handful of marks an editor would write.
 *
 * So the reading is deliberately deaf to detail — it smooths across
 * neighbouring notes, holds its band until the level clearly leaves it, and
 * refuses to speak twice inside a bar. Where the level climbs or falls steadily
 * across bars it writes a hairpin instead of a row of marks, because that is
 * what the music is doing.
 */

/** Forte, as the MusicXML importer measures it: MIDI velocity 90 of 127. */
export const FORTE_VELOCITY = 90 / 127;

export type DynamicMark = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';

export interface DynamicEvent {
  atMs: number;
  mark: DynamicMark;
}

export interface HairpinEvent {
  fromMs: number;
  toMs: number;
  /** True for a crescendo, false for a diminuendo. */
  grow: boolean;
}

export interface DynamicsReading {
  marks: DynamicEvent[];
  hairpins: HairpinEvent[];
}

/**
 * Band ceilings as fractions of forte, quietest first. Forte itself is the
 * anchor because that is what the importer calls 100%, so a score that arrived
 * with dynamics reads back out roughly as it came in.
 */
const BANDS: readonly { mark: DynamicMark; ceiling: number }[] = [
  { mark: 'ppp', ceiling: 0.26 },
  { mark: 'pp', ceiling: 0.4 },
  { mark: 'p', ceiling: 0.56 },
  { mark: 'mp', ceiling: 0.71 },
  { mark: 'mf', ceiling: 0.88 },
  { mark: 'f', ceiling: 1.1 },
  { mark: 'ff', ceiling: 1.32 },
  { mark: 'fff', ceiling: Number.POSITIVE_INFINITY },
];

/** How far past a boundary the level must go before the band gives way. */
const HYSTERESIS = 0.07;
/**
 * Onsets either side of a note that colour its level.
 *
 * Wide on purpose. A dynamic describes a passage, not a note, and the window
 * has to be long enough to ride over the moments a melody rests and only the
 * accompaniment sounds — otherwise every gap in the tune reads as a drop.
 */
const SMOOTHING_RADIUS = 8;
/**
 * Which of the window to read as its level. Above the middle, because a
 * passage is as loud as the line carrying it rather than as loud as its
 * quietest inner voice — but short of the top, so one accent is still ignored.
 */
const LEVEL_PERCENTILE = 0.7;
/** A monotonic climb or fall of at least this many bands is a hairpin. */
const HAIRPIN_MIN_STEPS = 2;
/**
 * Bars a hairpin may span before it stops being one.
 *
 * A wedge works over a phrase. Stretched across twenty bars it is a pair of
 * ruled lines that say nothing a reader can see tapering, and editions write
 * that swell as dynamics at each end instead. So beyond this the marks stay
 * and the wedge is dropped.
 */
const HAIRPIN_MAX_BARS = 6;
/** Bars a mark holds the floor for; an editor writes one a phrase, not one a bar. */
const MIN_MARK_BARS = 2;

export interface DynamicsOptions {
  /** One bar in milliseconds — marks are kept at least this far apart. */
  barMs: number;
  /** A hairpin has to span at least this long to be worth drawing. */
  minHairpinMs?: number;
}

/** One instant the music speaks, and how loudly. */
interface Onset {
  atMs: number;
  level: number;
}

function bandIndexOf(level: number, current: number | null): number {
  const relative = level / FORTE_VELOCITY;
  if (current !== null) {
    // Hold the band we are in until the level clearly leaves it, so a value
    // sitting on a boundary does not flicker between two marks.
    const floor = current === 0 ? -Infinity : (BANDS[current - 1] as { ceiling: number }).ceiling;
    const ceiling = (BANDS[current] as { ceiling: number }).ceiling;
    if (relative > floor - HYSTERESIS && relative <= ceiling + HYSTERESIS) return current;
  }
  for (let i = 0; i < BANDS.length; i += 1) {
    if (relative <= (BANDS[i] as { ceiling: number }).ceiling) return i;
  }
  return BANDS.length - 1;
}

/**
 * The loudest note struck at each instant, in time order.
 *
 * The loudest, not the average: a melody over a soft accompaniment is as loud
 * as the melody, and averaging it against the left hand would flatten every
 * piece written that way into one long mezzo.
 */
function onsetsOf(notes: readonly { startMs: number; velocity: number }[]): Onset[] {
  const byTime = new Map<number, number>();
  for (const note of notes) {
    const found = byTime.get(note.startMs);
    if (found === undefined || note.velocity > found) byTime.set(note.startMs, note.velocity);
  }
  return [...byTime.entries()]
    .map(([atMs, level]) => ({ atMs, level }))
    .sort((a, b) => a.atMs - b.atMs);
}

/**
 * The level of the passage around each onset, as a percentile of its window.
 *
 * A percentile and not a mean: an accent is a single value far from its
 * neighbours, and a mean is moved by exactly that — the harder the accent, the
 * more it drags the level, so a sharp sforzando would write itself a mark. A
 * rank statistic ignores it outright however hard it was struck, while still
 * following a real climb, where the whole window has moved together.
 */
function smooth(onsets: readonly Onset[]): number[] {
  return onsets.map((_, i) => {
    const from = Math.max(0, i - SMOOTHING_RADIUS);
    const to = Math.min(onsets.length - 1, i + SMOOTHING_RADIUS);
    const window: number[] = [];
    for (let j = from; j <= to; j += 1) window.push((onsets[j] as Onset).level);
    window.sort((a, b) => a - b);
    const at = Math.min(window.length - 1, Math.round((window.length - 1) * LEVEL_PERCENTILE));
    return window[at] as number;
  });
}

/**
 * Collapse runs that climb or fall steadily into hairpins.
 *
 * A swell written as four marks in a row is four things to read; written as one
 * wedge it is one, and it is the one the composer meant. The marks at either
 * end stay — a hairpin says "get louder", never how loud to arrive.
 */
function foldHairpins(
  marks: DynamicEvent[],
  bands: number[],
  minSpanMs: number,
  maxSpanMs: number,
): DynamicsReading {
  const keptMarks: DynamicEvent[] = [];
  const hairpins: HairpinEvent[] = [];

  let i = 0;
  while (i < marks.length) {
    let end = i;
    let direction = 0;
    while (end + 1 < marks.length) {
      const step = (bands[end + 1] as number) - (bands[end] as number);
      if (step === 0) break;
      const way = step > 0 ? 1 : -1;
      if (direction === 0) direction = way;
      else if (way !== direction) break;
      end += 1;
    }

    const steps = end - i;
    const from = marks[i] as DynamicEvent;
    const to = marks[end] as DynamicEvent;
    const spanMs = to.atMs - from.atMs;
    if (steps >= HAIRPIN_MIN_STEPS && spanMs >= minSpanMs && spanMs <= maxSpanMs) {
      keptMarks.push(from);
      hairpins.push({ fromMs: from.atMs, toMs: to.atMs, grow: direction > 0 });
      keptMarks.push(to);
      i = end + 1;
    } else {
      keptMarks.push(from);
      i += 1;
    }
  }
  return { marks: keptMarks, hairpins };
}

/**
 * The dynamics a take is playing, as marks and hairpins.
 *
 * Empty for a take with nothing in it, and for one played so evenly that a
 * single mark says everything — which is the right answer, not a failure.
 */
export function readDynamics(
  notes: readonly { startMs: number; velocity: number }[],
  options: DynamicsOptions,
): DynamicsReading {
  const onsets = onsetsOf(notes);
  if (onsets.length === 0) return { marks: [], hairpins: [] };

  const levels = smooth(onsets);
  const minGapMs = Math.max(1, options.barMs * MIN_MARK_BARS);
  const minHairpinMs = options.minHairpinMs ?? options.barMs * 2;

  const marks: DynamicEvent[] = [];
  const bands: number[] = [];
  /** The band the reading is in, which moves freely; marks lag behind it. */
  let current: number | null = null;
  /** The band the page currently claims, and when it started claiming it. */
  let written: number | null = null;
  let writtenAt = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < onsets.length; i += 1) {
    current = bandIndexOf(levels[i] as number, current);
    // Nothing to say while the page already claims this level. That covers
    // both a level that never moved and one that wandered off and came back.
    if (current === written) continue;
    const at = (onsets[i] as Onset).atMs;
    // A change that has not yet held for a couple of bars is not a dynamic —
    // it is the music breathing. Say nothing and let it settle; if it is real
    // it will still be true at the next onset, and get its mark then.
    if (at - writtenAt < minGapMs) continue;

    marks.push({ atMs: at, mark: (BANDS[current] as { mark: DynamicMark }).mark });
    bands.push(current);
    written = current;
    writtenAt = at;
  }

  return foldHairpins(marks, bands, minHairpinMs, options.barMs * HAIRPIN_MAX_BARS);
}

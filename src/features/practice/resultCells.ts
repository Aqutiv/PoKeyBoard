import { createTakeTempoMap, type MeasureSpan, type TempoMapInput } from '@/domain/tempoMap';

/**
 * How a run went, told part by part: a run through the take in sections of
 * four bars, a run round a loop in passes. Each part is a cell the results
 * card colours by how much of it went right.
 *
 * Pure, and indifferent to what was asked for: a "wait for me" run hands in
 * its steps, and a run kept in time can hand in its notes.
 */

/** One thing a run asked for, where in the take, and whether it went right. */
export interface Outcome {
  atMs: number;
  good: boolean;
}

/** How a part went, from its share of outcomes that went right. */
export type Grade = 'good' | 'fair' | 'weak';

/** Four bars of a run through the take. Bars count from 1, as the score numbers them. */
export interface BarsCell {
  kind: 'bars';
  fromBar: number;
  toBar: number;
  /** Where the section starts and ends in the take: what looping it plays. */
  startMs: number;
  endMs: number;
  good: number;
  total: number;
  grade: Grade;
}

/** One time round a loop. Passes count from 1, the run's first. */
export interface PassCell {
  kind: 'pass';
  pass: number;
  good: number;
  total: number;
  grade: Grade;
}

export type ResultCell = BarsCell | PassCell;

/** What the cells need to know about the run beyond its outcomes. */
export interface CellContext {
  /** The take's tempo, whose bar lines a section keeps to. */
  tempo: TempoMapInput;
  /** How long the take plays: its last bar ends the last section. */
  takeDurationMs: number;
  /** A run round a loop is told in passes rather than in bars. */
  looping: boolean;
}

/** Bars to a section: a phrase's length in most music, and short enough to loop. */
export const BARS_PER_SECTION = 4;

/**
 * Passes a card shows, the latest: a loop left going round for minutes would
 * otherwise outgrow the row, and the passes that matter are the last ones.
 */
export const MAX_PASS_CELLS = 8;

/** Good from 90%, fair from 60%. Counted in whole numbers, so 9 in 10 is exactly good. */
export function gradeOf(good: number, total: number): Grade {
  if (good * 10 >= total * 9) return 'good';
  if (good * 10 >= total * 6) return 'fair';
  return 'weak';
}

/** A run's cells: its passes round a loop, or else its sections of the take. */
export function resultCells(outcomes: readonly Outcome[], context: CellContext): ResultCell[] {
  return context.looping ? passCells(splitPasses(outcomes)) : sectionCells(outcomes, context);
}

/**
 * Passes told apart by where they start again: the music has gone back to the
 * loop's top whenever an outcome is not after the one before it. That holds
 * for one outcome to a moment, as a hold's steps are — even a single step
 * round a loop starts a pass of its own each time. Outcomes that share a
 * moment, a chord's notes kept in time, need their passes from the caller
 * (`passCells`).
 */
function splitPasses(outcomes: readonly Outcome[]): Outcome[][] {
  const passes: Outcome[][] = [];
  let previous: Outcome | null = null;
  for (const outcome of outcomes) {
    if (previous === null || outcome.atMs <= previous.atMs) passes.push([]);
    (passes[passes.length - 1] as Outcome[]).push(outcome);
    previous = outcome;
  }
  return passes;
}

/**
 * A cell for each of the latest passes, numbered from the run's first, so
 * the passes shown keep the numbers they were played as.
 */
export function passCells(passes: readonly (readonly Outcome[])[]): PassCell[] {
  const first = Math.max(0, passes.length - MAX_PASS_CELLS);
  return passes.slice(first).map((outcomes, index) => {
    const good = outcomes.filter((outcome) => outcome.good).length;
    const total = outcomes.length;
    return { kind: 'pass', pass: first + index + 1, good, total, grade: gradeOf(good, total) };
  });
}

/**
 * A cell for each section of four bars the run asked for anything in. The
 * sections keep to the take's bars, 1–4, 5–8 and so on, wherever the run
 * started, so a cell is a passage that can be looped as it stands; the last
 * ends with the take's last bar.
 */
function sectionCells(
  outcomes: readonly Outcome[],
  { tempo, takeDurationMs }: Pick<CellContext, 'tempo' | 'takeDurationMs'>,
): BarsCell[] {
  if (outcomes.length === 0) return [];
  const lastAtMs = outcomes.reduce((last, outcome) => Math.max(last, outcome.atMs), 0);
  // The bars the take plays in, the one it ends in being its last; and any
  // an outcome lies in, which only a take that ends on its last note's onset
  // would need.
  const spans = createTakeTempoMap(tempo).measureSpans(Math.max(takeDurationMs - 1, lastAtMs), 1);
  const tallies = new Map<number, { good: number; total: number }>();
  for (const outcome of outcomes) {
    const section = Math.floor(barIndexAt(spans, outcome.atMs) / BARS_PER_SECTION);
    const tally = tallies.get(section) ?? { good: 0, total: 0 };
    tally.total += 1;
    if (outcome.good) tally.good += 1;
    tallies.set(section, tally);
  }
  return [...tallies]
    .sort(([a], [b]) => a - b)
    .map(([section, { good, total }]) => {
      const first = section * BARS_PER_SECTION;
      const last = Math.min(first + BARS_PER_SECTION, spans.length) - 1;
      return {
        kind: 'bars',
        fromBar: first + 1,
        toBar: last + 1,
        startMs: (spans[first] as MeasureSpan).startMs,
        endMs: (spans[last] as MeasureSpan).endMs,
        good,
        total,
        grade: gradeOf(good, total),
      };
    });
}

/** The bar `ms` falls in: the last to start at or before it. */
function barIndexAt(spans: readonly MeasureSpan[], ms: number): number {
  let low = 0;
  let high = spans.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((spans[middle] as MeasureSpan).startMs <= ms) low = middle;
    else high = middle - 1;
  }
  return low;
}

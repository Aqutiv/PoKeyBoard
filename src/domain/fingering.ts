import { isBlackKey } from '@/utils/midi';
import { noteHand, type Hand } from './hands';
import { isSilentNote } from './noteEvents';
import type { Finger, NoteEvent } from './takeTypes';

/**
 * Which finger plays each note: the score's own where it prints one, and the
 * rest worked out, one hand at a time, as the fingering that asks least of the
 * hand across the whole piece.
 *
 * The cost of a fingering follows Parncutt, Sloboda, Clarke, Raekallio and
 * Desain's ergonomic model (1997): how far each pair of fingers stretches
 * comfortably, the thumb and little finger kept off black keys between white
 * ones, the weak fourth finger, the thumb passing under, and a hand changing
 * position over three notes. A chord takes the same spans between its
 * neighbouring keys. The search goes over the hand's events, the keys it
 * strikes together, and is second order, so the three-note rules are scored
 * exactly where they apply. The score's printed fingers are fixed points it
 * fits the rest around.
 *
 * The left hand is fingered as a right hand on the keyboard's mirror image:
 * reflected about D, every key keeps its colour and every interval its size,
 * so one table of spans serves both hands.
 *
 * Editors print fingers where fingering is hardest, and editions disagree
 * with each other too, so what this works out is a playable suggestion, not
 * the one right answer; fingering.test.ts measures it against the library's
 * printed fingers.
 */

/** The left hand's frame: pitch → 124 − pitch, a reflection about D4. */
const MIRROR = 124;

/**
 * Two times this close are one to a hand: notes starting this close together
 * are struck together, and a silence this short is no rest. Wider than a hand
 * spreads a chord, or the 11 ms a score's rounding leaves between two voices
 * in the Ballade's closing run, and narrower than the library's fastest run,
 * 39 ms a note.
 */
const TIMING_SLACK_MS = 35;

/** A hand strikes at most five keys at once; past that the rest go unfingered. */
const MAX_KEYS = 5;

/**
 * Parncutt et al.'s spans for each pair of fingers, right hand, in semitones
 * from the lower-numbered finger's key to the higher's (negative: crossed): the
 * practical, comfortable and relaxed least, then the relaxed, comfortable and
 * practical most.
 */
type Spans = readonly [number, number, number, number, number, number];
const SPANS: Readonly<Record<string, Spans>> = {
  '1-2': [-5, -3, 1, 5, 8, 10],
  '1-3': [-4, -2, 3, 7, 10, 12],
  '1-4': [-3, -1, 5, 9, 12, 14],
  '1-5': [-1, 1, 7, 10, 13, 15],
  '2-3': [1, 1, 1, 2, 3, 5],
  '2-4': [1, 1, 3, 4, 5, 7],
  '2-5': [2, 2, 5, 6, 8, 10],
  '3-4': [1, 1, 1, 2, 2, 4],
  '3-5': [1, 1, 3, 4, 5, 7],
  '4-5': [1, 1, 1, 2, 3, 5],
};

function spansOf(lower: number, higher: number): Spans {
  return SPANS[`${lower}-${higher}`] as Spans;
}

/** Past the practical span a hand does not stretch further, it jumps: a jump costs this however far. */
const JUMP = 20;
/** One finger on two keys in a row: a jump, or half one where a chord moves the hand as a block. */
const SAME_FINGER = 20;
const SAME_FINGER_CHORDAL = 10;
/** A key struck again this soon with the same finger costs `FAST_REPEAT`; later, nothing. */
const FAST_REPEAT_MS = 200;
const FAST_REPEAT = 3;
/** Across a rest the hand is free to move, so a move there costs this much of one without. */
const ACROSS_REST = 0.5;

/** One hand's notes that start together: its keys, low to high in the hand's frame. */
interface HandEvent {
  readonly startMs: number;
  /** When the last of its notes is let go. */
  readonly endMs: number;
  /** Its keys, five at most: the right hand's highest, the left hand's lowest. */
  readonly keys: number[];
  readonly black: boolean[];
  /** The notes on each key; two voices striking one key share it. */
  readonly notes: NoteEvent[][];
  /** The finger the score prints on each key, if any. */
  readonly printed: (Finger | undefined)[];
  /** Notes past the five keys a hand can strike: left unfingered. */
  readonly extra: NoteEvent[];
}

/** Rules 1–3: a stretch or squeeze past the comfortable and relaxed spans of fingers lo < hi. */
function spanCost(interval: number, lo: number, hi: number): number {
  const [, minComf, minRel, maxRel, maxComf] = spansOf(lo, hi);
  let cost = 0;
  if (interval > maxComf) cost += 2 * (interval - maxComf);
  else if (interval < minComf) cost += 2 * (minComf - interval);
  const weight = lo === 1 ? 1 : 2;
  if (interval < minRel) cost += weight * (minRel - interval);
  else if (interval > maxRel) cost += weight * (interval - maxRel);
  return cost;
}

/** The move from key `a` (black or not) under finger `fa` to key `b` under `fb`. */
function pairCost(
  interval: number,
  blackA: boolean,
  fa: number,
  blackB: boolean,
  fb: number,
  fast: boolean,
  chordal: boolean,
): number {
  if (fa === fb) {
    if (interval === 0) return fast ? FAST_REPEAT : 0;
    return chordal ? SAME_FINGER_CHORDAL : SAME_FINGER;
  }
  // A repeated key taken by another finger: the further apart, the more awkward.
  if (interval === 0) return Math.abs(fa - fb);
  const [lo, hi, span] = fa < fb ? [fa, fb, interval] : [fb, fa, -interval];
  let cost = spanCost(span, lo, hi);
  // Rule 8: 3 then 4. Rule 9: 3 on a white key beside 4 on a black one.
  if (fa === 3 && fb === 4) cost += 1;
  if ((fa === 3 && fb === 4) || (fa === 4 && fb === 3)) {
    const [black3, black4] = fa === 3 ? [blackA, blackB] : [blackB, blackA];
    if (!black3 && black4) cost += 1;
  }
  // Rule 12: the thumb passing under, or a finger crossing over it.
  if (lo === 1 && span < 0) {
    const [blackThumb, blackOther] = fa === 1 ? [blackA, blackB] : [blackB, blackA];
    if (blackThumb === blackOther) cost += 1;
    else if (blackThumb && !blackOther) cost += 3;
  }
  return Math.min(cost, JUMP);
}

/**
 * One finger on one key, whatever the move (rules 6, 10 and 11): the weak
 * fourth finger, and the thumb or little finger on a black key, worse with a
 * white one before or after it. A lone note's thumb on black counts double: a
 * chord can lean on it, a line cannot.
 */
function keyCost(
  finger: number,
  black: boolean,
  blackBefore: boolean | undefined,
  blackAfter: boolean | undefined,
  lone: boolean,
): number {
  let cost = finger === 4 ? 1 : 0;
  if (black && finger === 1) {
    let thumb = 1;
    if (blackBefore === false) thumb += 2;
    if (blackAfter === false) thumb += 2;
    cost += thumb * (lone ? 2 : 1);
  } else if (black && finger === 5) {
    if (blackBefore === false) cost += 2;
    if (blackAfter === false) cost += 2;
  }
  return cost;
}

/** Rules 4, 5 and 7 over three lone notes: a change of hand position, and 3-4-5 in any order. */
function tripleCost(
  p1: number,
  f1: number,
  p2: number,
  f2: number,
  p3: number,
  f3: number,
): number {
  // Three different fingers, none below 3: 3, 4 and 5 in some order.
  let cost = f1 !== f2 && f2 !== f3 && f1 !== f3 && Math.min(f1, f2, f3) === 3 ? 1 : 0;
  if (f1 === f3) {
    if (p1 !== p3) cost += 1 + Math.min(Math.abs(p3 - p1), JUMP);
    return cost;
  }
  const [lo, hi, span] = f1 < f3 ? [f1, f3, p3 - p1] : [f3, f1, p1 - p3];
  const [minPrac, minComf, , , maxComf, maxPrac] = spansOf(lo, hi);
  if (span > maxComf || span < minComf) {
    const full =
      f2 === 1 &&
      Math.min(p1, p3) < p2 &&
      p2 < Math.max(p1, p3) &&
      (span > maxPrac || span < minPrac);
    cost += full ? 2 : 1;
    cost += Math.min(span > maxComf ? span - maxComf : minComf - span, JUMP);
  }
  return cost;
}

const pairTables = new Map<string, Float64Array>();

/** Every finger pair's cost for one move, `[fa − 1][fb − 1]` flattened, scaled by `factor`. */
function pairTable(
  interval: number,
  blackA: boolean,
  blackB: boolean,
  fast: boolean,
  factor: number,
  chordal: boolean,
): Float64Array {
  const key = `${interval}|${+blackA}${+blackB}${+fast}${+chordal}|${factor}`;
  let table = pairTables.get(key);
  if (!table) {
    table = new Float64Array(25);
    for (let fa = 1; fa <= 5; fa += 1) {
      for (let fb = 1; fb <= 5; fb += 1) {
        table[(fa - 1) * 5 + fb - 1] =
          pairCost(interval, blackA, fa, blackB, fb, fast, chordal) * factor;
      }
    }
    pairTables.set(key, table);
  }
  return table;
}

const tripleTables = new Map<string, Float64Array>();

/** Every finger triple's cost for three lone notes `d2` and `d3` from the first, `[f1][f2][f3]` flattened. */
function tripleTable(d2: number, d3: number, factor: number): Float64Array {
  const key = `${d2}|${d3}|${factor}`;
  let table = tripleTables.get(key);
  if (!table) {
    table = new Float64Array(125);
    for (let f1 = 1; f1 <= 5; f1 += 1) {
      for (let f2 = 1; f2 <= 5; f2 += 1) {
        for (let f3 = 1; f3 <= 5; f3 += 1) {
          table[(f1 - 1) * 25 + (f2 - 1) * 5 + f3 - 1] = factor * tripleCost(0, f1, d2, f2, d3, f3);
        }
      }
    }
    tripleTables.set(key, table);
  }
  return table;
}

/**
 * Every way to give `k` keys `k` different fingers rising with pitch, by `k`,
 * in lexical order: a depth-first walk adding fingers upward finds them so.
 */
const FINGERINGS: readonly (readonly Finger[])[][] = (() => {
  const byCount: Finger[][][] = [[], [], [], [], [], []];
  const walk = (from: number, chosen: Finger[]) => {
    (byCount[chosen.length] as Finger[][]).push(chosen);
    for (let finger = from; finger <= 5; finger += 1)
      walk(finger + 1, [...chosen, finger as Finger]);
  };
  walk(1, []);
  return byCount;
})();

/**
 * The fingerings an event may take: all of them, or, keeping the score's own,
 * those that keep as many of its printed fingers as any fingering can. That is
 * all of them, unless two cannot stand together, as when one is the other
 * hand's.
 */
function fingeringsFor(event: HandEvent, keepPrinted: boolean): readonly (readonly Finger[])[] {
  const all = FINGERINGS[event.keys.length] as readonly (readonly Finger[])[];
  if (!keepPrinted || event.printed.every((finger) => finger === undefined)) return all;
  const kept = (fingers: readonly Finger[]) =>
    fingers.filter((finger, k) => finger === event.printed[k]).length;
  const best = Math.max(...all.map(kept));
  return all.filter((fingers) => kept(fingers) === best);
}

/** The colour of the key in `event` nearest `pitch`, the first of two as near. */
function nearestBlack(event: HandEvent | undefined, pitch: number): boolean | undefined {
  if (!event) return undefined;
  let best = Infinity;
  let black: boolean | undefined;
  event.keys.forEach((key, k) => {
    const distance = Math.abs(key - pitch);
    if (distance < best) {
      best = distance;
      black = event.black[k];
    }
  });
  return black;
}

/**
 * The cheapest fingering for a hand's events, one per event, by a second-order
 * Viterbi search: a state is the last two events' fingerings, so a three-note
 * rule sees all three. Ties go to the first in lexical order.
 */
function solveHand(events: readonly HandEvent[], keepPrinted: boolean): (readonly Finger[])[] {
  const n = events.length;
  if (n === 0) return [];
  const states = events.map((event) => fingeringsFor(event, keepPrinted));
  const restAfter = events.map((event, e) => {
    const next = events[e + 1];
    return next !== undefined && next.startMs - event.endMs > TIMING_SLACK_MS;
  });

  // Each event's own cost under each of its fingerings.
  const unary = events.map((event, e) => {
    const lone = event.keys.length === 1;
    const perKey = event.keys.map((key, k) => {
      const black = event.black[k] as boolean;
      const before = nearestBlack(events[e - 1], key);
      const after = nearestBlack(events[e + 1], key);
      return [1, 2, 3, 4, 5].map((finger) => keyCost(finger, black, before, after, lone));
    });
    return (states[e] as readonly (readonly Finger[])[]).map((fingers) => {
      let cost = 0;
      fingers.forEach((finger, k) => {
        cost += (perKey[k] as number[])[finger - 1] as number;
      });
      if (fingers.length > 1) {
        let chord = 0;
        for (let k = 0; k + 1 < fingers.length; k += 1) {
          chord += spanCost(
            (event.keys[k + 1] as number) - (event.keys[k] as number),
            fingers[k] as number,
            fingers[k + 1] as number,
          );
        }
        cost += chord;
      }
      return cost;
    });
  });

  // The cost of each move between neighbouring events, fingering to fingering:
  // every key of one paired with every key of the next, averaged, so a chord
  // moving as a block is not charged once per voice.
  const moves: Float64Array[] = [];
  for (let e = 0; e + 1 < n; e += 1) {
    const a = events[e] as HandEvent;
    const b = events[e + 1] as HandEvent;
    const fast = b.startMs - a.startMs < FAST_REPEAT_MS;
    const pairs = a.keys.length * b.keys.length;
    const factor =
      ((restAfter[e] ? ACROSS_REST : 1) * Math.max(a.keys.length, b.keys.length)) / pairs;
    const chordal = a.keys.length > 1 || b.keys.length > 1;
    const tables: { i: number; j: number; table: Float64Array }[] = [];
    a.keys.forEach((keyA, i) => {
      b.keys.forEach((keyB, j) => {
        tables.push({
          i,
          j,
          table: pairTable(
            keyB - keyA,
            a.black[i] as boolean,
            b.black[j] as boolean,
            fast,
            factor,
            chordal,
          ),
        });
      });
    });
    const from = states[e] as readonly (readonly Finger[])[];
    const to = states[e + 1] as readonly (readonly Finger[])[];
    const move = new Float64Array(from.length * to.length);
    from.forEach((fa, s) => {
      to.forEach((fb, t) => {
        let cost = 0;
        for (const { i, j, table } of tables) {
          cost += table[((fa[i] as number) - 1) * 5 + (fb[j] as number) - 1] as number;
        }
        move[s * to.length + t] = cost;
      });
    });
    moves.push(move);
  }

  const lone = (e: number) => (events[e] as HandEvent).keys.length === 1;
  // value[h][i]: the cheapest way to reach event e − 1 in state h and e in state
  // i, flattened; before the second event, one row stands in for no state.
  let value = Float64Array.from(unary[0] as number[]);
  let rows = 1;
  const back: Int8Array[] = [new Int8Array(0)];
  for (let e = 1; e < n; e += 1) {
    const prev = states[e - 1] as readonly (readonly Finger[])[];
    const cur = states[e] as readonly (readonly Finger[])[];
    const move = moves[e - 1] as Float64Array;
    const own = unary[e] as number[];
    const next = new Float64Array(prev.length * cur.length);
    const pointers = new Int8Array(prev.length * cur.length);
    if (e >= 2 && lone(e - 2) && lone(e - 1) && lone(e)) {
      const p1 = (events[e - 2] as HandEvent).keys[0] as number;
      const p2 = (events[e - 1] as HandEvent).keys[0] as number;
      const p3 = (events[e] as HandEvent).keys[0] as number;
      const factor = restAfter[e - 2] || restAfter[e - 1] ? ACROSS_REST : 1;
      const triple = tripleTable(p2 - p1, p3 - p1, factor);
      const before = states[e - 2] as readonly (readonly Finger[])[];
      for (let i = 0; i < prev.length; i += 1) {
        const f2 = (prev[i] as readonly Finger[])[0] as number;
        for (let j = 0; j < cur.length; j += 1) {
          const f3 = (cur[j] as readonly Finger[])[0] as number;
          let best = Infinity;
          let arg = 0;
          for (let h = 0; h < rows; h += 1) {
            const f1 = (before[h] as readonly Finger[])[0] as number;
            const cost =
              (value[h * prev.length + i] as number) +
              (triple[(f1 - 1) * 25 + (f2 - 1) * 5 + f3 - 1] as number);
            if (cost < best) {
              best = cost;
              arg = h;
            }
          }
          next[i * cur.length + j] =
            best + (move[i * cur.length + j] as number) + (own[j] as number);
          pointers[i * cur.length + j] = arg;
        }
      }
    } else {
      for (let i = 0; i < prev.length; i += 1) {
        let best = Infinity;
        let arg = 0;
        for (let h = 0; h < rows; h += 1) {
          const cost = value[h * prev.length + i] as number;
          if (cost < best) {
            best = cost;
            arg = h;
          }
        }
        for (let j = 0; j < cur.length; j += 1) {
          next[i * cur.length + j] =
            best + (move[i * cur.length + j] as number) + (own[j] as number);
          pointers[i * cur.length + j] = arg;
        }
      }
    }
    value = next;
    rows = prev.length;
    back.push(pointers);
  }

  // Back from the cheapest last pair of states.
  const columns = (states[n - 1] as readonly (readonly Finger[])[]).length;
  let best = Infinity;
  let lastI = 0;
  let lastJ = 0;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < columns; j += 1) {
      const cost = value[i * columns + j] as number;
      if (cost < best) {
        best = cost;
        lastI = i;
        lastJ = j;
      }
    }
  }
  const choice = new Array<number>(n).fill(0);
  choice[n - 1] = lastJ;
  if (n > 1) {
    choice[n - 2] = lastI;
    let i = lastI;
    let j = lastJ;
    for (let e = n - 1; e >= 2; e -= 1) {
      const h = (back[e] as Int8Array)[i * (states[e] as readonly unknown[]).length + j] as number;
      choice[e - 2] = h;
      j = i;
      i = h;
    }
  }
  return choice.map(
    (c, e) => (states[e] as readonly (readonly Finger[])[])[c] as readonly Finger[],
  );
}

/** The notes one hand strikes together, by key in its frame, as they are gathered. */
interface Strike {
  readonly startMs: number;
  endMs: number;
  readonly byKey: Map<number, NoteEvent[]>;
}

function toEvent({ startMs, endMs, byKey }: Strike, right: boolean): HandEvent {
  const frame = [...byKey.keys()].sort((a, b) => a - b);
  const keys = frame.slice(-MAX_KEYS);
  const notes = keys.map((key) => byKey.get(key) as NoteEvent[]);
  return {
    startMs,
    endMs,
    keys,
    black: keys.map((key) => isBlackKey(right ? key : MIRROR - key)),
    notes,
    printed: notes.map((onKey) => onKey.find((note) => note.finger !== undefined)?.finger),
    extra: frame.slice(0, -MAX_KEYS).flatMap((key) => byKey.get(key) as NoteEvent[]),
  };
}

/** A hand's played notes as its events, in order. */
function handEvents(notes: readonly NoteEvent[], hand: Hand): HandEvent[] {
  const right = hand === 'right';
  const played = notes
    .filter((note) => !isSilentNote(note) && noteHand(note) === hand)
    .sort((a, b) => a.startMs - b.startMs || a.midi - b.midi);
  const strikes: Strike[] = [];
  for (const note of played) {
    let strike = strikes[strikes.length - 1];
    if (!strike || note.startMs - strike.startMs > TIMING_SLACK_MS) {
      strike = { startMs: note.startMs, endMs: note.startMs, byKey: new Map() };
      strikes.push(strike);
    }
    const key = right ? note.midi : MIRROR - note.midi;
    const onKey = strike.byKey.get(key);
    if (onKey) onKey.push(note);
    else strike.byKey.set(key, [note]);
    strike.endMs = Math.max(strike.endMs, note.startMs + note.durationMs);
  }
  return strikes.map((strike) => toEvent(strike, right));
}

export interface FingeringOptions {
  /**
   * Keep the score's own fingers, and fit the rest around them: the default.
   * Off, every note is worked out, which is how the model is measured against
   * the editors.
   */
  readonly keepPrinted?: boolean;
}

const memo = new WeakMap<readonly NoteEvent[], ReadonlyMap<string, Finger>>();

/**
 * Each played note's finger by its id, 1 (the thumb) to 5 (the little finger):
 * the one the score prints, or the one worked out for it. A note the hand can
 * not reach — the sixth key of one hand's chord — has none, and neither has a
 * note no one plays (`isSilentNote`). Worked out once per notes array.
 */
export function noteFingers(
  notes: readonly NoteEvent[],
  { keepPrinted = true }: FingeringOptions = {},
): ReadonlyMap<string, Finger> {
  const known = keepPrinted ? memo.get(notes) : undefined;
  if (known) return known;
  const fingers = new Map<string, Finger>();
  for (const hand of ['right', 'left'] as const) {
    const events = handEvents(notes, hand);
    solveHand(events, keepPrinted).forEach((chosen, e) => {
      const event = events[e] as HandEvent;
      event.notes.forEach((onKey, k) => {
        for (const note of onKey) {
          fingers.set(note.id, (keepPrinted ? note.finger : undefined) ?? (chosen[k] as Finger));
        }
      });
      if (keepPrinted) {
        for (const note of event.extra)
          if (note.finger !== undefined) fingers.set(note.id, note.finger);
      }
    });
  }
  if (keepPrinted) memo.set(notes, fingers);
  return fingers;
}

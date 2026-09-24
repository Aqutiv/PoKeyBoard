import type { NoteEvent, NoteStep } from '@/domain/takeTypes';
import type { Spelling } from './keySignature';
import { TREBLE_SPLIT_MIDI } from './staffMapping';

/**
 * Spelling a performance: which letter each played pitch is written on.
 *
 * A take records keys, not notes, so 70 is B flat or A sharp only by context.
 * The key signature alone answers most of it, which is how this used to work:
 * one fixed table per key. But a table cannot tell a C7 chord (C E G B♭) from
 * a chromatic run up to B (A A♯ B), or the leading tone of D minor (C♯) from
 * the Neapolitan of C (D♭) — it spelled every pitch outside the key one way,
 * and so a minor key's commonest accidental came out on the wrong letter.
 *
 * The model here is the line of fifths, on which every spelling has a place:
 * … B♭ −2, F −1, C 0, G 1, D 2 … F♯ 6, C♯ 7 … Tonal music keeps close to its
 * key on that line, so each note takes the spelling nearest a centre of
 * gravity, which starts at the key and follows the music as it goes, the way a
 * modulating passage drags its accidentals with it. Two things override
 * nearness:
 *
 * - **Chords stay compact.** Notes sounding together are spelled as a stack
 *   of thirds wherever that is possible, which on the line of fifths means the
 *   narrowest span: E G♯ B D, not E A♭ B D.
 * - **Chromatic lines resolve by step.** A note outside the scale that moves
 *   a semitone to its neighbour is written a letter away from it — rising
 *   notes sharp, falling notes flat, as a chromatic scale is written.
 *
 * Pure and deterministic: the same notes and key always spell the same way,
 * so the live score and the printed page never disagree.
 */

export type KeyMode = 'major' | 'minor';

export interface SpellingKey {
  /** Sharps (positive) or flats (negative) in the key signature. */
  fifths: number;
  mode: KeyMode;
}

/** Line-of-fifths position of each natural letter, C first: C D E F G A B. */
const NATURAL_POSITION = [0, 2, 4, -1, 1, 3, 5] as const;

/** The letter at each natural position, F (−1) first. */
const LETTER_AT = [3, 0, 4, 1, 5, 2, 6] as const;

/** F double flat to B double sharp: nothing needs more than two accidentals. */
const LOWEST_POSITION = -15;
const HIGHEST_POSITION = 19;

/**
 * Where on the line of fifths a key's accidentals centre.
 *
 * Measured from the major tonic. Major sits two fifths up, which makes C major
 * spell C♯, E♭, F♯, G♯ and B♭: the secondary dominants' leading tones sharp,
 * the blues' flat third and seventh flat. Minor sits a little further up still
 * — a minor key's accidentals lean sharp, towards its dominant — so A minor
 * spells C♯ and D♯, and B♭ for its Neapolitan. Neither is a whole number: at
 * one, some pitch class lands exactly halfway and the choice becomes a coin.
 */
const MAJOR_CENTRE = 2.1;
const MINOR_CENTRE = 3.9;

/** Notes starting this close together are one chord for spelling. */
const CHORD_WINDOW_MS = 35;

/**
 * How fast the centre of gravity forgets. Half its pull is gone after this
 * long: a passage in another key tilts it for as long as it lasts, and a
 * single chromatic note barely moves it.
 */
const GRAVITY_HALF_LIFE_MS = 1_000;

/**
 * How many notes' worth of pull the key itself keeps. Strong: measured against
 * the scores, the key predicts a spelling better than what came just before,
 * so context only tips the notes the key leaves nearly even.
 */
const KEY_WEIGHT = 16;

/** Weight of a chord's span on the line of fifths, against nearness. */
const SPREAD_WEIGHT = 2;

/** Cost of spelling a chromatic step against the direction it resolves in. */
const RESOLUTION_WEIGHT = 5;

/** How long a chromatic note may wait for the neighbour it resolves to. */
const RESOLUTION_WINDOW_MS = 1_500;

/**
 * Cost of a spelling a reader has to stop and work out: a white key written
 * with an accidental (E♯, B♯, F♭, C♭) or anything with two. Each is right in
 * the keys whose scales hold it — E♯ leads to F♯ minor's tonic — and costs
 * nothing there. Elsewhere it outweighs a resolution, so a natural falling
 * back to the key's flat is written E♮ E♭, not F♭ E♭.
 */
const AWKWARD_WEIGHT = 7;

/** Spellings a chord may choose between before the search is narrowed. */
const MAX_FREE_PITCH_CLASSES = 8;

/**
 * The weights above, gathered so they can be measured: the defaults were
 * chosen by spelling the vendored scores — whose own spellings are known —
 * and keeping what got the most of them right.
 */
export interface SpellingTuning {
  majorCentre: number;
  minorCentre: number;
  gravityHalfLifeMs: number;
  keyWeight: number;
  spreadWeight: number;
  resolutionWeight: number;
  awkwardWeight: number;
}

export const DEFAULT_SPELLING_TUNING: Readonly<SpellingTuning> = {
  majorCentre: MAJOR_CENTRE,
  minorCentre: MINOR_CENTRE,
  gravityHalfLifeMs: GRAVITY_HALF_LIFE_MS,
  keyWeight: KEY_WEIGHT,
  spreadWeight: SPREAD_WEIGHT,
  resolutionWeight: RESOLUTION_WEIGHT,
  awkwardWeight: AWKWARD_WEIGHT,
};

/** Position on the line of fifths: C 0, G 1, … F −1, B♭ −2, and 7 per sharp. */
export function linePosition(spelling: Spelling): number {
  return (NATURAL_POSITION[spelling.letter] as number) + 7 * spelling.alter;
}

const STEP_LETTER: Record<NoteStep, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** Where a note's own spelling sits, if its source wrote one down. */
function hintedPosition(note: NoteEvent): number | undefined {
  if (note.spelling === undefined) return undefined;
  return linePosition({ letter: STEP_LETTER[note.spelling.step], alter: note.spelling.alter });
}

/** The spelling at a position on the line of fifths. */
export function spellingAt(position: number): Spelling {
  const natural = ((((position + 1) % 7) + 7) % 7) - 1;
  return { letter: LETTER_AT[natural + 1] as number, alter: (position - natural) / 7 };
}

/** Every position a pitch class can be written at, flattest first. */
function positionsFor(pitchClass: number): number[] {
  // Seven is its own inverse modulo twelve, so pitch class p sits at 7p.
  const base = (pitchClass * 7) % 12;
  const out: number[] = [];
  for (const position of [base - 12, base, base + 12]) {
    if (position >= LOWEST_POSITION && position <= HIGHEST_POSITION) out.push(position);
  }
  return out;
}

export function keyCentre(
  key: SpellingKey,
  tuning: Readonly<SpellingTuning> = DEFAULT_SPELLING_TUNING,
): number {
  return key.fifths + (key.mode === 'minor' ? tuning.minorCentre : tuning.majorCentre);
}

/**
 * Whether a position is part of the key's scale rather than colour added to
 * it. The seven letters of the signature, and in minor its raised sixth and
 * seventh, which a minor key uses as freely as its own notes.
 */
function inScale(position: number, key: SpellingKey): boolean {
  const offset = position - key.fifths;
  if (offset >= -1 && offset <= 5) return true;
  return key.mode === 'minor' && (offset === 6 || offset === 8);
}

/** See `AWKWARD_WEIGHT`. */
function awkward(position: number, key: SpellingKey): boolean {
  if (inScale(position, key)) return false;
  const { letter, alter } = spellingAt(position);
  if (Math.abs(alter) >= 2) return true;
  // E and B sharpened, and F and C flattened, each land on a white key.
  return alter === 1
    ? letter === 2 || letter === 6
    : alter === -1 && (letter === 3 || letter === 0);
}

function pitchClassOf(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** The nearest position to `centre`, ties to the key's own side. */
function nearest(positions: readonly number[], centre: number, key: SpellingKey): number {
  let best = positions[0] as number;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const position of positions) {
    const distance = Math.abs(position - centre);
    const tie = Math.abs(distance - bestDistance) < 1e-9;
    if (
      distance < bestDistance - 1e-9 ||
      (tie && (key.fifths >= 0 ? position > best : position < best))
    ) {
      best = position;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A note heard on its own, with nothing around it yet: the key's nearest
 * spelling. What the live score shows under a finger before the note is laid
 * out with the rest, so it lands on the line it will stay on.
 */
export function spellInKey(midi: number, key: SpellingKey): Spelling {
  return spellingAt(nearest(positionsFor(pitchClassOf(midi)), keyCentre(key), key));
}

function staffOf(note: NoteEvent): string {
  return note.staff ?? (note.midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
}

/** One strand of melody: a voice where the score numbered them, else a staff. */
function strandOf(note: NoteEvent): string {
  return note.voice !== undefined ? `${staffOf(note)}|${note.voice}` : staffOf(note);
}

interface Resolution {
  /** The letter a chromatic note should take to reach its neighbour by step. */
  letter: number;
}

/**
 * For each chromatic note that moves a semitone to the next note of its strand,
 * the letter that makes that move a step: one below a note it rises to, one
 * above a note it falls to. The neighbour's own letter is read from the key,
 * which is where nearly every resolution lands.
 */
function findResolutions(
  notes: readonly NoteEvent[],
  order: readonly number[],
  key: SpellingKey,
  centre: number,
): Map<number, Resolution> {
  const byStrand = new Map<string, number[]>();
  for (const index of order) {
    const strand = strandOf(notes[index] as NoteEvent);
    const list = byStrand.get(strand);
    if (list) list.push(index);
    else byStrand.set(strand, [index]);
  }

  const resolutions = new Map<number, Resolution>();
  for (const indices of byStrand.values()) {
    for (let i = 0; i < indices.length; i += 1) {
      const note = notes[indices[i] as number] as NoteEvent;
      const pitchClass = pitchClassOf(note.midi);
      const positions = positionsFor(pitchClass);
      if (positions.some((position) => inScale(position, key))) continue; // not chromatic

      // The next onset of this strand, and whichever of its notes is a
      // semitone away.
      let j = i + 1;
      while (
        j < indices.length &&
        (notes[indices[j] as number] as NoteEvent).startMs - note.startMs < CHORD_WINDOW_MS
      ) {
        j += 1;
      }
      if (j >= indices.length) continue;
      const nextStart = (notes[indices[j] as number] as NoteEvent).startMs;
      if (nextStart - note.startMs > RESOLUTION_WINDOW_MS) continue;
      for (let k = j; k < indices.length; k += 1) {
        const next = notes[indices[k] as number] as NoteEvent;
        if (next.startMs - nextStart >= CHORD_WINDOW_MS) break;
        const step = next.midi - note.midi;
        if (step !== 1 && step !== -1) continue;
        const target = spellingAt(
          hintedPosition(next) ?? nearest(positionsFor(pitchClassOf(next.midi)), centre, key),
        );
        resolutions.set(indices[i] as number, {
          letter: (((target.letter - step) % 7) + 7) % 7,
        });
        break;
      }
    }
  }
  return resolutions;
}

/**
 * How far back a note still sounding under the pedal counts as the harmony a
 * chord is spelled against.
 */
const HELD_CONTEXT_MS = 3_000;

/** The flattest and sharpest spellings among the notes still sounding. */
interface AnchorSpan {
  low: number;
  high: number;
}

/** A stretch the sustain pedal holds down, sorted and non-overlapping. */
export interface SustainSpan {
  fromMs: number;
  toMs: number;
}

/**
 * When each note stops sounding: its release, or the pedal's if the pedal was
 * down when the key came up. A pedalled arpeggio is a chord to the ear, and
 * spelled as one.
 */
function soundingEnds(notes: readonly NoteEvent[], pedals: readonly SustainSpan[]): number[] {
  return notes.map((note) => {
    const release = note.startMs + note.durationMs;
    let low = 0;
    let high = pedals.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const span = pedals[mid] as SustainSpan;
      if (release < span.fromMs) high = mid - 1;
      else if (release >= span.toMs) low = mid + 1;
      else return span.toMs;
    }
    return release;
  });
}

/**
 * The spelling of every note, in the order given.
 *
 * Notes are read in time order a chord at a time. Each chord takes the
 * spellings that minimise a cost: distance from the centre of gravity, plus
 * the chord's span on the line of fifths (with anything still sounding beneath
 * it counted in, pedal included), plus a penalty for each chromatic note
 * written against the semitone it resolves by. The chord's choice then joins
 * the centre of gravity for what follows.
 *
 * A note that carries its source's spelling (`NoteEvent.spelling`) is written
 * exactly that way and is context for the rest, never overruled by it.
 */
export function spellNotes(
  notes: readonly NoteEvent[],
  key: SpellingKey,
  pedals: readonly SustainSpan[] = [],
  tuning: Readonly<SpellingTuning> = DEFAULT_SPELLING_TUNING,
): Spelling[] {
  const out: Spelling[] = new Array<Spelling>(notes.length);
  if (notes.length === 0) return out;
  const ends = soundingEnds(notes, pedals);

  const order = notes.map((_, index) => index);
  order.sort(
    (a, b) =>
      (notes[a] as NoteEvent).startMs - (notes[b] as NoteEvent).startMs ||
      (notes[a] as NoteEvent).midi - (notes[b] as NoteEvent).midi,
  );

  const prior = keyCentre(key, tuning);
  const resolutions = findResolutions(notes, order, key, prior);
  const positions = new Array<number>(notes.length);

  let pull = 0;
  let weight = 0;
  let clock = (notes[order[0] as number] as NoteEvent).startMs;
  /** Notes already spelled that may still be sounding, as anchors for chords. */
  let held: number[] = [];

  let start = 0;
  while (start < order.length) {
    const onset = (notes[order[start] as number] as NoteEvent).startMs;
    let end = start + 1;
    while (
      end < order.length &&
      (notes[order[end] as number] as NoteEvent).startMs - onset < CHORD_WINDOW_MS
    ) {
      end += 1;
    }
    const chord = order.slice(start, end);

    const decay = Math.pow(0.5, (onset - clock) / tuning.gravityHalfLifeMs);
    pull *= decay;
    weight *= decay;
    clock = onset;
    const centre = (tuning.keyWeight * prior + pull) / (tuning.keyWeight + weight);

    // Still sounding, and recent: a pedal held down for a whole piece keeps
    // every note sounding, but harmony a few seconds back has nothing to say
    // about this chord — and keeping all of it would make every chord rescan
    // the whole take.
    held = held.filter(
      (index) =>
        (ends[index] as number) > onset + CHORD_WINDOW_MS &&
        (notes[index] as NoteEvent).startMs > onset - HELD_CONTEXT_MS,
    );
    let anchors: AnchorSpan | null = null;
    for (const index of held) {
      const position = positions[index] as number;
      anchors = anchors
        ? { low: Math.min(anchors.low, position), high: Math.max(anchors.high, position) }
        : { low: position, high: position };
    }

    const choice = spellChord(notes, chord, anchors, centre, key, resolutions, tuning);
    for (const index of chord) {
      const note = notes[index] as NoteEvent;
      const position = hintedPosition(note) ?? (choice.get(pitchClassOf(note.midi)) as number);
      positions[index] = position;
      pull += position;
      weight += 1;
      held.push(index);
    }
    start = end;
  }

  for (let index = 0; index < notes.length; index += 1) {
    out[index] = spellingAt(positions[index] as number);
  }
  return out;
}

/**
 * One chord's spellings, by pitch class: a doubled note is one note, spelled
 * once. Searches every combination of each pitch class's two nearest
 * spellings, which is a handful for any real chord.
 */
function spellChord(
  notes: readonly NoteEvent[],
  chord: readonly number[],
  anchors: AnchorSpan | null,
  centre: number,
  key: SpellingKey,
  resolutions: ReadonlyMap<number, Resolution>,
  tuning: Readonly<SpellingTuning>,
): Map<number, number> {
  const pitchClasses = [
    ...new Set(chord.map((index) => pitchClassOf((notes[index] as NoteEvent).midi))),
  ];

  const options = pitchClasses.map((pitchClass) => {
    // A pitch class the source spelled is settled; the search only works
    // around it.
    for (const index of chord) {
      const note = notes[index] as NoteEvent;
      const hinted = hintedPosition(note);
      if (hinted !== undefined && pitchClassOf(note.midi) === pitchClass) return [hinted];
    }
    // So is one the key's own scale holds: a minor key's leading tone is its
    // leading tone whatever sounds beside it, and only the notes the scale
    // does not have are open to argument.
    const all = positionsFor(pitchClass);
    const scale = all.find((position) => inScale(position, key));
    if (scale !== undefined) return [scale];
    all.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
    return all.slice(0, 2);
  });
  // A cluster of every black and white key has nothing to learn from its own
  // span. Past a point, pitch classes whose nearest spelling is clearly best
  // stop being searched, which keeps a forearm on the keys from costing 2^12.
  if (pitchClasses.length > MAX_FREE_PITCH_CLASSES) {
    options.forEach((choices, i) => {
      const [first, second] = choices;
      if (
        second === undefined ||
        Math.abs(second - centre) - Math.abs((first as number) - centre) >= 6
      ) {
        options[i] = [nearest(choices, centre, key)];
      }
    });
  }

  /** The resolution letters wanted by each pitch class of this chord. */
  const wanted = pitchClasses.map((pitchClass) => {
    const letters: number[] = [];
    for (const index of chord) {
      if (pitchClassOf((notes[index] as NoteEvent).midi) !== pitchClass) continue;
      const resolution = resolutions.get(index);
      if (resolution) letters.push(resolution.letter);
    }
    return letters;
  });
  // A single note moving by semitone over held harmony is a passing or
  // neighbour note, not a chord tone, and the chord beneath it has no say in
  // its spelling: E D♯ E over a held C stays D♯.
  const passing = pitchClasses.length === 1 && (wanted[0] as number[]).length > 0;
  const context = passing ? null : anchors;

  let best: number[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestLean = Number.NEGATIVE_INFINITY;
  const current = new Array<number>(pitchClasses.length);
  // An exact tie goes to the side the key already leans, as `nearest` does.
  const lean = key.fifths >= 0 ? 1 : -1;

  const visit = (i: number): void => {
    if (i === pitchClasses.length) {
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      let cost = 0;
      let leaning = 0;
      for (let p = 0; p < current.length; p += 1) {
        const position = current[p] as number;
        cost += Math.abs(position - centre);
        if (awkward(position, key)) cost += tuning.awkwardWeight;
        leaning += lean * position;
        low = Math.min(low, position);
        high = Math.max(high, position);
        const spelling = spellingAt(position);
        for (const letter of wanted[p] as number[]) {
          // Only a resolution the note can actually be written for counts —
          // never at the price of a double sharp or flat.
          if (spelling.letter === letter) continue;
          const reachable = positionsFor(pitchClasses[p] as number).some((candidate) => {
            const target = spellingAt(candidate);
            return target.letter === letter && Math.abs(target.alter) <= 1;
          });
          if (reachable) cost += tuning.resolutionWeight;
        }
      }
      if (context) {
        low = Math.min(low, context.low);
        high = Math.max(high, context.high);
      }
      if (current.length > 1 || context) cost += tuning.spreadWeight * (high - low);
      if (cost < bestCost - 1e-9 || (cost < bestCost + 1e-9 && leaning > bestLean)) {
        bestCost = cost;
        bestLean = leaning;
        best = [...current];
      }
      return;
    }
    for (const position of options[i] as number[]) {
      current[i] = position;
      visit(i + 1);
    }
  };
  visit(0);

  const chosen = new Map<number, number>();
  pitchClasses.forEach((pitchClass, i) => {
    chosen.set(
      pitchClass,
      (best as number[] | null)?.[i] ?? nearest(options[i] as number[], centre, key),
    );
  });
  return chosen;
}

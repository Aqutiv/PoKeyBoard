import { writtenNotes } from '@/domain/noteEvents';
import { createTakeTempoMap, type TempoMap } from '@/domain/tempoMap';
import type {
  NoteEvent,
  PedalEvent,
  QuantizationSetting,
  TempoChange,
  TimeSignature,
} from '@/domain/takeTypes';
import { barDurationMs, beatDurationMs } from '@/utils/timing';
import type { BeamPiece } from './beamGeometry';
import {
  beamCountFor,
  beatsForSymbol,
  quantizeGridBeats,
  symbolForBeats,
  TRIPLET,
  tupletSymbolForBeats,
  type BeamCount,
  type DurationSymbol,
} from './quantization';
import { readDynamics, type DynamicEvent, type HairpinEvent } from './dynamics';
import { detectMode } from './keyDetection';
import { accidentalFor, normalizeFifths, type AccidentalKind } from './keySignature';
import { spellNotes, type KeyMode } from './pitchSpelling';
import {
  barUnits,
  exactValueForUnits,
  restStep,
  restsForGap,
  SMALLEST_UNITS,
  symbolForUnits,
  unitsPerBeat,
  valuesForSpan,
} from './rests';
import {
  absoluteDiatonic,
  defaultClefFor,
  ledgerLineSteps,
  midiToStaffPosition,
  stemGoesDown,
  TREBLE_SPLIT_MIDI,
  type ClefKind,
  type StaffKind,
} from './staffMapping';
import {
  declaredDivisionOf,
  fitsDivision,
  MIN_ONSETS_TO_DECIDE,
  ternaryDivisionOf,
} from './tuplets';

/**
 * Whether a notehead is drawn on its chord's column (0) or one head-width to
 * the left (-1) or right (+1) of it, to clear a head it would otherwise
 * collide with. The stem never moves with it.
 */
export type HeadShift = -1 | 0 | 1;

export interface LaidOutNote {
  id: string;
  midi: number;
  /** Raw performance timing (playback truth, never quantized). */
  startMs: number;
  durationMs: number;
  /** Where the note is drawn (visual quantization only). */
  displayStartMs: number;
  staff: StaffKind;
  /** The clef this note is read under; usually the staff's own. */
  clef: ClefKind;
  /** The voice the source numbered, if any; see `ChordGroup.voice`. */
  voice?: number;
  /** The written tuplet bracket this note sits in; see `ChordGroup.tupletGroup`. */
  tupletGroup?: number;
  /** How many notes that bracket squeezes in; see `ChordGroup.tupletNumeral`. */
  tupletNumeral?: number;
  step: number;
  /** The accidental printed here, after the key and the rest of the bar. */
  accidental: AccidentalKind | null;
  /** How the pitch is altered from its letter; see `StaffPosition.alter`. */
  alter: number;
  symbol: DurationSymbol;
  /** True when this head continues one before it, under a tie. */
  tiedFromPrev: boolean;
  /** True when a tie runs from this head into the next piece of the same note. */
  tiedToNext: boolean;
  ledger: number[];
  headShift: HeadShift;
  /**
   * Which column left of the chord this note's accidental is drawn in, 0 being
   * nearest the heads. Sharps are tall enough to foul each other, so notes
   * close together stack outward instead of sharing one column.
   */
  accidentalColumn: number;
}

/** Notes of one voice on one staff whose quantized starts coincide. */
export interface ChordGroup {
  staff: StaffKind;
  /** The clef in force where this chord falls. */
  clef: ClefKind;
  displayStartMs: number;
  /** Sorted by step ascending (lowest note first). */
  notes: LaidOutNote[];
  /**
   * Which line of the staff's polyphony this is, 0 for the topmost. Taken from
   * the source score when it numbers voices (stable, so beams run across
   * columns) and otherwise from the chord's pitch rank in its stack.
   */
  voice: number;
  stemDown: boolean;
  symbol: DurationSymbol;
  /**
   * The written tuplet bracket this chord belongs to, where the source drew one.
   *
   * A beam stops at the end of a group, which is how a beat of six triplet
   * sixteenths is engraved as two beamed threes carrying a 3 each rather than
   * one six — the way the same passage is printed. Absent where the score
   * bracketed nothing, and then the beat does the grouping as it always has.
   */
  tupletGroup?: number;
  /**
   * The numeral that bracket prints — its `<actual-notes>`, six for a sextuplet
   * — which a beam holding only part of it carries. Present with `tupletGroup`.
   */
  tupletNumeral?: number;
  /** Index into `ScoreLayout.beams`, or null for a chord that flags instead. */
  beamId: number | null;
}

/**
 * A run of chords carrying one beam, in time order.
 *
 * Beaming is the last word on stem direction — a run commits to one and every
 * member follows — so it is settled here rather than by whichever renderer got
 * there first. Both views then draw the same grouping, and the heads that have
 * to move for a stem can be placed once, afterwards, against the answer.
 */
export interface BeamGroup {
  staff: StaffKind;
  stemDown: boolean;
  /**
   * The most beams any member carries: 1 for eighths, 2 for sixteenths, 3 for
   * 32nds, 4 for 64ths. The first beam runs the whole length; the stems reach
   * far enough out for this many.
   */
  beamCount: BeamCount;
  members: ChordGroup[];
  /** How many notes the run squeezes in, where it is a tuplet — the numeral. */
  tupletCount: number | null;
  /**
   * The beams after the first, level by level: `secondary[0]` is the second
   * beam, and so on up to `beamCount`. See `BeamPiece`.
   */
  secondary: BeamPiece[][];
}

/**
 * A silence engraved on one staff. Rests are derived, never stored: what a
 * take records is when keys went down, and the silence between them is
 * whatever the written note values leave over.
 */
export interface LaidOutRest {
  staff: StaffKind;
  /** Where the rest is drawn, on the same clock as `ChordGroup`. */
  displayStartMs: number;
  symbol: DurationSymbol;
  /** Diatonic steps above the staff's bottom line; 4 is the middle line. */
  step: number;
}

export interface MeasureInfo {
  index: number;
  startMs: number;
  endMs: number;
  /** The tempo in force here; equal to `bpm` unless the piece changes tempo. */
  bpm: number;
  /** True when no chord starts inside the measure (draws a whole rest). */
  empty: boolean;
  /** The clef each staff is read under here, carried forward between changes. */
  clefs: Record<StaffKind, ClefKind>;
}

/** Beats within this of a whole one are on it; see the note in `layoutScore`. */
const BEAT_EPSILON = 1e-3;

/**
 * How far apart a player's "together" can be. A rolled chord, or one hand a
 * shade behind the other, spreads a chord over tens of milliseconds; see
 * `chordTimings`.
 */
const CHORD_ONSET_WINDOW_MS = 40;

/**
 * The line a note's source wrote it in, or null where it names none, as
 * nothing recorded does. The voice number alone is not enough: the importer
 * numbers each staff's voices afresh from 0 (a part with one staff, across the
 * part), so voice 0 of the treble and voice 0 of the bass are the two hands'
 * own lines, and the staff is part of the answer.
 */
function sourceLine(note: NoteEvent): string | null {
  return note.voice === undefined ? null : `${note.staff ?? ''}|${note.voice}`;
}

/**
 * The onset each note is written from, and the release it is written to: its
 * own, unless it is one of a chord struck a little unevenly, in which case the
 * chord's median onset — so the chord snaps to one column, and to the column
 * its notes are nearest together — and the release it shares with the notes
 * let go with it; see `sharedReleases`. An even number of notes has two middle
 * onsets and the median is halfway between them; either one alone would lean
 * the chord early or late. Snapped note by note, a chord that straddles the
 * middle of a grid step splits into two, a column apart.
 *
 * Across both staves, because the unevenness is as often one hand behind the
 * other as a roll within one. Never over more than `windowFor` allows any note
 * of it — half a grid step, at most, on the finest grid among them, and
 * nothing at all with no grid, where there is no grid line to straddle and
 * exact onsets are what was asked for — so a fast run is never mistaken for a
 * chord, and a score, whose chords share one onset exactly, is left as it
 * was. Where the staves are on different grids, one hand in threes, the chord
 * is written from a point both can draw; where there is none, its first note
 * is written as played and the notes after it are grouped afresh. See
 * `sharedOnset`.
 *
 * And only notes held down together for at least half as long as the
 * shortest of them lasts. However unevenly a chord is struck, its notes are
 * down together for most of their length — measured by the shortest, because
 * one hand may let go early while the other holds on. Notes played in turn are
 * not: a grace note, or a key played twice in quick succession, is let go
 * before the next note starts, and legato overlaps two notes only briefly,
 * the earlier key coming up just after the next goes down. One key is never
 * two notes of a chord, whatever the timing.
 *
 * Nor across the voices a score declares: notes its source put in different
 * voices are separate lines, however near together they start and however long
 * they overlap. A note that names no voice, as nothing recorded does, can still
 * join any chord. See `sourceLine`.
 */
function chordTimings(
  notes: readonly NoteEvent[],
  windowFor: (note: NoteEvent) => number,
  drawnAt: (note: NoteEvent, onsetMs: number) => number,
): { onsets: number[]; releases: number[] } {
  const onsets = notes.map((note) => note.startMs);
  const releases = notes.map((note) => note.startMs + note.durationMs);
  const order = notes.map((_, index) => index);
  order.sort((a, b) => (notes[a] as NoteEvent).startMs - (notes[b] as NoteEvent).startMs);
  let i = 0;
  while (i < order.length) {
    const first = notes[order[i] as number] as NoteEvent;
    /** The narrowest window of any note in the chord, which its span has to fit. */
    let window = windowFor(first);
    /** The soonest any note of the chord is let go. */
    let heldTogetherUntil = first.startMs + first.durationMs;
    /** How long the chord's shortest note is held. */
    let shortestMs = first.durationMs;
    const pitches = new Set([first.midi]);
    /** The line the chord was written in, once a note of it names one. */
    let line = sourceLine(first);
    let j = i + 1;
    while (j < order.length) {
      const next = notes[order[j] as number] as NoteEvent;
      const nextWindow = Math.min(window, windowFor(next));
      if (next.startMs - first.startMs > nextWindow || pitches.has(next.midi)) break;
      const nextLine = sourceLine(next);
      if (line !== null && nextLine !== null && nextLine !== line) break;
      const releasedAt = Math.min(heldTogetherUntil, next.startMs + next.durationMs);
      const shortest = Math.min(shortestMs, next.durationMs);
      if (releasedAt - next.startMs < shortest / 2) break;
      window = nextWindow;
      heldTogetherUntil = releasedAt;
      shortestMs = shortest;
      pitches.add(next.midi);
      line ??= nextLine;
      j += 1;
    }
    if (j - i > 1) {
      const chord = order.slice(i, j).map((index) => notes[index] as NoteEvent);
      const onset = sharedOnset(chord, middleOf(chord.map((note) => note.startMs)), drawnAt);
      if (onset === null) {
        // No onset every note can be drawn at is no chord. Its first note keeps
        // its own onset and release, as if never grouped, and the rest are
        // looked at again without it: they may still be a chord of their own.
        i += 1;
        continue;
      }
      const letGo = sharedReleases(chord, window);
      for (let k = i; k < j; k += 1) {
        onsets[order[k] as number] = onset;
        releases[order[k] as number] = letGo[k - i] as number;
      }
    }
    i = j;
  }
  return { onsets, releases };
}

/** The middle of some values in order: the middle one, or halfway between two. */
function middleOf(sorted: readonly number[]): number {
  const upper = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[upper] as number;
  return ((sorted[upper - 1] as number) + (sorted[upper] as number)) / 2;
}

/**
 * Where each note of a chord is written to: its own release, unless it was let
 * go with others of the chord, in which case the middle of their releases.
 *
 * Written from the chord's onset, a note's value runs to where it was let go.
 * That keeps a chord let go together on one value, and a note moved to the
 * chord's onset ending where it did rather than short of the next note with a
 * rest between. But a chord is let go as unevenly as it is struck, and a roll
 * released in the same stagger it was played in would otherwise come out as
 * values a step apart, on two stems. So releases fall together by the same
 * measure onsets do — within the chord's window of the first of them — and a
 * note let go well apart from the rest, one hand lifting early, keeps its own.
 */
function sharedReleases(chord: readonly NoteEvent[], window: number): number[] {
  const releases = chord.map((note) => note.startMs + note.durationMs);
  const order = releases.map((_, index) => index);
  order.sort((a, b) => (releases[a] as number) - (releases[b] as number));
  const written = [...releases];
  let g = 0;
  while (g < order.length) {
    const from = releases[order[g] as number] as number;
    let h = g + 1;
    while (h < order.length && (releases[order[h] as number] as number) - from <= window) h += 1;
    const release = middleOf(order.slice(g, h).map((index) => releases[index] as number));
    for (let k = g; k < h; k += 1) written[order[k] as number] = release;
    g = h;
  }
  return written;
}

/**
 * Where a chord whose median onset is `median` is written from, so that all of
 * it is drawn in one column — or null where there is no such place, and so no
 * chord.
 *
 * Each note is drawn on its own staff's grid, and those differ where one hand
 * plays in threes: the triplet grid can round the median to the beat while the
 * sixteenth grid rounds it to the sixteenth after. So where the grids disagree
 * the chord is written from whichever of their answers every note of it can be
 * drawn at, which is usually the beat the hands share, and its values are
 * measured from there. Where there is no such answer the notes are two
 * rhythms meeting, three against two, rather than one chord: the first of them
 * is written from its own onset as if never grouped, and the rest are looked
 * at again without it. Drawn where its grid has no place, a note would leave
 * its bar short of rests or push its triplet out of step, and written from the
 * median it could land a column away from where it was played.
 *
 * `drawnAt` is where a note's own staff draws it, written from a given onset.
 */
function sharedOnset(
  chord: readonly NoteEvent[],
  median: number,
  drawnAt: (note: NoteEvent, onsetMs: number) => number,
): number | null {
  const answers = new Set(chord.map((note) => drawnAt(note, median)));
  if (answers.size === 1) return median;
  let shared: number | null = null;
  for (const answer of answers) {
    if (!chord.every((note) => drawnAt(note, answer) === answer)) continue;
    if (shared === null || Math.abs(answer - median) < Math.abs(shared - median)) shared = answer;
  }
  return shared;
}

/**
 * A stretch drawn an octave in, under an `8va` or `8vb` line.
 *
 * The notes inside it are written where they can be read and the line says to
 * play them an octave away, which is the whole purpose: a piano reaches far
 * enough past both staves that the alternative is a ladder of ledger lines
 * nobody can count at speed.
 */
export interface OctaveSpan {
  staff: StaffKind;
  fromMs: number;
  toMs: number;
  /** True for 8va above the treble, false for 8vb below the bass. */
  up: boolean;
}

/** A stretch the sustain pedal is held down for, in take milliseconds. */
export interface PedalSpan {
  fromMs: number;
  toMs: number;
}

export interface ScoreLayout {
  chords: ChordGroup[];
  /** Sorted by display start; see `LaidOutRest`. */
  rests: LaidOutRest[];
  /** Beam runs; `ChordGroup.beamId` indexes into this. See `BeamGroup`. */
  beams: BeamGroup[];
  /** Dynamic marks read from how hard the keys were struck. */
  dynamics: DynamicEvent[];
  /** Crescendos and diminuendos spanning several bars; see `HairpinEvent`. */
  hairpins: HairpinEvent[];
  /** Sorted, non-overlapping; see `PedalSpan`. */
  pedals: PedalSpan[];
  /** Passages drawn an octave in; see `OctaveSpan`. */
  octaves: OctaveSpan[];
  measures: MeasureInfo[];
  /** The FIRST measure's length; later measures can differ (tempo changes). */
  barMs: number;
  /** Layout extent in ms — always whole measures. */
  totalMs: number;
  /** Whether the key signature was read as major or minor when spelling. */
  keyMode: KeyMode;
}

export interface LayoutOptions {
  bpm: number;
  timeSignature: TimeSignature;
  quantization: QuantizationSetting;
  /**
   * Sharps (positive) or flats (negative) the score is written with. What the
   * prefix prints, and the key every note is spelled against; C major by
   * default.
   */
  keySignature?: number;
  /**
   * Whether that signature is read as its major key or its relative minor,
   * which decides how accidentals lean (see pitchSpelling.ts). Read from the
   * notes when not given.
   */
  keyMode?: KeyMode;
  /** The take's pedal events; engraved as brackets under the bass staff. */
  pedals?: readonly PedalEvent[];
  /** Tempo marks after the first, from the take (`tempo.changes`). */
  tempoChanges?: readonly TempoChange[];
  /** Never lay out fewer measures than this (empty-score scaffold). */
  minMeasures?: number;
  /**
   * Beam four plain eighths in common time as one half-bar group, as engraved
   * music does. On by default; a lesson teaching the beat turns it off, so its
   * eighths come in the pairs its prose describes.
   */
  eighthsByHalfBar?: boolean;
}

/**
 * What makes two notes of a stack part of the same stem. The source's voice
 * where there is one; otherwise the written note value, which is the most a
 * recorded take can tell us — notes of equal length struck together are a
 * chord, and anything else is a second line of music.
 */
function voiceIdentity(note: LaidOutNote): string {
  if (note.voice !== undefined) return `v${note.voice}`;
  return `d${note.symbol.base}${note.symbol.dotted ? '.' : ''}`;
}

/** Outer voices stem away from each other; a lone voice follows the staff. */
function stemDownFor(index: number, count: number, averageStep: number): boolean {
  if (count === 1) return stemGoesDown(averageStep);
  if (index === 0) return false; // top voice up
  if (index === count - 1) return true; // bottom voice down
  return stemGoesDown(averageStep);
}

/**
 * One stack of simultaneous same-staff notes → a chord per voice, topmost
 * first. A single-voice stack yields exactly the chord this layout has always
 * produced, so recorded takes engrave unchanged.
 */
function chordsInStack(stack: LaidOutNote[]): ChordGroup[] {
  const byVoice = new Map<string, LaidOutNote[]>();
  for (const note of stack) {
    const key = voiceIdentity(note);
    const group = byVoice.get(key);
    if (group) group.push(note);
    else byVoice.set(key, [note]);
  }

  const voices = [...byVoice.values()].map((groupNotes) => {
    groupNotes.sort((a, b) => a.step - b.step || a.midi - b.midi);
    const averageStep = groupNotes.reduce((sum, note) => sum + note.step, 0) / groupNotes.length;
    let longest = groupNotes[0] as LaidOutNote;
    for (const note of groupNotes) {
      if (note.durationMs > longest.durationMs) longest = note;
    }
    // The group comes from the same note the symbol does, so a chord is read as
    // part of whatever figure its written value belongs to.
    return {
      notes: groupNotes,
      averageStep,
      symbol: longest.symbol,
      tupletGroup: longest.tupletGroup,
      tupletNumeral: longest.tupletNumeral,
    };
  });
  voices.sort((a, b) => b.averageStep - a.averageStep);

  return voices.map((voice, index) => {
    const first = voice.notes[0] as LaidOutNote;
    return {
      staff: first.staff,
      clef: first.clef,
      displayStartMs: first.displayStartMs,
      notes: voice.notes,
      voice: first.voice ?? index,
      stemDown: stemDownFor(index, voices.length, voice.averageStep),
      symbol: voice.symbol,
      ...(voice.tupletGroup !== undefined ? { tupletGroup: voice.tupletGroup } : {}),
      ...(voice.tupletNumeral !== undefined ? { tupletNumeral: voice.tupletNumeral } : {}),
      beamId: null,
    };
  });
}

/** Steps closer than this leave two sharps overlapping in one column. */
const ACCIDENTAL_CLEARANCE_STEPS = 5;

/**
 * Give each accidental in a chord a column, working down from the top. A sharp
 * stands about two and a half staff spaces tall — five steps — so two of them
 * any closer than that cannot share a column and the lower one moves out a
 * place. Most chords need only column 0.
 */
function stackAccidentals(voices: ChordGroup[]): void {
  const marked = [];
  for (const chord of voices) {
    for (const note of chord.notes) {
      if (note.accidental !== null) marked.push(note);
    }
  }
  if (marked.length < 2) return;
  marked.sort((a, b) => b.step - a.step);

  /** The lowest step already placed in each column, top-down. */
  const lowestInColumn: number[] = [];
  for (const note of marked) {
    let column = 0;
    while (
      lowestInColumn[column] !== undefined &&
      (lowestInColumn[column] as number) - note.step < ACCIDENTAL_CLEARANCE_STEPS
    ) {
      column += 1;
    }
    lowestInColumn[column] = note.step;
    note.accidentalColumn = column;
  }
}

/**
 * Record which way each voice stemmed where it shared a staff with another.
 * Only voices the source numbered count: a derived voice is a pitch rank
 * within one stack, so voting on it would drag plain single-line passages
 * along with whatever the one polyphonic moment decided.
 */
function collectStemVotes(voices: ChordGroup[], votes: Map<string, number>): void {
  for (const chord of voices) {
    if ((chord.notes[0] as LaidOutNote).voice === undefined) continue;
    const key = `${chord.staff}|${chord.voice}`;
    votes.set(key, (votes.get(key) ?? 0) + (chord.stemDown ? 1 : -1));
  }
}

/**
 * An engraver commits a voice to one stem direction and keeps it there, so a
 * staff's two lines stay readable through the beats where one of them happens
 * to be sounding alone. Voices that never meet another are left as they were.
 */
function settleVoiceStems(chords: ChordGroup[], votes: Map<string, number>): void {
  if (votes.size === 0) return;
  for (const chord of chords) {
    const vote = votes.get(`${chord.staff}|${chord.voice}`);
    if (vote !== undefined && vote !== 0) chord.stemDown = vote > 0;
  }
}

/**
 * A step is half a staff space and a notehead is a whole one high, so heads a
 * step apart already overlap, and on the same step a filled head hides a
 * hollow one entirely. Engraving moves one of them a head-width clear, and
 * that is all this does — the stem stays on the chord's own column, so beams
 * and flags are untouched.
 */
function displaceCollidingHeads(voices: ChordGroup[]): void {
  for (const chord of voices) displaceSeconds(chord);
  if (voices.length > 1) displaceAcrossVoices(voices);
}

/** The least a chord has to expose for its heads to be placed. */
export interface StemmedChord {
  stemDown: boolean;
  notes: { step: number; headShift: HeadShift }[];
}

/**
 * Inside one chord, the note that resolves a second is the one on the far side
 * of the stem: reading up the chord when the stem points up, down it when the
 * stem points down. A displaced head clears the column for the note after it,
 * so a cluster alternates instead of marching off the staff.
 *
 * Safe to run again if the stem later turns around — beaming can do that — so
 * it starts by putting every head back on the column.
 */
export function displaceSeconds(chord: StemmedChord): void {
  for (const note of chord.notes) note.headShift = 0;
  // notes are sorted by step ascending; the stem decides which end leads.
  const order = chord.stemDown ? [...chord.notes].reverse() : chord.notes;
  const shift: HeadShift = chord.stemDown ? -1 : 1;
  let previous: (typeof chord.notes)[number] | null = null;
  for (const note of order) {
    if (previous !== null && previous.headShift === 0 && Math.abs(note.step - previous.step) <= 1) {
      note.headShift = shift;
    }
    previous = note;
  }
}

/**
 * Heads of different voices clash on the same terms — a shared step, or steps
 * a single step apart. The up-stem voice is the one that yields, so a unison
 * reads the way an engraver writes it: down-stem head on the column, up-stem
 * head to its right, both stems clear of each other.
 */
function displaceAcrossVoices(voices: ChordGroup[]): void {
  const heads: { chord: ChordGroup; note: LaidOutNote }[] = [];
  for (const chord of voices) {
    for (const note of chord.notes) heads.push({ chord, note });
  }
  heads.sort((a, b) => a.note.step - b.note.step);

  for (let i = 0; i < heads.length; i += 1) {
    const lower = heads[i] as (typeof heads)[number];
    for (let j = i + 1; j < heads.length; j += 1) {
      const upper = heads[j] as (typeof heads)[number];
      if (upper.note.step - lower.note.step > 1) break; // sorted: no closer pair follows
      // A chord has already settled its own seconds, and a head that moved for
      // one is where it needs to be — moving it again only trades the clash.
      if (upper.chord === lower.chord) continue;
      if (lower.note.headShift !== 0 || upper.note.headShift !== 0) continue;
      const bothSameWay = lower.chord.stemDown === upper.chord.stemDown;
      const yields = bothSameWay ? upper : lower.chord.stemDown ? upper : lower;
      yields.note.headShift = 1;
    }
  }
}

interface TieContext {
  tempoMap: TempoMap;
  timeSignature: TimeSignature;
  /** The snap grid in beats, or null when the score is not on one. */
  gridBeats: number | null;
  beatsHeld: (note: { startMs: number; durationMs: number }) => number;
}

/**
 * Cut held notes into the pieces a bar can actually carry, joined by ties.
 *
 * A bar line is a hard edge: no symbol reaches across one, so a note that does
 * is written as a note in each bar with a tie between them. The same applies
 * inside a bar to any length no single value can express, and to anything
 * longer than a whole note — which used to be drawn as a whole note and lose
 * the difference.
 *
 * With no grid there is nothing to align to, so notes are left whole. Only the
 * live score allows that, and the export always sets one.
 */
function tieAcrossBarLines(laidOut: readonly LaidOutNote[], context: TieContext): LaidOutNote[] {
  const { tempoMap, timeSignature, gridBeats, beatsHeld } = context;
  if (gridBeats === null) return [...laidOut];

  const perBeat = unitsPerBeat(timeSignature.denominator);
  const bar = barUnits(timeSignature);
  /** The grid's own step: no piece of a tied note is written shorter than one. */
  const minUnits = Math.max(SMALLEST_UNITS, Math.round(gridBeats * perBeat));
  /** Absolute units (see `UNITS_PER_WHOLE`) from the start of the piece. */
  const unitsAt = (ms: number): number => Math.round(tempoMap.beatAtMs(ms) * perBeat);
  const msAtUnits = (units: number): number => Math.round(tempoMap.msAtBeat(units / perBeat));

  const out: LaidOutNote[] = [];
  for (const note of laidOut) {
    // A tuplet note is written in units the binary values cannot express — a
    // triplet eighth is eight ninety-sixths and no standard value is — so
    // re-deriving it here would round it away. It also lives inside one beat
    // by construction, and a beat never crosses a bar line, so there is
    // nothing here for it to be split at.
    if (note.symbol.tuplet) {
      out.push(note);
      continue;
    }
    const from = unitsAt(note.displayStartMs);
    const heldBeats = Math.max(1, Math.round(beatsHeld(note) / gridBeats)) * gridBeats;
    const to = from + Math.max(minUnits, Math.round(heldBeats * perBeat));

    // Bar lines first, then the value or values that fill each piece between
    // them — one where a single symbol is exactly that long, which is the
    // ordinary case and the one that must not be split.
    const pieces: { startUnits: number; symbol: DurationSymbol }[] = [];
    let edge = from;
    while (edge < to) {
      const measureStart = Math.floor(edge / bar) * bar;
      const nextBarLine = Math.min(to, measureStart + bar);
      const whole = symbolForUnits(nextBarLine - edge);
      if (whole !== null) {
        pieces.push({ startUnits: edge, symbol: whole });
      } else {
        for (const span of valuesForSpan(
          edge - measureStart,
          nextBarLine - measureStart,
          timeSignature,
          minUnits,
        )) {
          pieces.push({ startUnits: measureStart + span.startUnits, symbol: span.symbol });
        }
      }
      edge = nextBarLine;
    }
    if (pieces.length === 0) {
      out.push(note);
      continue;
    }

    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i] as (typeof pieces)[number];
      out.push({
        ...note,
        // Every piece keeps the whole note's performance timing: it is one
        // sounding note, so it lights up as one under the playhead.
        displayStartMs: i === 0 ? note.displayStartMs : msAtUnits(piece.startUnits),
        symbol: piece.symbol,
        // A piece carries on a tie the note arrived with, which is where a
        // tuplet value handed its remainder on at a beat line.
        tiedFromPrev: i > 0 || note.tiedFromPrev,
        tiedToNext: i < pieces.length - 1 || note.tiedToNext,
      });
    }
  }
  return out;
}

/** Eighths and shorter, dotted or not. */
function beamable(chord: ChordGroup): boolean {
  return beamCountFor(chord.symbol.base) > 0;
}

/**
 * Whether a beam may run from one chord straight into the next.
 *
 * The written tuplet groups are what a beam must respect where the source drew
 * them: a beat of six triplet sixteenths bracketed as two threes is engraved as
 * two beamed threes, each numbered 3, and running one beam across the pair
 * would print a six that the score never wrote. Where nothing was bracketed —
 * a recorded take, or a score that declares ratios without drawing groups —
 * both sides are undefined and this says nothing, leaving the beat to group as
 * it always did.
 *
 * Asked here and nowhere else: the page does not group beams of its own, it
 * receives `beamId` from this layout and only gives the run its geometry, so
 * both views follow from this one answer.
 *
 * Different values join: an eighth and two sixteenths, or a dotted eighth and
 * its sixteenth, are one figure and are beamed as one, the shorter notes
 * carrying their extra beams between themselves. Not inside a tuplet, though,
 * where the numeral over the run counts its notes and a change of value would
 * make it lie.
 */
function beamsJoin(previous: ChordGroup, next: ChordGroup): boolean {
  if (previous.tupletGroup !== next.tupletGroup) return false;
  const a = previous.symbol;
  const b = next.symbol;
  if (a.tuplet === undefined && b.tuplet === undefined) return true;
  return (
    a.base === b.base &&
    a.dotted === b.dotted &&
    a.tuplet?.actual === b.tuplet?.actual &&
    a.tuplet?.normal === b.tuplet?.normal
  );
}

/**
 * The beams after the first, for a run whose members carry `counts` beams and
 * start `positions` whole notes into their bar.
 *
 * Neighbours that both carry a level are joined at it. A member that carries it
 * alone gets a stub, which points to the member it forms a pair with at the
 * level above: the second sixteenth of an eighth's worth points back, the
 * first points on. At the ends of the run there is only one way to point.
 */
function secondaryBeams(counts: readonly number[], positions: readonly number[]): BeamPiece[][] {
  const deepest = Math.max(...counts);
  const levels: BeamPiece[][] = [];
  for (let level = 2; level <= deepest; level += 1) {
    const pieces: BeamPiece[] = [];
    // The value a pair of this level's notes adds up to: an eighth for the
    // sixteenths' beam, a sixteenth for the 32nds'.
    const pair = 1 / 2 ** (level + 1);
    let i = 0;
    while (i < counts.length) {
      if ((counts[i] as number) < level) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < counts.length && (counts[j + 1] as number) >= level) j += 1;
      if (j > i) {
        pieces.push({ from: i, to: j });
      } else {
        const offset = (positions[i] as number) / pair;
        const startsPair = Math.abs(offset - Math.round(offset)) < BEAT_EPSILON;
        const stub = i === 0 ? 1 : i === counts.length - 1 ? -1 : startsPair ? 1 : -1;
        pieces.push({ from: i, to: i, stub });
      }
      i = j + 1;
    }
    levels.push(pieces);
  }
  return levels;
}

/** Every member a plain eighth: not dotted, not in a tuplet. */
function plainEighths(run: readonly ChordGroup[]): boolean {
  return run.every(
    (chord) =>
      chord.symbol.base === 'eighth' && !chord.symbol.dotted && chord.symbol.tuplet === undefined,
  );
}

/**
 * Beam runs of equal undotted eighths and shorter values sharing a beat group on
 * one voice of one staff. Compound meters (6/8, 9/8, …) group per dotted
 * beat-unit trio. A beam never crosses a rest, a change of note value, a beat
 * group, or a voice — so a run under a held note stays one beam.
 *
 * The run also settles the stem direction of everything in it: the majority
 * wins, except where the run passes a moment when two voices sound on the
 * staff, which has already stemmed them apart to keep both readable and binds
 * the whole run.
 */
function buildBeamGroups(
  chordsByMeasure: readonly ChordGroup[][],
  measures: readonly MeasureInfo[],
  rests: readonly LaidOutRest[],
  timeSignature: TimeSignature,
  eighthsByHalfBar: boolean,
): BeamGroup[] {
  const compound = timeSignature.numerator % 3 === 0 && timeSignature.denominator >= 8;
  const halfBarEighths =
    eighthsByHalfBar && timeSignature.numerator === 4 && timeSignature.denominator === 4;
  /** Where each staff falls silent — a beam stops at any of these. */
  const silentAt = new Set<string>();
  for (const rest of rests) silentAt.add(`${rest.staff}|${rest.displayStartMs}`);

  const beams: BeamGroup[] = [];
  for (const measure of measures) {
    const inMeasure = chordsByMeasure[measure.index] ?? [];
    if (inMeasure.length === 0) continue;
    const beatMs = beatDurationMs(measure.bpm, timeSignature);
    const groupMs = compound ? beatMs * 3 : beatMs;

    for (const staff of ['treble', 'bass'] as const) {
      const onStaff = inMeasure.filter((chord) => chord.staff === staff);
      if (onStaff.length === 0) continue;

      // How many voices sound at each instant, which is what marks a moment as
      // polyphonic and so fixes the direction of any run passing through it.
      const voicesAt = new Map<number, number>();
      for (const chord of onStaff) {
        voicesAt.set(chord.displayStartMs, (voicesAt.get(chord.displayStartMs) ?? 0) + 1);
      }
      // Every instant the staff is doing something, silence included: a rest
      // has to end a run even where the voice being followed has no chord.
      const times = [...voicesAt.keys()];
      for (const rest of rests) {
        if (rest.staff !== staff) continue;
        if (rest.displayStartMs < measure.startMs || rest.displayStartMs >= measure.endMs) continue;
        times.push(rest.displayStartMs);
      }
      times.sort((a, b) => a - b);

      const byTime = new Map<string, ChordGroup>();
      for (const chord of onStaff) byTime.set(`${chord.voice}|${chord.displayStartMs}`, chord);

      /** Whole notes from the bar line to a chord — how beam levels are counted. */
      const wholesIn = (chord: ChordGroup): number =>
        (chord.displayStartMs - measure.startMs) / beatMs / timeSignature.denominator;

      const emit = (run: ChordGroup[]): void => {
        const polyphonic = run.find((chord) => (voicesAt.get(chord.displayStartMs) ?? 1) > 1);
        const downVotes = run.filter((chord) => chord.stemDown).length;
        const stemDown = polyphonic ? polyphonic.stemDown : downVotes * 2 >= run.length;
        const id = beams.length;
        // A run of tuplet values carries its numeral — but only where the run
        // is whole tuplets. A figure split between the hands leaves a fragment
        // on each staff, and "2" over two thirds of a triplet does not mean a
        // shorter triplet, it means a duplet: a different rhythm altogether.
        // Where the score bracketed the figure, though, a run that is only
        // part of it is still that tuplet — its first note shared with another
        // voice, or a rest — and takes the bracket's own numeral, as the score
        // prints it: six for a sextuplet, whatever ratio its values are drawn
        // in. Undeclared, a fragment says nothing and lets the beam speak.
        const first = run[0] as ChordGroup;
        const ratio = first.symbol.tuplet;
        const bracket = first.tupletNumeral;
        const tupletCount = !ratio
          ? null
          : run.length % ratio.actual === 0
            ? run.length
            : first.tupletGroup !== undefined && bracket !== undefined && run.length < bracket
              ? bracket
              : null;
        const counts = run.map((chord) => beamCountFor(chord.symbol.base) || 1);
        beams.push({
          staff,
          stemDown,
          beamCount: Math.max(...counts) as BeamCount,
          members: run,
          tupletCount,
          secondary: secondaryBeams(counts, run.map(wholesIn)),
        });
        for (const chord of run) {
          chord.stemDown = stemDown;
          chord.beamId = id;
        }
      };

      for (const voice of new Set(onStaff.map((chord) => chord.voice))) {
        /**
         * Each run, with the chord that took over from it where nothing but a
         * beat line ended it — the one kind of break the half bar may undo.
         */
        const runs: { chords: ChordGroup[]; group: number; next: ChordGroup | null }[] = [];
        let run: ChordGroup[] = [];
        let runGroup = -1;

        const flush = (next: ChordGroup | null = null): void => {
          if (run.length >= 2) runs.push({ chords: run, group: runGroup, next });
          run = [];
        };

        for (const timeMs of times) {
          if (silentAt.has(`${staff}|${timeMs}`)) {
            flush();
            continue;
          }
          const chord = byTime.get(`${voice}|${timeMs}`);
          if (!chord) continue;
          if (!beamable(chord)) {
            flush();
            continue;
          }
          // The same hair's-breadth tolerance the ternary reading needs: a beat
          // is rarely a whole number of milliseconds, so a note written on one
          // lands just before it and would otherwise beam with the group before.
          const group = Math.floor((timeMs - measure.startMs) / groupMs + BEAT_EPSILON);
          const previous = run[run.length - 1];
          if (previous !== undefined && !beamsJoin(previous, chord)) flush();
          else if (previous !== undefined && group !== runGroup) flush(chord);
          run.push(chord);
          runGroup = group;
        }
        flush();

        // Common time beams plain eighths by the half bar: four of them across
        // beats one and two (or three and four) are one group, never a pair of
        // pairs — but never across the middle of the bar, where the half-bar
        // accent has to stay visible. Only where the beat line is all that
        // parts the pairs, though: a rest between them breaks the beam in any
        // beat, and joining them again would draw it straight across.
        if (halfBarEighths) {
          for (let k = 0; k + 1 < runs.length; k += 1) {
            const a = runs[k] as (typeof runs)[number];
            const b = runs[k + 1] as (typeof runs)[number];
            if (
              a.group % 2 === 0 &&
              b.group === a.group + 1 &&
              a.next === b.chords[0] &&
              a.chords.length === 2 &&
              b.chords.length === 2 &&
              plainEighths(a.chords) &&
              plainEighths(b.chords)
            ) {
              runs.splice(k, 2, {
                chords: [...a.chords, ...b.chords],
                group: a.group,
                next: b.next,
              });
            }
          }
        }
        for (const { chords } of runs) emit(chords);
      }
    }
  }
  return beams;
}

/**
 * Apply the bar's memory to the accidentals the key left over.
 *
 * An accidental holds for the rest of the measure at the line or space it was
 * written on, and the bar line forgets it. So a repeated F sharp is marked once
 * and not four times, and a note that goes back to what the key says needs a
 * natural to say so — which is the difference between an engraved bar and a
 * page that restates everything on every note.
 *
 * Keyed by staff and absolute pitch — the letter and octave, clef taken out.
 * The step alone would be the line or space, which is the same thing right up
 * until a clef turns over inside the bar: step 0 is E4 before an F clef and G2
 * after it, and a flat written on the first has nothing to say about the
 * second. The letter is what an accidental actually attaches to, so C flat and
 * B still keep their own memories.
 */
function applyMeasureAccidentals(chordsByMeasure: readonly ChordGroup[][]): void {
  for (const inMeasure of chordsByMeasure) {
    /** What each line or space currently sounds as; absent means "as the key says". */
    const inForce = new Map<string, number>();
    // Read in the order the bar is read, so an accidental reaches the notes
    // after it and not the ones before.
    const ordered = [...inMeasure].sort((a, b) => a.displayStartMs - b.displayStartMs);
    for (const chord of ordered) {
      for (const note of chord.notes) {
        const key = `${note.staff}|${absoluteDiatonic(note.step, note.clef)}`;
        // A tie carries its note's accidental over the bar line with it, so the
        // far side of one is never marked again — but it does hold the line for
        // whatever else lands there.
        if (note.tiedFromPrev) {
          note.accidental = null;
          inForce.set(key, note.alter);
          continue;
        }
        const standing = inForce.get(key);
        if (standing === undefined) {
          // Nothing written here yet, so the key signature is still speaking;
          // `accidental` already says whether this note departs from it.
          if (note.accidental !== null) inForce.set(key, note.alter);
        } else if (standing === note.alter) {
          note.accidental = null;
        } else {
          note.accidental = accidentalFor(note.alter);
          inForce.set(key, note.alter);
        }
      }
    }
  }
}

/**
 * Turn pedal events into the stretches a bracket is drawn under.
 *
 * The events are a stream of downs and ups; what gets engraved is the span
 * between them. A down while already down is the same press continuing, and an
 * up with nothing held is ignored, so a stream that never quite balances still
 * draws something sensible. A press left open at the end runs to the end.
 */
function pedalSpans(events: readonly PedalEvent[], totalMs: number): PedalSpan[] {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const spans: PedalSpan[] = [];
  let downAt: number | null = null;
  for (const event of sorted) {
    if (event.down) {
      downAt ??= event.atMs;
    } else if (downAt !== null) {
      if (event.atMs > downAt) spans.push({ fromMs: downAt, toMs: event.atMs });
      downAt = null;
    }
  }
  if (downAt !== null && totalMs > downAt) spans.push({ fromMs: downAt, toMs: totalMs });
  return spans;
}

/** A stretch of one staff that is sounding, in take milliseconds. */
interface SoundingSpan {
  fromMs: number;
  toMs: number;
}

/** Sort and coalesce overlapping spans, so what is left between them is silence. */
function mergeSpans(spans: SoundingSpan[]): SoundingSpan[] {
  spans.sort((a, b) => a.fromMs - b.fromMs);
  const merged: SoundingSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, span.toMs);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Fill a silence that lies inside a beat played in three.
 *
 * The ordinary filler works from the binary values, and a triplet slot is not
 * one of them — a triplet eighth is eight ninety-sixths and nothing standard
 * is. Left to it, the rests come out a shade short and the bar stops adding
 * up, which is the very thing rests were added to fix. So a ternary beat is
 * filled a slot at a time, in the same value its notes are written in.
 */
function pushTupletRests(
  out: LaidOutRest[],
  staff: StaffKind,
  fromUnits: number,
  toUnits: number,
  slotUnits: number,
  denominator: number,
  msAtUnits: (units: number) => number,
): void {
  const symbol = tupletSymbolForBeats(slotUnits / unitsPerBeat(denominator), denominator, TRIPLET);
  for (let at = fromUnits; at + slotUnits <= toUnits + 1e-6; at += slotUnits) {
    out.push({
      staff,
      displayStartMs: msAtUnits(at),
      symbol,
      step: restStep(symbol),
    });
  }
}

function pushRests(
  out: LaidOutRest[],
  staff: StaffKind,
  fromUnits: number,
  toUnits: number,
  timeSignature: TimeSignature,
  minUnits: number,
  msAtUnits: (units: number) => number,
): void {
  for (const span of restsForGap(fromUnits, toUnits, timeSignature, minUnits)) {
    out.push({
      staff,
      displayStartMs: msAtUnits(span.startUnits),
      symbol: span.symbol,
      step: restStep(span.symbol),
    });
  }
}

/**
 * The rests each staff needs, from the silence its chords leave over.
 *
 * A staff is occupied for as long as its notes are *written*, not as long as
 * they were held: play a bar of detached quarters and every one of them lifts
 * early, which is phrasing rather than four extra rests. So the span a chord
 * covers is the length of the symbol it engraves as, which is also exactly the
 * span the reader sees filled.
 *
 * Bars with nothing starting in them are left alone — `MeasureInfo.empty`
 * already draws the whole rest that a wholly silent bar takes.
 */
function deriveRests(
  chords: readonly ChordGroup[],
  measures: readonly MeasureInfo[],
  timeSignature: TimeSignature,
  tempoMap: TempoMap,
  gridBeats: number | null,
  divisionAt: (staff: StaffKind, measureIndex: number, beatInBar: number) => number | null,
): LaidOutRest[] {
  const { denominator } = timeSignature;
  const perBeat = unitsPerBeat(denominator);
  const bar = barUnits(timeSignature);
  // No rest finer than the grid the page is read on: onsets and lengths are
  // rounded to it, so a shorter silence is rounding residue rather than music.
  const minUnits =
    gridBeats === null ? SMALLEST_UNITS : Math.max(SMALLEST_UNITS, Math.round(gridBeats * perBeat));

  const spans: Record<StaffKind, SoundingSpan[]> = { treble: [], bass: [] };
  for (const chord of chords) {
    const fromBeat = tempoMap.beatAtMs(chord.displayStartMs);
    spans[chord.staff].push({
      fromMs: chord.displayStartMs,
      toMs: tempoMap.msAtBeat(fromBeat + beatsForSymbol(chord.symbol, denominator)),
    });
  }
  const sounding: Record<StaffKind, SoundingSpan[]> = {
    treble: mergeSpans(spans.treble),
    bass: mergeSpans(spans.bass),
  };
  // Spans are sorted, so each staff can walk its own list once across the whole
  // piece instead of rescanning it per measure.
  const scanned: Record<StaffKind, number> = { treble: 0, bass: 0 };

  const rests: LaidOutRest[] = [];
  for (const measure of measures) {
    if (measure.empty) continue;
    const startBeat = tempoMap.beatAtMs(measure.startMs);
    const unitsAt = (ms: number): number =>
      Math.round((tempoMap.beatAtMs(ms) - startBeat) * perBeat);
    const msAtUnits = (units: number): number =>
      Math.round(tempoMap.msAtBeat(startBeat + units / perBeat));

    /**
     * Fill a gap, beat by beat, so a beat played in three is filled in threes
     * and its neighbours are filled as they always were.
     */
    const fill = (staff: StaffKind, fromUnits: number, toUnits: number): void => {
      const beatUnits = perBeat;
      const firstBeat = Math.floor(fromUnits / beatUnits + 1e-9);
      const lastBeat = Math.ceil(toUnits / beatUnits - 1e-9) - 1;
      let anyTernary = false;
      for (let b = firstBeat; b <= lastBeat && !anyTernary; b += 1) {
        if (divisionAt(staff, measure.index, b) !== null) anyTernary = true;
      }
      // Where nothing in the gap is played in three, fill it whole. Splitting
      // it beat by beat would forbid the rests that span several — a silent
      // bar is one whole rest, not four quarters.
      if (!anyTernary) {
        pushRests(rests, staff, fromUnits, toUnits, timeSignature, minUnits, msAtUnits);
        return;
      }
      let at = fromUnits;
      while (at < toUnits) {
        const beatIndex = Math.floor(at / beatUnits + 1e-9);
        const beatEnd = Math.min(toUnits, (beatIndex + 1) * beatUnits);
        const division = divisionAt(staff, measure.index, beatIndex);
        if (division !== null) {
          pushTupletRests(rests, staff, at, beatEnd, beatUnits / division, denominator, msAtUnits);
        } else {
          pushRests(rests, staff, at, beatEnd, timeSignature, minUnits, msAtUnits);
        }
        at = beatEnd;
      }
    };

    for (const staff of ['treble', 'bass'] as const) {
      const list = sounding[staff];
      // Only spans that finish before this bar can be retired; one that runs
      // into it is still occupying the bars after it too.
      while (
        scanned[staff] < list.length &&
        (list[scanned[staff]] as SoundingSpan).toMs <= measure.startMs
      ) {
        scanned[staff] += 1;
      }

      let cursor = 0;
      for (let i = scanned[staff]; i < list.length; i += 1) {
        const span = list[i] as SoundingSpan;
        const from = unitsAt(span.fromMs);
        if (from >= bar) break;
        const to = unitsAt(span.toMs);
        if (to <= cursor) continue;
        if (from > cursor) fill(staff, cursor, from);
        cursor = to;
        if (cursor >= bar) break;
      }
      if (cursor < bar) fill(staff, cursor, bar);
    }
  }
  rests.sort((a, b) => a.displayStartMs - b.displayStartMs);
  return rests;
}

/** Steps beyond a staff at which its ledger lines stop being countable. */
const OCTAVE_LINE_STEP_ABOVE = 12; // C6, on the second ledger line over the treble
const OCTAVE_LINE_STEP_BELOW = -4; // C2, on the second ledger line under the bass
/** One octave, in diatonic steps. */
const OCTAVE_STEPS = 7;
/** Chords in a row that must all be out there before a line is worth drawing. */
const MIN_OCTAVE_CHORDS = 4;

/**
 * Find the passages that sit so far outside a staff that they are better
 * written an octave in, and move them there.
 *
 * Only whole chords qualify: half a chord shifted would be a different chord.
 * And only runs of them, because a line drawn over one note costs a reader
 * more attention than the ledger lines it saves.
 */
function deriveOctaveSpans(chords: readonly ChordGroup[]): OctaveSpan[] {
  const spans: OctaveSpan[] = [];

  for (const staff of ['treble', 'bass'] as const) {
    const up = staff === 'treble';
    const limit = up ? OCTAVE_LINE_STEP_ABOVE : OCTAVE_LINE_STEP_BELOW;
    const beyond = (chord: ChordGroup): boolean =>
      chord.notes.every((note) => (up ? note.step >= limit : note.step <= limit));

    const onStaff = chords.filter((chord) => chord.staff === staff);
    let run: ChordGroup[] = [];
    const flush = (): void => {
      if (run.length >= MIN_OCTAVE_CHORDS) {
        const shift = up ? -OCTAVE_STEPS : OCTAVE_STEPS;
        for (const chord of run) {
          for (const note of chord.notes) {
            note.step += shift;
            note.ledger = ledgerLineSteps(note.step);
          }
        }
        spans.push({
          staff,
          fromMs: (run[0] as ChordGroup).displayStartMs,
          toMs: (run[run.length - 1] as ChordGroup).displayStartMs,
          up,
        });
      }
      run = [];
    };
    for (const chord of onStaff) {
      if (beyond(chord)) run.push(chord);
      else flush();
    }
    flush();
  }
  // In time order, not staff order. The live score walks these and stops at the
  // first one past the view, so a late treble line ahead of an early bass one
  // would hide the bass line while its notes stayed shifted — the wrong pitch
  // on screen with nothing to explain it.
  spans.sort((a, b) => a.fromMs - b.fromMs);
  return spans;
}

export function layoutScore(performed: readonly NoteEvent[], options: LayoutOptions): ScoreLayout {
  // Engraving reads only the notes a score draws. A hidden one plays, but it
  // brings nothing onto the page: no head, and no voice, stem vote, beat
  // division or spelling context for the notes around it either. Dynamics are
  // the exception, since they are read from the playing.
  const notes = writtenNotes(performed);
  const barMs = barDurationMs(options.bpm, options.timeSignature);
  const minMeasures = options.minMeasures ?? 4;
  const tempoMap = createTakeTempoMap({
    bpm: options.bpm,
    timeSignature: options.timeSignature,
    changes: options.tempoChanges,
  });

  // The grid lives in beat space, so it stays anchored to bar lines and to the
  // tempo changes that start on them. An absolute millisecond grid at the new
  // tempo would only line up when the change happens to fall on one of its
  // multiples, and would otherwise drag a downbeat off its own bar line.
  const gridBeats = quantizeGridBeats(options.quantization, options.timeSignature.denominator);
  const { denominator } = options.timeSignature;

  /**
   * How each beat divides, by staff — into how many equal slots.
   *
   * Read before anything is placed, because it decides both where a note is
   * drawn and what value it is drawn as. Per staff rather than per bar: a piano
   * piece routinely runs triplets in one hand over straight notes in the other,
   * which is the whole texture of the Moonlight Sonata.
   *
   * Filled from what the score says where it says it, and from the playing where
   * it does not. A declaration is not evidence to be weighed against the onsets
   * — it is the answer, so the inference does not run on a beat that has one.
   */
  const beatDivisions = new Map<string, number>();
  /**
   * The beats whose division came from the score rather than from the playing.
   *
   * They are treated differently, and the difference matters: an inferred
   * division is a reading of the whole beat, so everything in it is read that
   * way, but a declaration is made note by note. A plain sixteenth written
   * *beside* a sextuplet group is not part of it, and dragging it onto the
   * sixths would move its onset an eighth of a beat and write it a third longer
   * than it is — which is how the bars stopped adding up when this was first
   * tried. So inside a declared beat only the notes that declared something
   * follow the division; the rest keep the ordinary grid.
   */
  const declaredBeats = new Set<string>();
  {
    /**
     * How close to a bar or beat line counts as being on it.
     *
     * Note times are whole milliseconds but a beat rarely is — at 54bpm in 2/2
     * it is 2222.2 of them — so a note written exactly on the beat lands a
     * hair *before* it. Floored without this, it joins the beat before and
     * takes an offset of almost 1, which reads as a division the beat does not
     * have and can talk a genuinely ternary beat out of it.
     */
    const offsetsPerBeat = new Map<string, number[]>();
    /** The same offsets with the hands pooled, for beats neither can read alone. */
    const offsetsPerBeatBothHands = new Map<number, number[]>();
    for (const note of notes) {
      const staff = note.staff ?? (note.midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
      const beat = tempoMap.beatAtMs(note.startMs);
      const whole = Math.floor(beat + BEAT_EPSILON);
      const key = `${staff}|${whole}`;
      const offsets = offsetsPerBeat.get(key);
      const offset = Math.max(0, beat - whole);
      if (offsets) {
        if (!offsets.some((seen) => Math.abs(seen - offset) < 1e-6)) offsets.push(offset);
      } else {
        offsetsPerBeat.set(key, [offset]);
      }
      const pooled = offsetsPerBeatBothHands.get(whole);
      if (pooled) {
        if (!pooled.some((seen) => Math.abs(seen - offset) < 1e-6)) pooled.push(offset);
      } else {
        offsetsPerBeatBothHands.set(whole, [offset]);
      }
    }
    // What the score declared, first and without argument. Where two notes in
    // one beat declare different tuplets — an eighth-triplet under a group of
    // sixteenth-triplets — the finer one holds both, since one is a doubling of
    // the other and the coarser note still states its own value exactly.
    for (const note of notes) {
      if (note.tuplet === undefined) continue;
      const division = declaredDivisionOf(note.tuplet, denominator);
      if (division === null) continue; // nothing here can state it; infer instead
      const staff = note.staff ?? (note.midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
      const whole = Math.floor(tempoMap.beatAtMs(note.startMs) + BEAT_EPSILON);
      const key = `${staff}|${whole}`;
      declaredBeats.add(key);
      const known = beatDivisions.get(key);
      if (known === undefined || division > known) beatDivisions.set(key, division);
    }
    for (const [key, offsets] of offsetsPerBeat) {
      if (beatDivisions.has(key)) continue; // the score said; do not second-guess it
      const division = ternaryDivisionOf(offsets);
      if (division !== null) beatDivisions.set(key, division);
    }
    // A hand with too little in a beat to say anything takes the other hand's
    // answer. This is not a guess: an arpeggio that crosses the middle of the
    // keyboard is split between the staves, leaving one or two of its notes
    // alone on the far side — too few to decide by themselves, and belonging
    // to the very figure the other staff has already read as triplets. Both
    // hands keeping their own decided reading is what preserves a genuine
    // three-against-two, where each has enough notes to speak for itself.
    for (const [key, offsets] of offsetsPerBeat) {
      if (beatDivisions.has(key)) continue;
      if (offsets.length >= MIN_ONSETS_TO_DECIDE) continue; // it spoke, and said no
      const [staff, beat] = key.split('|');
      const other = staff === 'treble' ? 'bass' : 'treble';
      // The other hand's answer where it has one; otherwise the two hands
      // pooled, which is the only way to read a figure so evenly divided
      // between them that neither holds enough of it to tell.
      const neighbour = beatDivisions.get(`${other}|${beat}`);
      const division =
        neighbour ?? ternaryDivisionOf(offsetsPerBeatBothHands.get(Number(beat)) ?? []);
      if (division === null || division === undefined) continue;
      // Only if this hand's own notes actually sit on that division. Too few
      // onsets to claim a division is still plenty to rule one out, and three
      // against two is a texture, not a mistake: a hand playing two straight
      // eighths under the other's triplets must be left playing them.
      if (!fitsDivision(offsets, division)) continue;
      beatDivisions.set(key, division);
    }
  }

  /**
   * How the beat this note is read in divides, if it divides other than in two.
   *
   * A note that declares its own tuplet is read in that, wherever it sits. In a
   * beat the *score* divided, a note that declared nothing is not part of the
   * figure and keeps the ordinary grid — see `declaredBeats`. Only where the
   * division was inferred does it cover the whole beat, because there the
   * evidence is the beat's onsets and there is nothing finer to go on.
   */
  const divisionFor = (note: NoteEvent): number | null => {
    if (note.tuplet !== undefined) {
      const declared = declaredDivisionOf(note.tuplet, denominator);
      if (declared !== null) return declared;
    }
    const staff = note.staff ?? (note.midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
    const whole = Math.floor(tempoMap.beatAtMs(note.startMs) + BEAT_EPSILON);
    const key = `${staff}|${whole}`;
    if (declaredBeats.has(key)) return null;
    return beatDivisions.get(key) ?? null;
  };

  const snapToGrid = (startMs: number, division: number | null): number => {
    // A beat played in three is snapped to its own thirds. The binary grid has
    // no position to offer a triplet, so rounding one onto it is what turned
    // them into sixteenths in the first place.
    if (division !== null) {
      const beat = tempoMap.beatAtMs(startMs);
      const whole = Math.floor(beat + BEAT_EPSILON);
      const slot = Math.round(Math.max(0, beat - whole) * division) / division;
      return Math.round(tempoMap.msAtBeat(whole + slot));
    }
    if (gridBeats === null) return startMs;
    const beat = Math.round(tempoMap.beatAtMs(startMs) / gridBeats) * gridBeats;
    return Math.round(tempoMap.msAtBeat(beat));
  };

  /** Beats between a note's endpoints, tempo map and all. */
  const beatsHeld = (note: { startMs: number; durationMs: number }): number =>
    tempoMap.beatAtMs(note.startMs + note.durationMs) - tempoMap.beatAtMs(note.startMs);

  /**
   * The value a note is written as. Onsets snap to the grid, so lengths have to
   * as well or the two disagree: a quarter played detached is held for perhaps
   * four fifths of its beat, which reads as a dotted eighth against a grid that
   * has already put the next note on the following beat. Written that way the
   * bar no longer adds up, and the rests derived from what is left over turn
   * the shortfall into a scattering of unaskable-for silences.
   *
   * Rounding is to the nearest slot and never to nothing, so the shortest note
   * still gets the shortest value the grid can express. With the grid off —
   * only the live score offers that — lengths stay exactly as played.
   */
  const symbolFor = (note: NoteEvent, division: number | null): DurationSymbol => {
    const held = beatsHeld(note);
    if (division !== null) {
      // Inside a tuplet the slot is a third (or a sixth) of the beat, and that
      // is the unit the value rounds to — never the binary grid, whatever the
      // score's grid setting says.
      const slot = 1 / division;
      const slotUnits = slot * unitsPerBeat(denominator);
      const wanted = Math.max(1, Math.round(held / slot));
      // Only lengths a symbol can state exactly. Five triplet slots are not one
      // — the nearest is six, which would overfill the beat by a slot, and a
      // tuplet is never split into tied pieces to make up the difference. So
      // the value steps *down* to the longest it can say, and what is left
      // becomes a rest, which is how the bar keeps adding up.
      for (let slots = wanted; slots >= 1; slots -= 1) {
        const exact = exactValueForUnits(Math.round(slots * slotUnits));
        if (exact) return exact;
      }
      return tupletSymbolForBeats(slot, denominator, TRIPLET);
    }
    if (gridBeats === null) return symbolForBeats(held, denominator);
    return symbolForBeats(Math.max(1, Math.round(held / gridBeats)) * gridBeats, denominator);
  };

  /** Half a grid step at the note, capped, and none without a grid; see `chordTimings`. */
  const chordWindowMs = (note: NoteEvent): number => {
    const division = divisionFor(note);
    const stepBeats = division !== null ? 1 / division : gridBeats;
    if (stepBeats === null) return 0;
    const stepMs = tempoMap.msAtBeat(tempoMap.beatAtMs(note.startMs) + stepBeats) - note.startMs;
    return Math.min(CHORD_ONSET_WINDOW_MS, stepMs / 2);
  };
  /** Where a note written from `onsetMs` lands on its own staff's grid; see `sharedOnset`. */
  const drawnAt = (note: NoteEvent, onsetMs: number): number =>
    snapToGrid(onsetMs, divisionFor({ ...note, startMs: onsetMs }));
  const { onsets, releases } = chordTimings(notes, chordWindowMs, drawnAt);
  /**
   * A note written from its chord's onset rather than its own is written as
   * lasting from there to its release — the one it shares with the notes let
   * go with it — or the notes of one chord would round to different values and
   * come apart into voices. Its performance timing is untouched: it still
   * lights when it actually sounds.
   */
  const writtenBeats = new Map<LaidOutNote, number>();

  const fifths = normalizeFifths(options.keySignature ?? 0);
  // Spelled all at once: a note's letter depends on the chord it sounds in and
  // the note it moves to, not on its pitch alone.
  const keyMode = options.keyMode ?? detectMode(notes, fifths);
  const spellings = spellNotes(
    notes,
    { fifths, mode: keyMode },
    pedalSpans(options.pedals ?? [], Number.POSITIVE_INFINITY),
  );
  const laidOut: LaidOutNote[] = notes.flatMap((note, index) => {
    const onset = onsets[index] as number;
    const release = releases[index] as number;
    const written =
      onset === note.startMs && release === note.startMs + note.durationMs
        ? note
        : { ...note, startMs: onset, durationMs: Math.max(1, release - onset) };
    const position = midiToStaffPosition(
      note.midi,
      note.staff,
      note.clef,
      fifths,
      spellings[index],
    );
    const division = divisionFor(written);
    const displayStartMs = snapToGrid(onset, division);
    const out: LaidOutNote = {
      id: note.id,
      midi: note.midi,
      startMs: note.startMs,
      durationMs: note.durationMs,
      displayStartMs,
      staff: position.staff,
      clef: position.clef,
      ...(note.voice !== undefined ? { voice: note.voice } : {}),
      ...(note.tuplet?.group !== undefined
        ? { tupletGroup: note.tuplet.group, tupletNumeral: note.tuplet.actual }
        : {}),
      step: position.step,
      accidental: position.accidental,
      alter: position.alter,
      symbol: symbolFor(written, division),
      ledger: ledgerLineSteps(position.step),
      headShift: 0,
      accidentalColumn: 0,
      tiedFromPrev: false,
      tiedToNext: false,
    };
    if (written !== note) writtenBeats.set(out, beatsHeld(written));
    // A tuplet value lives inside its beat, and one that runs on past the beat
    // line is written the way a score writes it: the tuplet value up to the
    // line, tied to what is left from it. An import stores such a tie as one
    // note — the triplet eighth that ends a figure and holds into the next
    // beat — and read whole it came out as a lone triplet half, which no beam
    // can carry, so the figure lost its numeral.
    //
    // Only a tuplet the score declared: an inferred one is a reading of the
    // onsets, and where that reading is wrong, cutting notes at its beat lines
    // only piles the pieces onto the notes that follow.
    if (
      division === null ||
      note.tuplet === undefined ||
      declaredDivisionOf(note.tuplet, denominator) !== division
    ) {
      return [out];
    }
    // Only a note that starts inside its beat. One on the beat line reads in
    // whole slots from there, and a long note over a triplet accompaniment —
    // a half note on the beat — is a half note, not a quarter tied to one.
    // Counted in slots, as the onset was snapped to one: a few milliseconds
    // either side of a line — a ritardando's rounding — is still on it.
    const startBeat = tempoMap.beatAtMs(displayStartMs);
    const beatStart = Math.floor(startBeat + BEAT_EPSILON);
    const slotInBeat = Math.round((startBeat - beatStart) * division);
    if (slotInBeat < 1 || slotInBeat >= division) return [out];
    const beatLine = beatStart + 1;
    const endBeat = startBeat + beatsHeld(written);
    if (endBeat - beatLine < 1 / division / 2) return [out];
    const lineMs = Math.round(tempoMap.msAtBeat(beatLine));
    const endMs = Math.round(tempoMap.msAtBeat(endBeat));
    out.symbol = symbolFor(
      { ...written, startMs: displayStartMs, durationMs: lineMs - displayStartMs },
      division,
    );
    out.tiedToNext = true;
    // Measured to the line, should that value come out plain — half a beat of
    // sextuplets is an eighth — and be cut at bar lines like any other.
    writtenBeats.set(out, beatLine - startBeat);
    // What is left starts on a beat line and belongs to no written bracket:
    // the tuplet ended at the line. It is read on whichever grid states it —
    // the plain one for a quarter or an eighth tied on, the tuplet's slots
    // only where it holds a slot or two into a beat that is in threes too.
    const tailBeats = endBeat - beatLine;
    const offBy = (step: number) => Math.abs(tailBeats - Math.round(tailBeats / step) * step);
    const tailDivision =
      gridBeats !== null && offBy(gridBeats) > offBy(1 / division) ? division : null;
    const rest: LaidOutNote = {
      ...out,
      displayStartMs: lineMs,
      symbol: symbolFor({ ...written, startMs: lineMs, durationMs: endMs - lineMs }, tailDivision),
      tiedFromPrev: true,
      tiedToNext: false,
    };
    delete rest.tupletGroup;
    delete rest.tupletNumeral;
    writtenBeats.set(rest, tailBeats);
    return [out, rest];
  });

  const tied = tieAcrossBarLines(laidOut, {
    tempoMap,
    timeSignature: options.timeSignature,
    gridBeats,
    beatsHeld: (note) => writtenBeats.get(note as LaidOutNote) ?? beatsHeld(note),
  });

  // Notes on one staff that start together form a stack, which engraves as one
  // chord per voice — a held note and a run beneath it keep their own written
  // values instead of being fused into a single stem.
  const stacks = new Map<string, LaidOutNote[]>();
  for (const note of tied) {
    const key = `${note.staff}:${note.displayStartMs}`;
    const stack = stacks.get(key);
    if (stack) stack.push(note);
    else stacks.set(key, [note]);
  }

  const chords: ChordGroup[] = [];
  const stemVotes = new Map<string, number>();
  const byStack: ChordGroup[][] = [];
  for (const stack of stacks.values()) {
    const voices = chordsInStack(stack);
    if (voices.length > 1) collectStemVotes(voices, stemVotes);
    byStack.push(voices);
    chords.push(...voices);
  }
  settleVoiceStems(chords, stemVotes);
  chords.sort((a, b) => a.displayStartMs - b.displayStartMs);

  // How far the layout has to reach. A tied piece carries the whole note's
  // performance timing — it is one sounding note — so its own extent is where
  // its *symbol* ends, not its start plus a duration that belongs to the note
  // as a whole. Adding the latter to a later piece's start counts the note
  // twice and buys a blank bar for every tie.
  let maxEndMs = 0;
  for (const note of tied) {
    const writtenEnd = tempoMap.msAtBeat(
      tempoMap.beatAtMs(note.displayStartMs) + beatsForSymbol(note.symbol, denominator),
    );
    const end = Math.max(note.startMs + note.durationMs, writtenEnd);
    if (end > maxEndMs) maxEndMs = end;
  }
  const spans = tempoMap.measureSpans(maxEndMs, minMeasures);

  const chordsByMeasure: ChordGroup[][] = spans.map(() => []);
  for (const chord of chords) {
    const index = measureIndexAt(spans, chord.displayStartMs);
    if (index !== null) (chordsByMeasure[index] as ChordGroup[]).push(chord);
  }

  // A clef stands until something replaces it, so a measure with nothing on a
  // staff keeps reading under whatever the measure before it did.
  let carried: Record<StaffKind, ClefKind> = {
    treble: defaultClefFor('treble'),
    bass: defaultClefFor('bass'),
  };
  const measures: MeasureInfo[] = spans.map((span) => {
    const inMeasure = chordsByMeasure[span.index] as ChordGroup[];
    for (const chord of inMeasure) {
      if (chord.clef !== carried[chord.staff]) carried = { ...carried, [chord.staff]: chord.clef };
    }
    return {
      index: span.index,
      startMs: span.startMs,
      endMs: span.endMs,
      bpm: span.bpm,
      empty: inMeasure.length === 0,
      clefs: carried,
    };
  });

  const rests = deriveRests(
    chords,
    measures,
    options.timeSignature,
    tempoMap,
    gridBeats,
    (staff, measureIndex, beatInBar) => {
      const span = spans[measureIndex];
      if (!span) return null;
      const beat = Math.floor(tempoMap.beatAtMs(span.startMs) + BEAT_EPSILON) + beatInBar;
      return beatDivisions.get(`${staff}|${beat}`) ?? null;
    },
  );

  // Beaming has the last word on stem direction, so it runs before anything
  // that reads one: the heads a stem displaces, and the columns their
  // accidentals stand in.
  const beams = buildBeamGroups(
    chordsByMeasure,
    measures,
    rests,
    options.timeSignature,
    options.eighthsByHalfBar ?? true,
  );
  // The bar decides which accidentals survive, so it has to speak before the
  // ones that are left are given columns to stand in.
  applyMeasureAccidentals(chordsByMeasure);
  for (const voices of byStack) {
    displaceCollidingHeads(voices);
    stackAccidentals(voices);
  }

  const last = measures[measures.length - 1];
  const totalMs = last ? last.endMs : 0;
  const pedals = pedalSpans(options.pedals ?? [], totalMs);
  // After the heads have been placed and their accidentals given columns: the
  // shift moves whole chords bodily, so nothing about their arrangement changes.
  const octaves = deriveOctaveSpans(chords);
  // Read from the notes as played, not from where they are drawn: how hard a
  // key went down is performance, and quantizing it would only blur it. So the
  // hidden ones count here, as the trill the page leaves out is still heard.
  // The thresholds are counted in bars, which the tempo map knows how to find
  // wherever the tempo happens to be at the time.
  const { marks, hairpins } = readDynamics(performed, {
    barAtMs: (atMs) => tempoMap.beatAtMs(atMs) / options.timeSignature.numerator,
  });
  return {
    chords,
    rests,
    beams,
    dynamics: marks,
    hairpins,
    pedals,
    octaves,
    measures,
    barMs,
    totalMs,
    keyMode,
  };
}

/**
 * Index of the measure containing `ms`, or null when it falls outside the
 * layout. Measures can differ in length, so this searches boundaries rather
 * than dividing by a bar duration.
 */
export function measureIndexAt(
  measures: readonly { startMs: number; endMs: number }[],
  ms: number,
): number | null {
  if (measures.length === 0) return null;
  const first = measures[0] as { startMs: number };
  const last = measures[measures.length - 1] as { endMs: number };
  if (ms < first.startMs || ms >= last.endMs) return null;
  let low = 0;
  let high = measures.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((measures[mid] as { startMs: number }).startMs <= ms) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** First chord index with displayStartMs >= fromMs (binary search). */
export function firstChordIndexAt(chords: readonly ChordGroup[], fromMs: number): number {
  let low = 0;
  let high = chords.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((chords[mid] as ChordGroup).displayStartMs < fromMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

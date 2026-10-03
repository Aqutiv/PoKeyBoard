import { MidiImportError } from '@/utils/errors';
import { buildImportedTake, importedTimeSignature, type ImportedNote } from './importedTake';
import { readSmf, type SmfFile, type SmfMetaEvent } from './smfReader';
import { createTakeTempoMap } from './tempoMap';
import {
  MAX_FIFTHS,
  MAX_NOTE_COUNT,
  MAX_TEMPO_BPM,
  MIN_TEMPO_BPM,
  type NoteStaff,
  type QuantizationSetting,
  type Take,
  type TempoChange,
  type TimeSignature,
} from './takeTypes';

/**
 * A Standard MIDI File as a take.
 *
 * MIDI says what was played and when, in ticks, and how fast a tick goes; it
 * says almost nothing about how the music is written. So the milliseconds come
 * straight from the file — every note sounds exactly when the file says — and
 * the rest is inferred as carefully as the file allows: the tempo the notation
 * counts in, the grid it reads on, which hand plays what. Spelling, voices and
 * tuplets are left to the notation's own readers, which already handle takes
 * that never had them.
 */

/** General MIDI keeps channel 10 (9 counted from zero) for drums. */
const DRUM_CHANNEL = 9;
const SUSTAIN_CONTROLLER = 64;
/** A sustain pedal is down from this value up, as General MIDI reads it. */
const PEDAL_DOWN_FROM = 64;

const META_TRACK_NAME = 0x03;
const META_TEMPO = 0x51;
const META_TIME_SIGNATURE = 0x58;
const META_KEY_SIGNATURE = 0x59;

/** A file that names no tempo is at ♩=120, which is 500 000 µs a quarter. */
const DEFAULT_MICROSECONDS_PER_QUARTER = 500_000;

/**
 * How far an onset may sit from a written position and still count as on it,
 * in quarters: two and a half ticks at 960 to the quarter.
 *
 * Exact ticks would do for a file a notation program wrote, but not for one
 * this app wrote: a take keeps whole milliseconds, so its export puts each note
 * up to half a millisecond off, plus half a tick. At ♩=240, the fastest a take
 * holds, that is just under two and a half ticks.
 */
const ON_GRID_TOLERANCE_Q = 2.5 / 960;

/** The share of onsets that must be written positions for a file to be a score. */
const SCORE_ONSET_SHARE = 0.9;
/** Below this many onsets, every one of them must be. */
const SCORE_MIN_ONSETS = 8;

/** Binary positions down to a 64th, and triplets down to a 16th triplet. */
const BINARY_STEP_Q = 1 / 16;
const TRIPLET_STEP_Q = 1 / 24;

/**
 * How much of the timeline lies near a written position: 16 binary and 24
 * triplet positions a quarter, 8 of them shared, each with the tolerance on
 * either side. An onset on no written position — one of a run of 39 in the
 * time of 32, say — still lands near one this often, by chance.
 */
const WRITTEN_POSITIONS_PER_QUARTER = 16 + 24 - 8;
const NEAR_WRITTEN_SHARE = WRITTEN_POSITIONS_PER_QUARTER * 2 * ON_GRID_TOLERANCE_Q;

/** How many times what chance explains a finer grid's onsets must exceed. */
const BEYOND_CHANCE = 2;

/** The offered grids as a length in quarter notes, coarsest first. */
const GRIDS: readonly { setting: QuantizationSetting; stepQ: number }[] = [
  { setting: '1/16', stepQ: 1 / 4 },
  { setting: '1/32', stepQ: 1 / 8 },
  { setting: '1/64', stepQ: 1 / 16 },
];

interface TempoSegment {
  tick: number;
  ms: number;
  microsecondsPerQuarter: number;
}

/** A note as the file plays it, still in ticks. */
interface TickNote {
  midi: number;
  startTick: number;
  endTick: number;
  velocity: number;
  seq: number;
  track: number;
  channel: number;
}

function fail(issue: string): MidiImportError {
  return new MidiImportError([issue], 'invalid');
}

function metaEvents(smf: SmfFile, metaType: number): SmfMetaEvent[] {
  const found: SmfMetaEvent[] = [];
  for (const track of smf.tracks) {
    for (const event of track.events) {
      if (event.type === 'meta' && event.metaType === metaType) found.push(event);
    }
  }
  // Stable, so of two at one tick the one in the later track comes last.
  return found.sort((a, b) => a.tick - b.tick);
}

// ---------------------------------------------------------------------------
// Time: the file's own tempo map, which every millisecond comes from.
// ---------------------------------------------------------------------------

function fileTempoMap(smf: SmfFile): {
  segments: TempoSegment[];
  msAtTick: (tick: number) => number;
} {
  const segments: TempoSegment[] = [
    { tick: 0, ms: 0, microsecondsPerQuarter: DEFAULT_MICROSECONDS_PER_QUARTER },
  ];
  for (const event of metaEvents(smf, META_TEMPO)) {
    if (event.data.length < 3) continue;
    const microsecondsPerQuarter =
      ((event.data[0] as number) << 16) |
      ((event.data[1] as number) << 8) |
      (event.data[2] as number);
    if (microsecondsPerQuarter === 0) continue;
    const previous = segments[segments.length - 1] as TempoSegment;
    if (event.tick === previous.tick) {
      // Two tempos at one tick (or one at the very start): the later wins.
      previous.microsecondsPerQuarter = microsecondsPerQuarter;
      continue;
    }
    segments.push({
      tick: event.tick,
      ms: previous.ms + msBetween(previous, event.tick, smf.ticksPerQuarter),
      microsecondsPerQuarter,
    });
  }
  const msAtTick = (tick: number): number => {
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((segments[mid] as TempoSegment).tick <= tick) low = mid;
      else high = mid - 1;
    }
    const found = segments[low] as TempoSegment;
    return found.ms + msBetween(found, tick, smf.ticksPerQuarter);
  };
  return { segments, msAtTick };
}

function msBetween(segment: TempoSegment, tick: number, ticksPerQuarter: number): number {
  return ((tick - segment.tick) * segment.microsecondsPerQuarter) / 1000 / ticksPerQuarter;
}

/** The most decimals a tempo is looked for with; see `bpmOf`. */
const MAX_BPM_DECIMALS = 4;

/**
 * The bpm a tempo event means. A file stores whole microseconds, so ♩=72
 * written out comes back as 72.0000288. The tempo with the fewest decimals
 * that rounds to exactly the stored value is the one that was meant — 72 —
 * and it times every note the same as the stored value does, to well under a
 * microsecond a beat.
 */
function bpmOf(microsecondsPerQuarter: number): number {
  const exact = 60_000_000 / microsecondsPerQuarter;
  for (let decimals = 0; decimals <= MAX_BPM_DECIMALS; decimals += 1) {
    const scale = 10 ** decimals;
    const meant = Math.round(exact * scale) / scale;
    if (Math.round(60_000_000 / meant) === microsecondsPerQuarter) return meant;
  }
  return exact;
}

/** The octaves (powers of two) that bring `bpm` inside the range a take holds. */
function foldRange(bpm: number): { low: number; high: number } {
  return {
    low: Math.ceil(Math.log2(MIN_TEMPO_BPM / bpm) - 1e-9),
    high: Math.floor(Math.log2(MAX_TEMPO_BPM / bpm) + 1e-9),
  };
}

/** The fold nearest none at all within a range: no change when none is needed. */
function nearestFold({ low, high }: { low: number; high: number }): number {
  return Math.min(high, Math.max(low, 0));
}

/**
 * How each tempo is folded into the range a take can hold.
 *
 * A file may ask for any tempo, a take only for ♩=20–240. Clamping would make
 * the notation count the music at a speed it is not played at, and every note
 * would read as the wrong length. Doubling or halving instead only renames the
 * beat — ♩=400 is ♪=200 — so the notes keep their length, written in values
 * twice as long or half as long.
 *
 * One factor for the whole piece, when one fits, keeps every bar the same
 * length on the page; only a piece whose tempos are more than about a factor
 * of twelve apart needs each one folded on its own.
 */
function foldsFor(bpms: readonly number[]): { folds: number[]; uniform: boolean } {
  let low = -Infinity;
  let high = Infinity;
  for (const bpm of bpms) {
    const range = foldRange(bpm);
    low = Math.max(low, range.low);
    high = Math.min(high, range.high);
  }
  if (low <= high) {
    const fold = nearestFold({ low, high });
    return { folds: bpms.map(() => fold), uniform: true };
  }
  return { folds: bpms.map((bpm) => nearestFold(foldRange(bpm))), uniform: false };
}

/**
 * The meter, restated for a folded beat. When a file's quarter becomes a take's
 * half note (a slow tempo doubled), 4/4 has to become 4/2 for the bar lines to
 * stay where they were; when it becomes an eighth, 4/8. A denominator a take
 * cannot hold is traded against the numerator where that comes out whole.
 */
function foldedMeter(meter: TimeSignature, fold: number): TimeSignature | null {
  const denominator = meter.denominator / 2 ** fold;
  if (denominator > 16) {
    const factor = denominator / 16;
    return Number.isInteger(meter.numerator / factor)
      ? { numerator: meter.numerator / factor, denominator: 16 }
      : null;
  }
  if (denominator < 2) {
    const factor = 2 / denominator;
    return { numerator: meter.numerator * factor, denominator: 2 };
  }
  return { numerator: meter.numerator, denominator };
}

// ---------------------------------------------------------------------------
// The notation's grid: a written score, or a performance?
// ---------------------------------------------------------------------------

function onMultiple(q: number, stepQ: number): boolean {
  const steps = q / stepQ;
  return Math.abs(steps - Math.round(steps)) * stepQ <= ON_GRID_TOLERANCE_Q;
}

/**
 * The grid a file's notes read on.
 *
 * A file a notation program wrote puts its notes on written positions; a
 * recording puts them wherever the hands fell. Only where notes *start* is
 * asked: how long a note is held says how it is played (staccato, legato),
 * not where it is written. A file is a score when nearly every onset is on a
 * binary position down to a 64th or on a triplet; it then gets the coarsest of
 * the offered grids its binary onsets fit — triplets are read in their own
 * division and have no say. A performance gets 1/16, as a fresh recording does.
 *
 * "Fit" allows for chance. A score with irregular tuplets (Chopin writes runs
 * of 21, 28 and 39) has onsets on no written position, and a few of those
 * land near a 64th anyway; a handful of them is no reason to read the whole
 * piece on a 1/64 grid. So a finer grid is chosen only when the onsets that
 * need it outnumber, by `BEYOND_CHANCE`, what the off-grid onsets would put
 * there by chance. A score with no off-grid onsets at all — any file a
 * notation program writes without irregular tuplets — expects no chance hits,
 * and a single onset decides, as a single note value does for MusicXML.
 *
 * `fold` is the uniform tempo fold: halving the tempo makes every value half
 * as long on the page, so a grid one step finer is needed for each halving
 * (and one coarser for each doubling, down to the 1/16 floor).
 */
function gridFor(onsetsQ: readonly number[], fold: number): QuantizationSetting {
  if (onsetsQ.length === 0) return '1/16';
  const binary = onsetsQ.filter((q) => onMultiple(q, BINARY_STEP_Q));
  const triplet = onsetsQ.filter(
    (q) => !onMultiple(q, BINARY_STEP_Q) && onMultiple(q, TRIPLET_STEP_Q),
  );
  const written = binary.length + triplet.length;
  const isScore =
    onsetsQ.length < SCORE_MIN_ONSETS
      ? written === onsetsQ.length
      : written >= SCORE_ONSET_SHARE * onsetsQ.length;
  if (!isScore) return '1/16';

  // Of the onsets that missed every written position, how many more there
  // were in all — some of them hit one by chance and were counted as written.
  const irregular = (onsetsQ.length - written) / (1 - NEAR_WRITTEN_SHARE);
  // Finest first: a grid is needed when the onsets only it holds (those off
  // the next coarser one) are more than chance explains.
  let index = 0;
  for (let i = GRIDS.length - 1; i > 0; i -= 1) {
    const { stepQ } = GRIDS[i] as (typeof GRIDS)[number];
    const coarserStepQ = (GRIDS[i - 1] as (typeof GRIDS)[number]).stepQ;
    const onlyHere = binary.filter((q) => !onMultiple(q, coarserStepQ)).length;
    // Positions this grid has and the coarser lacks, per quarter, each with
    // the tolerance either side.
    const positions = 1 / stepQ - 1 / coarserStepQ;
    const byChance = irregular * positions * 2 * ON_GRID_TOLERANCE_Q;
    if (onlyHere > BEYOND_CHANCE * byChance) {
      index = i;
      break;
    }
  }
  const folded = Math.min(GRIDS.length - 1, Math.max(0, index - fold));
  return (GRIDS[folded] as (typeof GRIDS)[number]).setting;
}

// ---------------------------------------------------------------------------
// What the file says about itself.
// ---------------------------------------------------------------------------

/** A name as UTF-8 when it is valid UTF-8, otherwise as Windows-1252. */
function decodeName(data: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    text = new TextDecoder('windows-1252').decode(data);
  }
  return text.replace(/\p{Cc}/gu, '').trim();
}

function fileTitleOf(smf: SmfFile): string | null {
  // The first track's name is the sequence's: the conductor track of a type 1
  // file, the only track of a type 0. Other tracks' names name instruments.
  const first = smf.tracks[0];
  if (!first) return null;
  for (const event of first.events) {
    if (event.type === 'meta' && event.metaType === META_TRACK_NAME) {
      const name = decodeName(event.data);
      return name.length > 0 ? name : null;
    }
  }
  return null;
}

function fileMeter(smf: SmfFile): TimeSignature | null {
  const event = metaEvents(smf, META_TIME_SIGNATURE).find((e) => e.data.length >= 2);
  if (!event) return null;
  const power = event.data[1] as number;
  return power > 6 ? null : { numerator: event.data[0] as number, denominator: 2 ** power };
}

function fileKey(smf: SmfFile): { fifths: number; mode: 'major' | 'minor' } | null {
  const event = metaEvents(smf, META_KEY_SIGNATURE).find((e) => e.data.length >= 2);
  if (!event) return null;
  const fifths = ((event.data[0] as number) << 24) >> 24; // a signed byte
  const minor = event.data[1] === 1;
  if (Math.abs(fifths) > MAX_FIFTHS) return null;
  // Plenty of programs write C major at the start whatever the music is in;
  // the notation reads the key from the pitches better than that.
  if (fifths === 0 && !minor) return null;
  return { fifths, mode: minor ? 'minor' : 'major' };
}

// ---------------------------------------------------------------------------
// Notes, hands and the pedal.
// ---------------------------------------------------------------------------

/**
 * Every note, a note-on paired with the first note-off for the same key on the
 * same channel of the same track (first in, first out, so a key struck again
 * before it was let go keeps both strikes). A note-on at velocity 0 is a
 * note-off, as MIDI says. A note never let go ends where its track does.
 */
function collectNotes(smf: SmfFile): { notes: TickNote[]; drumNotes: number } {
  const notes: TickNote[] = [];
  let drumNotes = 0;
  let seq = 0;
  smf.tracks.forEach((track, trackIndex) => {
    const open = new Map<number, Omit<TickNote, 'endTick'>[]>();
    for (const event of track.events) {
      if (event.type !== 'channel') continue;
      const isOn = event.command === 0x90 && event.data2 > 0;
      const isOff = event.command === 0x80 || (event.command === 0x90 && event.data2 === 0);
      if (!isOn && !isOff) continue;
      if (event.channel === DRUM_CHANNEL) {
        if (isOn) drumNotes += 1;
        continue;
      }
      const key = event.channel * 128 + event.data1;
      if (isOn) {
        const queue = open.get(key) ?? [];
        queue.push({
          midi: event.data1,
          startTick: event.tick,
          velocity: event.data2 / 127,
          seq: seq++,
          track: trackIndex,
          channel: event.channel,
        });
        open.set(key, queue);
        continue;
      }
      const started = open.get(key)?.shift();
      if (started) notes.push({ ...started, endTick: event.tick });
    }
    for (const queue of open.values()) {
      for (const started of queue) notes.push({ ...started, endTick: track.endTick });
    }
  });
  return { notes, drumNotes };
}

/**
 * Which staff each note belongs on, when the file says.
 *
 * The app's own export writes the right hand on channel 1 in one track and the
 * left on channel 2 in another, so a file shaped exactly like that is read
 * back the same way — even where a hand crosses the other. Any other file with
 * exactly two parts (two tracks, or two channels of one) is split by which
 * part sits higher. One part, or three and more, says nothing about hands, so
 * the notation's middle-C split decides, as it does for a recording.
 */
function staffOf(notes: readonly TickNote[]): (note: TickNote) => NoteStaff | undefined {
  const parts = new Map<string, { track: number; channel: number; sum: number; count: number }>();
  for (const note of notes) {
    const key = `${note.track}:${note.channel}`;
    const part = parts.get(key) ?? { track: note.track, channel: note.channel, sum: 0, count: 0 };
    part.sum += note.midi;
    part.count += 1;
    parts.set(key, part);
  }
  if (parts.size !== 2) return () => undefined;
  const [a, b] = [...parts.values()] as [
    { track: number; channel: number; sum: number; count: number },
    { track: number; channel: number; sum: number; count: number },
  ];
  const ownExport =
    a.track !== b.track && a.channel + b.channel === 1 && a.channel * b.channel === 0;
  let upper: typeof a;
  if (ownExport) upper = a.channel === 0 ? a : b;
  else upper = b.sum / b.count > a.sum / a.count ? b : a;
  return (note) =>
    note.track === upper.track && note.channel === upper.channel ? 'treble' : 'bass';
}

/**
 * The sustain pedal, as one pedal. It is down while any channel holds it: the
 * app's own export writes the pedal into both hands' tracks, and a file from
 * elsewhere may pedal on several channels. Where one channel lets go and
 * another presses on the same tick, the letting go comes first — the order
 * the export writes a change of pedal in.
 */
function collectPedal(smf: SmfFile, msAtTick: (tick: number) => number) {
  const changes: { tick: number; channel: number; down: boolean }[] = [];
  for (const track of smf.tracks) {
    for (const event of track.events) {
      if (
        event.type === 'channel' &&
        event.command === 0xb0 &&
        event.data1 === SUSTAIN_CONTROLLER &&
        event.channel !== DRUM_CHANNEL
      ) {
        changes.push({
          tick: event.tick,
          channel: event.channel,
          down: event.data2 >= PEDAL_DOWN_FROM,
        });
      }
    }
  }
  changes.sort((a, b) => a.tick - b.tick || Number(a.down) - Number(b.down));
  const held = new Set<number>();
  const pedals: { atMs: number; down: boolean }[] = [];
  for (const change of changes) {
    const wasDown = held.size > 0;
    if (change.down) held.add(change.channel);
    else held.delete(change.channel);
    const isDown = held.size > 0;
    if (isDown !== wasDown) pedals.push({ atMs: msAtTick(change.tick), down: isDown });
  }
  return pedals;
}

// ---------------------------------------------------------------------------

/**
 * Parse a Standard MIDI File into a normalized take.
 * Throws `MidiImportError` with human-readable issues on failure.
 */
export function midiToTake(bytes: Uint8Array, fileName?: string): Take {
  const smf = readSmf(bytes);
  const { notes, drumNotes } = collectNotes(smf);
  if (notes.length === 0) {
    throw fail(
      drumNotes > 0
        ? 'The file holds only drums (channel 10), which a piano cannot play.'
        : 'The file contains no playable notes.',
    );
  }
  if (notes.length > MAX_NOTE_COUNT) {
    throw fail(`The file has ${notes.length} notes; the limit is ${MAX_NOTE_COUNT}.`);
  }

  const { segments, msAtTick } = fileTempoMap(smf);

  // Every tempo, folded into the take's range; the meter follows the opening
  // fold, and the grid the finest, since that is where the shortest values are.
  const bpms = segments.map((segment) => bpmOf(segment.microsecondsPerQuarter));
  const { folds } = foldsFor(bpms);
  const meterFold = folds[0] as number;
  const gridFold = Math.min(...folds);
  const meter = importedTimeSignature(
    foldedMeter(fileMeter(smf) ?? { numerator: 4, denominator: 4 }, meterFold),
  );

  // The tempo the take carries, at whole milliseconds. Two changes on one
  // millisecond would be "repaired" on the way in, so the later wins here, as
  // it does in playback; and a change to the tempo already in force is no change.
  const byMs = new Map<number, number>();
  segments.forEach((segment, i) => {
    byMs.set(Math.max(0, Math.round(segment.ms)), (bpms[i] as number) * 2 ** (folds[i] as number));
  });
  const base = byMs.get(0) as number;
  const changes: TempoChange[] = [];
  let inForce = base;
  for (const [atMs, bpm] of [...byMs.entries()].sort((a, b) => a[0] - b[0])) {
    if (atMs === 0 || bpm === inForce) continue;
    changes.push({ atMs, bpm });
    inForce = bpm;
  }

  const staff = staffOf(notes);
  const keyOf = fileKey(smf);
  const onsets = [...new Set(notes.map((note) => note.startTick))].map(
    (tick) => tick / smf.ticksPerQuarter,
  );

  return buildImportedTake(
    {
      notes: notes.map((note): ImportedNote => ({
        midi: note.midi,
        startMs: msAtTick(note.startTick),
        endMs: msAtTick(note.endTick),
        velocity: note.velocity,
        seq: note.seq,
        staff: staff(note),
      })),
      nextSeq: notes.length,
      pedals: collectPedal(smf, msAtTick),
      tempoMap: createTakeTempoMap({ bpm: base, timeSignature: meter, changes }),
      timeSignature: meter,
      keySignature: keyOf?.fifths ?? null,
      keyMode: keyOf?.mode ?? null,
      title: fileTitleOf(smf),
      quantization: gridFor(onsets, gridFold),
    },
    fileName,
    fail,
  );
}
